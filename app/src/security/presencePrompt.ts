/**
 * Tracks in-flight LocalAuthentication prompts so AppLockGate does not treat
 * the biometric system sheet as an app background → re-lock (Samsung / Android).
 */

let depth = 0;
/** Ignore AppState churn briefly after the system sheet closes. */
let graceUntil = 0;

const unlockListeners = new Set<() => void>();

export function beginPresencePrompt(): void {
  graceUntil = 0;
  depth += 1;
}

export function endPresencePrompt(graceMs = 2500): void {
  if (depth === 0) return;
  depth = Math.max(0, depth - 1);
  if (depth > 0) return;
  graceUntil = Date.now() + graceMs;
}

export function isPresencePromptActive(): boolean {
  return depth > 0 || Date.now() < graceUntil;
}

/** True only while a bio/PIN prompt is open — not the post-sheet grace window. */
export function isPresencePromptInFlight(): boolean {
  return depth > 0;
}

/** After a successful in-app UV, keep AppLockGate unlocked (no second bio). */
export function grantAppUnlockFromPresence(): void {
  for (const cb of unlockListeners) {
    try {
      cb();
    } catch (e) {
      console.warn("[basic] unlock grant listener failed", e);
    }
  }
}

export function subscribeAppUnlockFromPresence(cb: () => void): () => void {
  unlockListeners.add(cb);
  return () => {
    unlockListeners.delete(cb);
  };
}
