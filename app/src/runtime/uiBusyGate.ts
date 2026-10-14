/**
 * Module-level gate: while UI gestures / sheets / tour are busy, skip React
 * setState from background polls (balance / rates / ASP). Depth-counted with
 * a short grace after the last end so sheet springs can settle.
 */

const GRACE_MS = 150;

let depth = 0;
let graceTimer: ReturnType<typeof setTimeout> | null = null;
let graceUntil = 0;
const reasons = new Map<string, number>();
const listeners = new Set<() => void>();

function clearGrace(): void {
  if (graceTimer != null) {
    clearTimeout(graceTimer);
    graceTimer = null;
  }
  graceUntil = 0;
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

/** True while a busy reason is held, or during post-end grace. */
export function isUiBusy(): boolean {
  return depth > 0 || Date.now() < graceUntil;
}

export function beginUiBusy(reason: string): void {
  clearGrace();
  const n = (reasons.get(reason) ?? 0) + 1;
  reasons.set(reason, n);
  depth += 1;
  if (depth === 1) {
    console.log(`[uiBusyGate] begin reason=${reason} depth=${depth}`);
  }
}

export function endUiBusy(reason: string): void {
  const n = reasons.get(reason) ?? 0;
  if (n <= 0) return;
  if (n === 1) reasons.delete(reason);
  else reasons.set(reason, n - 1);
  depth = Math.max(0, depth - 1);
  if (depth === 0) {
    clearGrace();
    graceUntil = Date.now() + GRACE_MS;
    graceTimer = setTimeout(() => {
      graceTimer = null;
      graceUntil = 0;
      console.log(`[uiBusyGate] idle after grace reason=${reason}`);
      notify();
    }, GRACE_MS);
    console.log(`[uiBusyGate] end reason=${reason} → grace ${GRACE_MS}ms`);
  }
}

/** Subscribe to transitions into idle (after grace). */
export function subscribeUiBusyIdle(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test / diagnostics. */
export function uiBusyDebug(): { depth: number; reasons: string[]; graceUntil: number } {
  return {
    depth,
    reasons: [...reasons.keys()],
    graceUntil,
  };
}
