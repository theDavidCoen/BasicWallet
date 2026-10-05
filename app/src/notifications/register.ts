/**
 * Register / unregister FCM token + npub with the notifier sidecar.
 * Never sends nsec. Opaque wake only on the server side.
 */

import { Platform } from "react-native";
import { mergeNostrRelays, readBackupMeta } from "../nostr/backupPackage";
import { readPublicIdentity } from "../nostr/identityStore";
import {
  BASIC_APP_ID,
  HOME_RELAY_HINT,
  NOTIFIER_APP_KEY,
  NOTIFIER_BASE_URL,
} from "./config";
import { readPushNotificationPrefs } from "./prefs";
import { getAndroidFcmToken, lastKnownFcmToken } from "./token";

export type RegisterResult =
  | { ok: true }
  | { ok: false; reason: string };

async function resolveRelaysForRegister(): Promise<string[]> {
  const meta = await readBackupMeta();
  const merged = mergeNostrRelays(meta?.relays);
  if (!merged.some((u) => u.toLowerCase().includes("relay.davidcoen.it"))) {
    return mergeNostrRelays([HOME_RELAY_HINT, ...merged]);
  }
  return merged;
}

async function api(
  method: "POST" | "DELETE",
  body: Record<string, unknown>,
): Promise<RegisterResult> {
  if (!NOTIFIER_APP_KEY) {
    return {
      ok: false,
      reason:
        "Notifier key not configured (set EXPO_PUBLIC_BASIC_NOTIFIER_KEY for builds that register).",
    };
  }
  try {
    const res = await fetch(`${NOTIFIER_BASE_URL}/v1/register`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Basic-Notifier-Key": NOTIFIER_APP_KEY,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { error?: string };
        if (j?.error) detail = j.error;
      } catch {
        /* ignore */
      }
      return { ok: false, reason: detail };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Background register — call after toggle on + permission + token. */
export async function registerPushWithNotifier(): Promise<RegisterResult> {
  if (Platform.OS !== "android") {
    return { ok: false, reason: "android_only" };
  }
  const prefs = await readPushNotificationPrefs();
  if (!prefs.enabled) {
    return { ok: false, reason: "notifications_disabled" };
  }
  const identity = await readPublicIdentity();
  if (!identity) {
    return { ok: false, reason: "no_nostr_identity" };
  }
  const token = await getAndroidFcmToken();
  if (!token) {
    return {
      ok: false,
      reason:
        "No FCM device token (need google-services.json + a native build; Expo Go may not suffice).",
    };
  }
  const relays = await resolveRelaysForRegister();
  return api("POST", {
    npub: identity.npub,
    fcmToken: token,
    appId: BASIC_APP_ID,
    platform: "android",
    relays,
  });
}

/**
 * Unregister from sidecar. Safe to call when already off / offline —
 * best-effort; always clears local desire when used from toggle/logout.
 */
export async function unregisterPushFromNotifier(opts?: {
  npub?: string;
  fcmToken?: string;
}): Promise<RegisterResult> {
  if (Platform.OS !== "android") {
    return { ok: true };
  }
  let npub = opts?.npub;
  if (!npub) {
    try {
      npub = (await readPublicIdentity())?.npub;
    } catch {
      /* ignore */
    }
  }
  const fcmToken = opts?.fcmToken ?? lastKnownFcmToken() ?? undefined;
  if (!npub && !fcmToken) {
    return { ok: true };
  }
  if (!NOTIFIER_APP_KEY) {
    // Nothing to tell the server without a key; treat as local-only success.
    return { ok: true };
  }
  return api("DELETE", {
    ...(npub ? { npub } : {}),
    ...(fcmToken ? { fcmToken } : {}),
  });
}

/** Logout / factory reset / toggle off — always try unregister in finally spirit. */
export async function unregisterPushBestEffort(): Promise<void> {
  try {
    await unregisterPushFromNotifier();
  } catch (e) {
    console.warn("[basic] push unregister failed", e);
  }
}
