/**
 * Watch Nostr relays for NIP-17 gift wraps (kind 1059) addressed to us.
 * Live WS subscription + light catch-up on boot / AppState foreground.
 * One cancellable SimplePool subscription — never Promise.race a waitFor*.
 */

import { AppState, type AppStateStatus } from "react-native";
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

/** Debounce catch-up so resume / boot / rapid focus do not hammer relays. */
const CATCH_UP_MIN_MS = 30_000;
/** Lookback for catch-up queries (live sub still gets new events). */
const CATCH_UP_LOOKBACK_SEC = 60 * 60 * 48;
const CATCH_UP_LIMIT = 32;
const CATCH_UP_MAX_WAIT_MS = 4_000;

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
let lastCatchUpAt = 0;
let appStateBound = false;
let catchUpInFlight: Promise<void> | null = null;

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
      const pool = new SimplePool({ enableReconnect: true });
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

/**
 * One-shot relay query for recent gift wraps (missed while backgrounded / WS down).
 * Separate short-lived pool; always closed in finally. Debounced + capped.
 */
export async function catchUpContactShares(): Promise<void> {
  const now = Date.now();
  if (now - lastCatchUpAt < CATCH_UP_MIN_MS) return;
  if (catchUpInFlight) return catchUpInFlight;

  lastCatchUpAt = now;
  catchUpInFlight = (async () => {
    try {
      if (!(await hasNostrIdentity())) return;
      const pair = await loadNostrKeyPairForCrypto();
      if (!pair) return;

      const urls = await resolveRelays();
      const pool = new SimplePool();
      const since = Math.floor(Date.now() / 1000) - CATCH_UP_LOOKBACK_SEC;
      const filter = {
        kinds: [CONTACT_SHARE_KIND],
        "#p": [pair.pubkey],
        since,
        limit: CATCH_UP_LIMIT,
      };

      try {
        for (const url of urls) {
          try {
            const events = await pool.querySync([url], filter, {
              maxWait: CATCH_UP_MAX_WAIT_MS,
            });
            for (const ev of events) {
              await handleWrap(ev, pair.sk);
            }
          } catch (e) {
            console.warn("[basic] contact share catch-up relay failed", url, e);
          }
        }
      } finally {
        pool.close(urls);
      }
    } catch (e) {
      console.warn("[basic] contact share catch-up failed", e);
    } finally {
      catchUpInFlight = null;
    }
  })();

  return catchUpInFlight;
}

/** Foreground / boot: refresh live sub + debounced catch-up. */
export function resumeContactShareWatch(): void {
  stopContactShareWatch();
  startContactShareWatch();
  void catchUpContactShares();
}

function bindAppStateResume(): void {
  if (appStateBound) return;
  appStateBound = true;
  let last: AppStateStatus = AppState.currentState;
  AppState.addEventListener("change", (next) => {
    if (last.match(/inactive|background/) && next === "active") {
      resumeContactShareWatch();
    }
    last = next;
  });
}

/** Boot helper for reminder mount. */
export function queueContactShareWatchBoot(): void {
  bindAppStateResume();
  startContactShareWatch();
  void catchUpContactShares();
}
