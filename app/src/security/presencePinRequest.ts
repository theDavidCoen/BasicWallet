/**
 * Bridge: requireUserPresence can ask the UI host for App PIN confirmation
 * when OS biometrics are missing or fail.
 */

export type PresencePinResult = { ok: true } | { ok: false; reason: string };

type Pending = {
  promptMessage: string;
  resolve: (r: PresencePinResult) => void;
};

let pending: Pending | null = null;
const listeners = new Set<(p: Pending | null) => void>();

export function subscribePresencePinRequest(
  fn: (p: Pending | null) => void,
): () => void {
  listeners.add(fn);
  if (pending) fn(pending);
  return () => {
    listeners.delete(fn);
  };
}

function emit() {
  for (const fn of listeners) fn(pending);
}

/** Shown by UserPresenceHost — resolves when PIN succeeds or user cancels. */
export function requestPresencePin(promptMessage: string): Promise<PresencePinResult> {
  if (pending) {
    pending.resolve({ ok: false, reason: "authentication_busy" });
    pending = null;
  }
  return new Promise<PresencePinResult>((resolve) => {
    pending = { promptMessage, resolve };
    emit();
  });
}

export function resolvePresencePin(result: PresencePinResult): void {
  if (!pending) return;
  const p = pending;
  pending = null;
  emit();
  p.resolve(result);
}

export function isPresencePinPending(): boolean {
  return pending != null;
}
