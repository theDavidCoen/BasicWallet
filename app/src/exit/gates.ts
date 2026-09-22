/**
 * Sensitive exit actions require user presence.
 * When duress unlock ships, reject real package export / fee address there.
 */

import { requireUserPresence, type AuthResult } from "../security/userPresence";

/** True when the session may reveal real exit secrets (package, fee addr). */
export function canRevealExitSecrets(): boolean {
  // Duress home is not implemented yet; always allow after presence gates below.
  return true;
}

export async function requireExitAuth(prompt: string): Promise<AuthResult> {
  if (!canRevealExitSecrets()) {
    return { ok: false, reason: "Unavailable in this session" };
  }
  return requireUserPresence(prompt);
}
