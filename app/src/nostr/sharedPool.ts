/**
 * One long-lived SimplePool for watch/catch-up/chat/share. Features must not
 * call pool.close() except via closeSharedPool (logout / factory reset).
 */

import { SimplePool } from "nostr-tools";

let pool: SimplePool | null = null;

export function getSharedPool(): SimplePool {
  if (!pool) {
    pool = new SimplePool({ enableReconnect: true });
    console.log("[sharedPool] created");
  }
  return pool;
}

/**
 * Run a publish/query against the shared pool. Does not close the pool.
 * Prefer this over `new SimplePool()` + close for one-shots when reconnect
 * state should stay warm.
 */
export async function withSharedPool<T>(
  fn: (pool: SimplePool) => Promise<T>,
): Promise<T> {
  return fn(getSharedPool());
}

/** Logout / factory reset — tear down subscriptions by closing. */
export function closeSharedPool(urls?: string[]): void {
  if (!pool) return;
  try {
    if (urls && urls.length > 0) pool.close(urls);
    else {
      // nostr-tools SimplePool.close expects relay urls; without them, drop ref.
      pool = null;
      console.log("[sharedPool] dropped (no urls)");
      return;
    }
  } catch (e) {
    console.warn("[sharedPool] close failed", e);
  }
  pool = null;
  console.log("[sharedPool] closed");
}
