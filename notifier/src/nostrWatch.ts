import { SimplePool, type SubCloser } from "nostr-tools/pool";
import type { Event } from "nostr-tools/core";
import type { Registration, RegistrationStore } from "./store.js";
import { sendOpaqueWake } from "./fcm.js";

const KIND_GIFT_WRAP = 1059;

/** NIP-17 gift-wraps randomize created_at into the past (up to ~2 days). */
const NIP17_CREATED_LOOKBACK_SEC = 2 * 24 * 3600 + 3600;

/** How often to tear down + resubscribe (WS can die silently on some relays). */
const RESUBSCRIBE_MS = 5 * 60_000;
/** Poll `#p` as backup when live push misses. */
const POLL_MS = 15_000;

type WatchHandle = {
  pool: SimplePool;
  closer: SubCloser;
  urls: string[];
  pubkey: string;
  /** After EOSE, live EVENTs may trigger FCM. */
  liveReady: boolean;
};

/**
 * Watch kind 1059 `#p` for registered pubkeys. Never unwraps.
 *
 * NIP-17 wraps backdate created_at, so filters must use a multi-day lookback.
 * Historical hits seed `seenEventIds` without FCM; only new ids wake devices.
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
  private seeded = false;

  constructor(
    private readonly store: RegistrationStore,
    opts: { homeRelay: string; coalesceMs: number },
  ) {
    this.homeRelay = opts.homeRelay;
    this.coalesceMs = opts.coalesceMs;
  }

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
    void this.seedSeenFromHistory().catch((e) => {
      console.warn(
        "[notifier] seed seen failed",
        e instanceof Error ? e.message : String(e),
      );
    });
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
    return [this.homeRelay.trim() || "wss://relay.davidcoen.it"];
  }

  private lookbackSince(): number {
    return Math.floor(Date.now() / 1000) - NIP17_CREATED_LOOKBACK_SEC;
  }

  private rememberId(id: string): void {
    this.seenEventIds.add(id);
    if (this.seenEventIds.size > 2000) {
      const drop = [...this.seenEventIds].slice(0, 400);
      for (const x of drop) this.seenEventIds.delete(x);
    }
  }

  /** Mark existing wraps as seen so restart/poll does not spam FCM. */
  private async seedSeenFromHistory(): Promise<void> {
    if (this.seeded) return;
    const urls = this.relayUrls({} as Registration);
    const pool = this.pollPool ?? new SimplePool({ enableReconnect: true });
    this.pollPool = pool;
    const since = this.lookbackSince();
    let n = 0;
    for (const reg of this.store.list()) {
      const evs = await pool.querySync(urls, {
        kinds: [KIND_GIFT_WRAP],
        "#p": [reg.pubkey],
        since,
        limit: 80,
      });
      for (const ev of evs) {
        this.rememberId(ev.id);
        n += 1;
      }
    }
    this.seeded = true;
    console.log("[notifier] seeded seen events", n);
  }

  private start(reg: Registration, urls: string[]): void {
    const pool = new SimplePool({ enableReconnect: true });
    const handle: WatchHandle = {
      pool,
      closer: null as unknown as SubCloser,
      urls,
      pubkey: reg.pubkey,
      liveReady: false,
    };
    let closer: SubCloser;
    try {
      closer = pool.subscribe(
        urls,
        {
          kinds: [KIND_GIFT_WRAP],
          "#p": [reg.pubkey],
          since: this.lookbackSince(),
        },
        {
          onevent: (ev) => {
            if (!handle.liveReady) {
              this.rememberId(ev.id);
              return;
            }
            void this.onEvent(reg.pubkey, ev, "live").catch((e) => {
              console.warn(
                "[notifier] onEvent error",
                shortPubkey(reg.pubkey),
                e instanceof Error ? e.message : String(e),
              );
            });
          },
          oneose: () => {
            handle.liveReady = true;
            console.log("[notifier] live ready", shortPubkey(reg.pubkey));
          },
          onclose: (reasons) => {
            handle.liveReady = false;
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
    handle.closer = closer;
    this.handles.set(reg.pubkey, handle);
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
    if (!this.seeded) await this.seedSeenFromHistory();
    const urls = this.relayUrls({} as Registration);
    const pool = this.pollPool ?? new SimplePool({ enableReconnect: true });
    this.pollPool = pool;
    const since = this.lookbackSince();
    for (const reg of this.store.list()) {
      try {
        const evs = await pool.querySync(urls, {
          kinds: [KIND_GIFT_WRAP],
          "#p": [reg.pubkey],
          since,
          limit: 40,
        });
        for (const ev of evs) {
          if (this.seenEventIds.has(ev.id)) continue;
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
    this.rememberId(ev.id);

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
      await sendOpaqueWake({ fcmToken: reg.fcmToken, eventId: ev.id });
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
