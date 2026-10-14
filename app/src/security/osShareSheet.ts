/**
 * Tracks OS share / documents sheets so AppLockGate does not treat them as a
 * true Home/recents background → re-lock (Share npub X felt like logout).
 *
 * Share.share() often resolves (and we clear depth) *before* the late
 * AppState "background" event on Xiaomi/Samsung — keep a short grace window.
 */

let depth = 0;
/** Ignore AppState churn briefly after the OS share sheet closes. */
let graceUntil = 0;

/** Xiaomi often delivers AppState "background" after Share.share resolves. */
const DEFAULT_GRACE_MS = 6000;

export function beginOsShareSheet(): void {
  graceUntil = 0;
  depth += 1;
}

export function endOsShareSheet(graceMs = DEFAULT_GRACE_MS): void {
  depth = Math.max(0, depth - 1);
  if (depth === 0) {
    graceUntil = Date.now() + graceMs;
  }
}

/** True while share is open, or during the post-dismiss grace window. */
export function isOsShareSheetActive(): boolean {
  return depth > 0 || Date.now() < graceUntil;
}
