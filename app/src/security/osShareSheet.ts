/**
 * Tracks OS share / documents sheets so AppLockGate does not treat them as a
 * true Home/recents background → re-lock (Share npub X felt like logout).
 */

let depth = 0;

export function beginOsShareSheet(): void {
  depth += 1;
}

export function endOsShareSheet(): void {
  depth = Math.max(0, depth - 1);
}

export function isOsShareSheetActive(): boolean {
  return depth > 0;
}
