/**
 * Watch kind 1059 gift-wraps addressed to the Cursor bot npub.
 * Owner-only gate: non-owner senders are silently dropped (no reply, no Cursor).
 * Never Promise.race waitFor* — always closer.close / pool.close on teardown.
 */

import { AppState, type AppStateStatus } from "react-native";
import { SimplePool, type SubCloser } from "nostr-tools/pool";
import { unwrapEvent } from "nostr-tools/nip17";
import type { Event } from "nostr-tools/core";
import { parseChatEnvelope } from "../chat/chatEnvelope";
import { CHAT_GIFT_WRAP_KIND } from "../chat/chatNostr";
import { mergeNostrRelays, readBackupMeta } from "../nostr/backupPackage";
import {
  enqueueOwnerBotText,
  hydrateBotProcessedWraps,
  wasBotWrapProcessed,
} from "./botRunner";
import { resumePendingBotFulfills } from "./botFulfill";
import {
  isBotEnabled,
  loadBotKeyPair,
  readBotMeta,
  type BotMeta,
} from "./botIdentity";

const CATCH_UP_MIN_MS = 30_000;
const CATCH_UP_LOOKBACK_SEC = 60 * 60 * 48;
const CATCH_UP_LIMIT = 32;
const CATCH_UP_MAX_WAIT_MS = 1_500;

type WatchState = {
  pool: SimplePool;
  closer: SubCloser;
  urls: string[];
  botPubkey: string;
};

let state: WatchState | null = null;
let startInFlight: Promise<void> | null = null;
let lastCatchUpAt = 0;
let appStateBound = false;
let catchUpInFlight: Promise<void> | null = null;

async function resolveRelays(): Promise<string[]> {
  const meta = await readBackupMeta();
  return mergeNostrRelays(meta?.relays);
}

async function handleBotWrap(ev: Event, botSk: Uint8Array, meta: BotMeta): Promise<void> {
  if (ev.kind !== CHAT_GIFT_WRAP_KIND) return;
  // Fast path; enqueueOwnerBotText also hydrates persisted ids before work.
  if (wasBotWrapProcessed(ev.id)) return;

  let rumor;
  try {
    rumor = unwrapEvent(ev, botSk);
  } catch {
    return;
  }
  if (!rumor?.content || typeof rumor.content !== "string") return;
  if (!rumor.content.trimStart().startsWith("{")) return;

  const sender =
    typeof rumor.pubkey === "string" ? rumor.pubkey.toLowerCase() : "";
  if (!sender) return;

  // Isolation: only the activating owner may converse with this bot.
  if (sender !== meta.ownerPubkey.toLowerCase()) {
    console.warn("[basic] bot watch: drop non-owner sender", sender.slice(0, 12));
    return;
  }

  const chat = parseChatEnvelope(rumor.content);
  if (!chat) return;

  if (chat.type === "basic.wallet.chat.text") {
    enqueueOwnerBotText({ body: chat.body, wrapEventId: ev.id });
  }
  // Other envelope types from owner (receipts, etc.) ignored for bot runner v1.
}

export function startBotWatch(): void {
  if (state || startInFlight) return;
  startInFlight = (async () => {
    try {
      if (!(await isBotEnabled())) return;
      await hydrateBotProcessedWraps();
      const meta = await readBotMeta();
      const pair = await loadBotKeyPair();
      if (!meta?.enabled || !pair) return;

      const urls = await resolveRelays();
      const pool = new SimplePool({ enableReconnect: true });
      const since = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 7;
      const closer = pool.subscribe(
        urls,
        {
          kinds: [CHAT_GIFT_WRAP_KIND],
          "#p": [pair.pubkey],
          since,
        },
        {
          onevent: (ev) => {
            void handleBotWrap(ev, pair.sk, meta);
          },
        },
      );
      state = { pool, closer, urls, botPubkey: pair.pubkey };
    } catch (e) {
      console.warn("[basic] bot watch failed to start", e);
    } finally {
      startInFlight = null;
    }
  })();
}

export function stopBotWatch(): void {
  const s = state;
  state = null;
  if (!s) return;
  try {
    s.closer.close("stop");
  } catch {
    /* */
  }
  try {
    s.pool.close(s.urls);
  } catch {
    /* */
  }
}

export async function catchUpBotWatch(opts?: { force?: boolean }): Promise<void> {
  const now = Date.now();
  if (!opts?.force && now - lastCatchUpAt < CATCH_UP_MIN_MS) return;
  if (catchUpInFlight) return catchUpInFlight;

  lastCatchUpAt = now;
  catchUpInFlight = (async () => {
    try {
      if (!(await isBotEnabled())) return;
      await hydrateBotProcessedWraps();
      const meta = await readBotMeta();
      const pair = await loadBotKeyPair();
      if (!meta?.enabled || !pair) return;

      const urls = await resolveRelays();
      const pool = new SimplePool();
      const since = Math.floor(Date.now() / 1000) - CATCH_UP_LOOKBACK_SEC;
      const filter = {
        kinds: [CHAT_GIFT_WRAP_KIND],
        "#p": [pair.pubkey],
        since,
        limit: CATCH_UP_LIMIT,
      };

      try {
        const batches = await Promise.all(
          urls.map(async (url) => {
            try {
              return await pool.querySync([url], filter, {
                maxWait: CATCH_UP_MAX_WAIT_MS,
              });
            } catch (e) {
              console.warn("[basic] bot catch-up relay failed", url, e);
              return [] as Event[];
            }
          }),
        );
        const seen = new Set<string>();
        for (const events of batches) {
          for (const ev of events) {
            if (!ev?.id || seen.has(ev.id)) continue;
            seen.add(ev.id);
            await handleBotWrap(ev, pair.sk, meta);
          }
        }
      } finally {
        pool.close(urls);
      }
    } catch (e) {
      console.warn("[basic] bot catch-up failed", e);
    } finally {
      catchUpInFlight = null;
    }
  })();

  return catchUpInFlight;
}

export function resumeBotWatch(): void {
  stopBotWatch();
  startBotWatch();
  void catchUpBotWatch();
  resumePendingBotFulfills();
}

function bindAppStateResume(): void {
  if (appStateBound) return;
  appStateBound = true;
  let last: AppStateStatus = AppState.currentState;
  AppState.addEventListener("change", (next) => {
    if (last.match(/inactive|background/) && next === "active") {
      void (async () => {
        if (await isBotEnabled()) resumeBotWatch();
        else stopBotWatch();
      })();
    }
    last = next;
  });
}

/** Boot alongside gift-wrap watch when bot is enabled. */
export function queueBotWatchBoot(): void {
  bindAppStateResume();
  void (async () => {
    if (await isBotEnabled()) {
      startBotWatch();
      void catchUpBotWatch();
      resumePendingBotFulfills();
    } else {
      stopBotWatch();
    }
  })();
}

/** Call after Settings activate / disable. */
export async function syncBotWatchWithEnabledState(): Promise<void> {
  bindAppStateResume();
  if (await isBotEnabled()) {
    resumeBotWatch();
  } else {
    stopBotWatch();
  }
}
