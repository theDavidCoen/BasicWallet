/**
 * Gate sensitive actions. Prefer OS biometrics; fall back to App PIN when
 * biometrics are missing/fail and a PIN is configured.
 *
 * Never enables OS/Knox device-credential fallback (App PIN is in-app only).
 */

import * as LocalAuthentication from "expo-local-authentication";
import { hasAppPin } from "./appPin";
import { getOsBiometricsStatus } from "./osBiometrics";
import {
  beginPresencePrompt,
  endPresencePrompt,
  grantAppUnlockFromPresence,
} from "./presencePrompt";
import { requestPresencePin } from "./presencePinRequest";

export type AuthResult = { ok: true } | { ok: false; reason: string };

export type PresenceOptions = {
  /** When false, do not offer App PIN (e.g. after PIN already verified for remove). */
  allowPin?: boolean;
};

export async function requireUserPresence(
  promptMessage: string,
  opts?: PresenceOptions,
): Promise<AuthResult> {
  const allowPin = opts?.allowPin !== false;
  beginPresencePrompt();
  try {
    const bio = await getOsBiometricsStatus();
    const pinOk = allowPin && (await hasAppPin());

    if (bio.available) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage,
        cancelLabel: "Cancel",
        disableDeviceFallback: true,
      });
      if (result.success) {
        grantAppUnlockFromPresence();
        return { ok: true };
      }
      if (pinOk) {
        return await requestPresencePin(promptMessage);
      }
      return { ok: false, reason: result.error ?? "authentication_failed" };
    }

    if (pinOk) {
      return await requestPresencePin(promptMessage);
    }

    return {
      ok: false,
      reason:
        "OS biometrics are off and no App PIN is set. Enable Face ID / fingerprint in system settings, or set an App PIN in Privacy.",
    };
  } finally {
    endPresencePrompt();
  }
}
