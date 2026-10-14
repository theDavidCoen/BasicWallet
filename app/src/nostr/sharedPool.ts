/**
 * One long-lived SimplePool for watch/catch-up/chat/share. Features must not
 * call pool.close() except via closeSharedPool (logout / factory reset).
 */

import { SimplePool } from "nostr-tools";

let pool: SimplePool | null = null;
/** Relays we have talked to — used to close on logout when urls omitted. */
const knownUrls = new Set<string>();

export function getSharedPool(): SimplePool {
  if (!pool) {
    pool = new SimplePool({ enableReconnect: true });
    console.log("[sharedPool] created");
  }
  return pool;
}

/** Remember relay URLs so closeSharedPool can tear them down. */
export function noteSharedPoolUrls(urls: string[]): void {
  for (const u of urls) {
    if (u) knownUrls.add(u);
  }
}

/**
 * Run a publish/query against the shared pool. Does not close the pool.
 */
export async function withSharedPool<T>(
  fn: (pool: SimplePool) => Promise<T>,
): Promise<T> {
  return fn(getSharedPool());
}

/** Logout / factory reset — close known relays and drop the pool. */
export function closeSharedPool(urls?: string[]): void {
  if (!pool) {
    knownUrls.clear();
    return;
  }
  const toClose = urls && urls.length > 0 ? urls : [...knownUrls];
  try {
    if (toClose.length > 0) {
      pool.close(toClose);
      console.log(`[sharedPool] closed n=${toClose.length}`);
    } else {
      console.log("[sharedPool] drop without urls (no known relays)");
    }
  } catch (e) {
    console.warn("[sharedPool] close failed", e);
  }
  pool = null;
  knownUrls.clear();
}
