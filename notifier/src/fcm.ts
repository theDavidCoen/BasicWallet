import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";

let messaging: Messaging | null = null;
let initError: string | null = null;

function loadServiceAccount(): Record<string, unknown> | null {
  const inline = process.env.FCM_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) {
    return JSON.parse(inline) as Record<string, unknown>;
  }
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (path) {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  }
  return null;
}

export function initFcm(): { ok: boolean; reason?: string } {
  if (messaging) return { ok: true };
  try {
    const sa = loadServiceAccount();
    if (!sa) {
      initError =
        "Missing FCM credentials — set GOOGLE_APPLICATION_CREDENTIALS or FCM_SERVICE_ACCOUNT_JSON";
      return { ok: false, reason: initError };
    }
    let app: App;
    if (getApps().length === 0) {
      app = initializeApp({ credential: cert(sa as Parameters<typeof cert>[0]) });
    } else {
      app = getApps()[0]!;
    }
    messaging = getMessaging(app);
    initError = null;
    return { ok: true };
  } catch (e) {
    initError = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: initError };
  }
}

export function fcmStatus(): { ready: boolean; reason?: string } {
  if (messaging) return { ready: true };
  if (initError) return { ready: false, reason: initError };
  return initFcm().ok
    ? { ready: true }
    : { ready: false, reason: initError ?? "FCM not configured" };
}

/**
 * Opaque tray notification. Never include sats / memo / addresses / event content.
 * data.basic.wake = "nostr" so the app runs gift-wrap catch-up on open.
 * data.basic.eventId = wrap id (hex) for deep-link to the chat thread after unlock.
 */
export async function sendOpaqueWake(opts: {
  fcmToken: string;
  title?: string;
  body?: string;
  /** Kind 1059 gift-wrap event id (64 hex). Routing only — not shown in tray text. */
  eventId?: string;
}): Promise<void> {
  const status = fcmStatus();
  if (!status.ready || !messaging) {
    throw new Error(status.reason ?? "FCM not ready");
  }
  const eventId =
    typeof opts.eventId === "string" && /^[0-9a-f]{64}$/i.test(opts.eventId.trim())
      ? opts.eventId.trim().toLowerCase()
      : "";
  // High-priority notification+data so Play Services can show a tray entry
  // even when the app process is not running. Force-stop (stopped=true) still
  // blocks delivery on some OEMs (MIUI / One UI) — that is not fixable in FCM.
  // Do not set restrictedPackageName — it can drop delivery after force-stop.
  await messaging.send({
    token: opts.fcmToken,
    notification: {
      title: opts.title ?? "Basic",
      body: opts.body ?? "New Pay message",
    },
    data: {
      "basic.wake": "nostr",
      "basic.app": process.env.FCM_ANDROID_PACKAGE?.trim() || "app.basic.wallet",
      ...(eventId ? { "basic.eventId": eventId } : {}),
    },
    android: {
      priority: "high",
      ttl: 86400,
      collapseKey: "basic-nostr-wake",
      notification: {
        channelId: "basic-pay",
        priority: "high",
        defaultSound: true,
        defaultVibrateTimings: true,
        visibility: "private",
      },
      fcmOptions: {
        analyticsLabel: "basic_nostr_wake",
      },
    },
  });
}
