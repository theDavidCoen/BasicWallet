/**
 * Watch Nostr relays for NIP-17 gift wraps (kind 1059) addressed to us.
 * One cancellable SimplePool subscription — never Promise.race a waitFor*.
 */

import { SimplePool, type SubCloser } from "nostr-tools/pool";
import { unwrapEvent } from "nostr-tools/nip17";
import type { Event } from "nostr-tools/core";
import { DEFAULT_NOSTR_RELAYS, readBackupMeta } from "../nostr/backupPackage";
import { hasNostrIdentity, loadNostrKeyPairForCrypto } from "../nostr/identityStore";
import {
  CONTACT_SHARE_KIND,
  parseContactShareMessage,
} from "./contactShare";
import { enqueueContactShareOffer } from "./contactShareInbox";

async function resolveRelays(): Promise<string[]> {
  const meta = await readBackupMeta();
  if (meta?.relays?.length) return meta.relays;
  return DEFAULT_NOSTR_RELAYS;
}

type WatchState = {
  pool: SimplePool;
  closer: SubCloser;
  urls: string[];
};

let state: WatchState | null = null;
let startInFlight: Promise<void> | null = null;

async function handleWrap(ev: Event, sk: Uint8Array): Promise<void> {
  if (ev.kind !== CONTACT_SHARE_KIND) return;
  let rumor;
  try {
    rumor = unwrapEvent(ev, sk);
  } catch {
    return;
  }
  if (!rumor?.content || typeof rumor.content !== "string") return;
  // Skip obvious non-JSON chat DMs quickly
  if (!rumor.content.trimStart().startsWith("{")) return;
  const msg = parseContactShareMessage(rumor.content);
  if (!msg) return;
  await enqueueContactShareOffer(ev.id, msg);
}

/**
 * Start (or no-op if already running) a long-lived gift-wrap subscription.
 * Call stopContactShareWatch on logout / remount.
 */
export function startContactShareWatch(): void {
  if (state || startInFlight) return;
  startInFlight = (async () => {
    try {
      if (!(await hasNostrIdentity())) return;
      const pair = await loadNostrKeyPairForCrypto();
      if (!pair) return;

      const urls = await resolveRelays();
      const pool = new SimplePool();
      const since = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 7; // 7d lookback
      const closer = pool.subscribe(
        urls,
        {
          kinds: [CONTACT_SHARE_KIND],
          "#p": [pair.pubkey],
          since,
        },
        {
          onevent: (ev) => {
            void handleWrap(ev, pair.sk);
          },
          onclose: () => {
            /* reconnect is handled by pool if enableReconnect; we keep one sub */
          },
        },
      );
      state = { pool, closer, urls };
    } catch (e) {
      console.warn("[basic] contact share watch failed to start", e);
    } finally {
      startInFlight = null;
    }
  })();
}

export function stopContactShareWatch(): void {
  const s = state;
  state = null;
  if (!s) return;
  try {
    s.closer.close("stop");
  } catch {
    /* ignore */
  }
  try {
    s.pool.close(s.urls);
  } catch {
    /* ignore */
  }
}

/** Boot helper for WalletProvider / reminder mount. */
export function queueContactShareWatchBoot(): void {
  startContactShareWatch();
}
