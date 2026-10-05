import { SimplePool, type SubCloser } from "nostr-tools/pool";
import type { Event } from "nostr-tools/core";
import type { Registration, RegistrationStore } from "./store.js";
import { sendOpaqueWake } from "./fcm.js";

const KIND_GIFT_WRAP = 1059;

/** How often to tear down + resubscribe (WS can die silently on some relays). */
const RESUBSCRIBE_MS = 5 * 60_000;
/** Poll `#p` as backup when live push misses (strfry/paywall quirks). */
const POLL_MS = 15_000;
const POLL_LOOKBACK_SEC = 120;

type WatchHandle = {
  pool: SimplePool;
  closer: SubCloser;
  urls: string[];
  pubkey: string;
};

/**
 * Multiplexed live subscriptions: one SubCloser per registered pubkey.
 * Sidecar never unwraps gift-wraps — only sees kind + #p metadata.
 *
 * Prefers HOME_RELAY (internal strfry WS when configured). Polls `#p` as
 * backup so missed live EVENT frames still wake FCM.
 */
export class GiftWrapWatcher {
  private handles = new Map<string, WatchHandle>();
  private lastPingAt = new Map<string, number>();
  private seenEventIds = new Set<string>();
  private readonly coalesceMs: number;
  private readonly homeRelay: string;
  private resubTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollPool: SimplePool | null = null;

  constructor(
    private readonly store: RegistrationStore,
    opts: { homeRelay: string; coalesceMs: number },
  ) {
    this.homeRelay = opts.homeRelay;
    this.coalesceMs = opts.coalesceMs;
  }

  /** Start periodic resubscribe + `#p` poll backup. */
  startMaintenance(): void {
    if (!this.resubTimer) {
      this.resubTimer = setInterval(() => {
        try {
          console.log("[notifier] resubscribe tick");
          this.forceResubscribeAll();
        } catch (e) {
          console.warn(
            "[notifier] resubscribe failed",
            e instanceof Error ? e.message : String(e),
          );
        }
      }, RESUBSCRIBE_MS);
      this.resubTimer.unref?.();
    }
    if (!this.pollTimer) {
      this.pollPool = new SimplePool({ enableReconnect: true });
      this.pollTimer = setInterval(() => {
        void this.pollCatchUp().catch((e) => {
          console.warn(
            "[notifier] poll catch-up failed",
            e instanceof Error ? e.message : String(e),
          );
        });
      }, POLL_MS);
      this.pollTimer.unref?.();
    }
  }

  syncFromStore(): void {
    const regs = this.store.list();
    const want = new Set(regs.map((r) => r.pubkey));
    for (const pubkey of this.handles.keys()) {
      if (!want.has(pubkey)) this.stopOne(pubkey);
    }
    for (const reg of regs) {
      this.ensure(reg);
    }
  }

  /** Drop all handles and open fresh subscriptions from the store. */
  forceResubscribeAll(): void {
    for (const pubkey of [...this.handles.keys()]) {
      this.stopOne(pubkey);
    }
    this.syncFromStore();
  }

  ensure(reg: Registration): void {
    const existing = this.handles.get(reg.pubkey);
    const urls = this.relayUrls(reg);
    if (existing) {
      const same =
        existing.urls.length === urls.length &&
        existing.urls.every((u, i) => u === urls[i]);
      if (same) return;
      this.stopOne(reg.pubkey);
    }
    this.start(reg, urls);
  }

  private relayUrls(reg: Registration): string[] {
    void reg;
    const home = this.homeRelay.trim() || "wss://relay.davidcoen.it";
    return [home];
  }

  private start(reg: Registration, urls: string[]): void {
    const pool = new SimplePool({ enableReconnect: true });
    const since = Math.floor(Date.now() / 1000) - 60;
    let closer: SubCloser;
    try {
      closer = pool.subscribe(
        urls,
        {
          kinds: [KIND_GIFT_WRAP],
          "#p": [reg.pubkey],
          since,
        },
        {
          onevent: (ev) => {
            void this.onEvent(reg.pubkey, ev, "live").catch((e) => {
              console.warn(
                "[notifier] onEvent error",
                shortPubkey(reg.pubkey),
                e instanceof Error ? e.message : String(e),
              );
            });
          },
          onclose: (reasons) => {
            console.warn(
              "[notifier] sub closed",
              shortPubkey(reg.pubkey),
              Array.isArray(reasons) ? reasons.join(";") : String(reasons),
            );
          },
        },
      );
    } catch (e) {
      console.warn(
        "[notifier] subscribe failed",
        shortPubkey(reg.pubkey),
        e instanceof Error ? e.message : String(e),
      );
      try {
        pool.close(urls);
      } catch {
        /* ignore */
      }
      return;
    }
    this.handles.set(reg.pubkey, { pool, closer, urls, pubkey: reg.pubkey });
    console.log(
      "[notifier] watching",
      shortPubkey(reg.pubkey),
      "on",
      urls.length,
      "relay(s)",
      urls[0] ?? "",
    );
  }

  private async pollCatchUp(): Promise<void> {
    const urls = [this.homeRelay.trim() || "wss://relay.davidcoen.it"];
    const pool = this.pollPool ?? new SimplePool({ enableReconnect: true });
    this.pollPool = pool;
    const since = Math.floor(Date.now() / 1000) - POLL_LOOKBACK_SEC;
    for (const reg of this.store.list()) {
      try {
        const evs = await pool.querySync(urls, {
          kinds: [KIND_GIFT_WRAP],
          "#p": [reg.pubkey],
          since,
          limit: 20,
        });
        for (const ev of evs) {
          await this.onEvent(reg.pubkey, ev, "poll");
        }
      } catch (e) {
        console.warn(
          "[notifier] poll query failed",
          shortPubkey(reg.pubkey),
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  }

  private async onEvent(
    pubkey: string,
    ev: Event,
    source: "live" | "poll",
  ): Promise<void> {
    if (ev.kind !== KIND_GIFT_WRAP) return;
    if (this.seenEventIds.has(ev.id)) return;
    this.seenEventIds.add(ev.id);
    // Bound memory: keep last ~500 ids.
    if (this.seenEventIds.size > 500) {
      const drop = [...this.seenEventIds].slice(0, 100);
      for (const id of drop) this.seenEventIds.delete(id);
    }

    const now = Date.now();
    const last = this.lastPingAt.get(pubkey) ?? 0;
    if (now - last < this.coalesceMs) {
      console.log(
        "[notifier] coalesce skip",
        shortPubkey(pubkey),
        "event",
        ev.id.slice(0, 8),
        source,
      );
      return;
    }
    this.lastPingAt.set(pubkey, now);

    const reg = this.store.list().find((r) => r.pubkey === pubkey);
    if (!reg) return;

    try {
      await sendOpaqueWake({ fcmToken: reg.fcmToken });
      console.log(
        "[notifier] fcm sent",
        shortPubkey(pubkey),
        "event",
        ev.id.slice(0, 8),
        source,
        "clen",
        (ev.content || "").length,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[notifier] fcm send failed", shortPubkey(pubkey), msg);
      if (/registration-token-not-registered|invalid-registration-token|not-found/i.test(msg)) {
        this.store.remove({ fcmToken: reg.fcmToken });
        this.stopOne(pubkey);
      }
    }
  }

  stopOne(pubkey: string): void {
    const h = this.handles.get(pubkey);
    if (!h) return;
    this.handles.delete(pubkey);
    try {
      h.closer.close("stop");
    } catch {
      /* ignore */
    }
    try {
      h.pool.close(h.urls);
    } catch {
      /* ignore */
    }
  }

  stopAll(): void {
    if (this.resubTimer) {
      clearInterval(this.resubTimer);
      this.resubTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.pollPool) {
      try {
        this.pollPool.close([this.homeRelay]);
      } catch {
        /* ignore */
      }
      this.pollPool = null;
    }
    for (const pubkey of [...this.handles.keys()]) {
      this.stopOne(pubkey);
    }
  }

  stats(): { subscriptions: number } {
    return { subscriptions: this.handles.size };
  }
}

function shortPubkey(pubkey: string): string {
  return `${pubkey.slice(0, 8)}…`;
}
