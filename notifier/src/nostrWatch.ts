import { SimplePool, type SubCloser } from "nostr-tools/pool";
import type { Event } from "nostr-tools/core";
import type { Registration, RegistrationStore } from "./store.js";
import { sendOpaqueWake } from "./fcm.js";

const KIND_GIFT_WRAP = 1059;

type WatchHandle = {
  pool: SimplePool;
  closer: SubCloser;
  urls: string[];
  pubkey: string;
};

/**
 * Multiplexed live subscriptions: one SubCloser per registered pubkey.
 * Sidecar never unwraps gift-wraps — only sees kind + #p metadata.
 */
export class GiftWrapWatcher {
  private handles = new Map<string, WatchHandle>();
  private lastPingAt = new Map<string, number>();
  private readonly coalesceMs: number;
  private readonly homeRelay: string;

  constructor(
    private readonly store: RegistrationStore,
    opts: { homeRelay: string; coalesceMs: number },
  ) {
    this.homeRelay = opts.homeRelay;
    this.coalesceMs = opts.coalesceMs;
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
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of [this.homeRelay, ...(reg.relays ?? [])]) {
      const url = raw.trim();
      if (!url) continue;
      const key = url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(url);
    }
    return out.length ? out : [this.homeRelay];
  }

  private start(reg: Registration, urls: string[]): void {
    const pool = new SimplePool({ enableReconnect: true });
    const since = Math.floor(Date.now() / 1000) - 60;
    const closer = pool.subscribe(
      urls,
      {
        kinds: [KIND_GIFT_WRAP],
        "#p": [reg.pubkey],
        since,
      },
      {
        onevent: (ev) => {
          void this.onEvent(reg.pubkey, ev);
        },
      },
    );
    this.handles.set(reg.pubkey, { pool, closer, urls, pubkey: reg.pubkey });
    console.log(
      "[notifier] watching",
      shortPubkey(reg.pubkey),
      "on",
      urls.length,
      "relay(s)",
    );
  }

  private async onEvent(pubkey: string, ev: Event): Promise<void> {
    if (ev.kind !== KIND_GIFT_WRAP) return;
    const now = Date.now();
    const last = this.lastPingAt.get(pubkey) ?? 0;
    if (now - last < this.coalesceMs) return;
    this.lastPingAt.set(pubkey, now);

    const reg = this.store.list().find((r) => r.pubkey === pubkey);
    if (!reg) return;

    try {
      await sendOpaqueWake({ fcmToken: reg.fcmToken });
      console.log("[notifier] fcm sent", shortPubkey(pubkey), "event", ev.id.slice(0, 8));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[notifier] fcm send failed", shortPubkey(pubkey), msg);
      // Drop dead tokens so we do not keep failing.
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
