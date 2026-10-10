/**
 * AppLockGate unlock signals for deferred work (push deep-link flush, etc.).
 * Separate from presencePrompt UV grants to avoid re-entrancy with AppLockGate.
 */

const unlockListeners = new Set<() => void>();

/** Call from AppLockGate after a successful unlock (bio/PIN/no-lock). */
export function notifyAppUnlocked(): void {
  for (const cb of unlockListeners) {
    try {
      cb();
    } catch (e) {
      console.warn("[basic] app unlock listener failed", e);
    }
  }
}

export function subscribeAppUnlocked(cb: () => void): () => void {
  unlockListeners.add(cb);
  return () => {
    unlockListeners.delete(cb);
  };
}
