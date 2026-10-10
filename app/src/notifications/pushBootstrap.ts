/**
 * Boot helpers for closed-app push (Android).
 * Reuses existing gift-wrap catch-up — does not start a second watcher.
 *
 * Tap → queue wake (eventId) → catch-up → navigate ChatThread (or PayHub).
 * Flush is deferred until NavigationContainer is ready AND AppLockGate is
 * unlocked (cold start + warm resume), so warmup / bio do not drop the route.
 */

import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import type { NavigationContainerRefWithCurrent } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/types";
import {
  catchUpGiftWrapByEventId,
  catchUpGiftWraps,
  resumeContactShareWatch,
} from "../contacts/contactShareWatch";
import {
  findMessageByNostrEventId,
  listUnreadChatThreads,
} from "../chat/chatStore";
import { subscribeAppUnlocked } from "../security/appLockEvents";
import { readPushNotificationPrefs } from "./prefs";
import { registerPushWithNotifier } from "./register";

let handlerSet = false;
let responseSub: Notifications.EventSubscription | null = null;
let tokenSub: Notifications.EventSubscription | null = null;
let unlockSub: (() => void) | null = null;
/** Debounce FCM token-refresh re-register (Expo can fire a burst → rate_limited). */
let tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null;
const TOKEN_REFRESH_DEBOUNCE_MS = 8_000;

/** Pending tray tap until nav ready + unlock + catch-up can resolve a thread. */
type PendingWake = {
  eventId: string;
  rawData: Record<string, unknown> | undefined;
  responseKey: string;
  at: number;
  attempts: number;
};

let pendingWake: PendingWake | null = null;
let lastConsumedResponseKey: string | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let navRefForFlush:
  | NavigationContainerRefWithCurrent<RootStackParamList>
  | null = null;

const PENDING_TTL_MS = 120_000;
const MAX_FLUSH_ATTEMPTS = 12;

function ensureHandler(): void {
  if (handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => {
      // Foreground: in-app gift-wrap watch already owns UX — suppress tray duplicate.
      const active = AppState.currentState === "active";
      return {
        shouldShowAlert: !active,
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: !active,
        shouldShowList: !active,
      };
    },
  });
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return undefined;
}

function readEventId(data: Record<string, unknown> | undefined): string {
  if (!data) return "";
  const nestedBasic = asRecord(data.basic);
  const candidates: unknown[] = [
    data["basic.eventId"],
    data.basicEventId,
    data.eventId,
    nestedBasic?.eventId,
    nestedBasic?.["eventId"],
  ];
  // Some Android/Expo paths stringify the whole data blob.
  if (typeof data.body === "string" && data.body.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(data.body) as Record<string, unknown>;
      candidates.push(
        parsed["basic.eventId"],
        parsed.basicEventId,
        parsed.eventId,
      );
    } catch {
      /* ignore */
    }
  }
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    const id = raw.trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(id)) return id;
  }
  return "";
}

function isNostrWake(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const wake = data["basic.wake"] ?? data.basicWake ?? asRecord(data.basic)?.wake;
  if (wake === "nostr") return true;
  // Any push with our eventId is a chat wake even if wake flag is missing.
  if (readEventId(data)) return true;
  // Opaque tray with only basic.app / empty data — still try catch-up → PayHub.
  if (data["basic.app"] != null || data.basicApp != null) return true;
  return Object.keys(data).length > 0;
}

/**
 * Merge content.data with Android remoteMessage extras (OEM / Expo variants).
 */
function extractResponseData(
  response: Notifications.NotificationResponse,
): Record<string, unknown> | undefined {
  const contentData = asRecord(response.notification.request.content.data);
  const trigger = response.notification.request.trigger as unknown;
  const triggerRec = asRecord(trigger);
  const remote = asRecord(triggerRec?.remoteMessage);
  const remoteData = asRecord(remote?.data) ?? asRecord(triggerRec?.data);
  if (!contentData && !remoteData) return undefined;
  return { ...(remoteData ?? {}), ...(contentData ?? {}) };
}

function responseKey(response: Notifications.NotificationResponse): string {
  const id =
    response.notification.request.identifier ||
    response.notification.date?.toString() ||
    "";
  const eventId = readEventId(extractResponseData(response));
  return `${id}|${eventId}|${response.actionIdentifier}`;
}

/**
 * After catch-up: map wrap event → contact, else single unread thread, else null.
 */
async function resolvePushContactId(eventId: string): Promise<string | null> {
  resumeContactShareWatch();
  if (eventId) {
    await catchUpGiftWrapByEventId(eventId);
  }
  // One force catch-up for wraps missed while killed (same as prior alias path).
  await catchUpGiftWraps({ force: true });

  if (eventId) {
    const msg = findMessageByNostrEventId(eventId);
    if (msg?.contactId) return msg.contactId;
  }
  const unread = listUnreadChatThreads();
  if (unread.length === 1) return unread[0]!.contactId;
  return null;
}

function queueWakeFromResponse(
  response: Notifications.NotificationResponse,
): void {
  const data = extractResponseData(response);
  if (!isNostrWake(data)) return;
  const key = responseKey(response);
  if (key && key === lastConsumedResponseKey) return;
  pendingWake = {
    eventId: readEventId(data),
    rawData: data,
    responseKey: key,
    at: Date.now(),
    attempts: 0,
  };
  console.warn("[basic] push wake queued", {
    eventId: pendingWake.eventId.slice(0, 12) || null,
    keys: data ? Object.keys(data).slice(0, 8) : [],
  });
}

function navigateWake(
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>,
  contactId: string | null,
): boolean {
  if (!navigationRef.isReady()) return false;
  try {
    if (contactId) {
      navigationRef.navigate("ChatThread", { contactId });
    } else {
      navigationRef.navigate("PayHub");
    }
    return true;
  } catch (e) {
    console.warn("[basic] push navigate", e);
    return false;
  }
}

/**
 * Attempt catch-up + navigation for the pending tray tap.
 * Returns true when the wake was fully consumed (navigated).
 */
export async function flushPendingPushWake(
  navigationRef?: NavigationContainerRefWithCurrent<RootStackParamList> | null,
): Promise<boolean> {
  const nav = navigationRef ?? navRefForFlush;
  if (!nav) return false;
  const pending = pendingWake;
  if (!pending) return false;
  if (Date.now() - pending.at > PENDING_TTL_MS) {
    pendingWake = null;
    return false;
  }
  if (!nav.isReady()) return false;

  pending.attempts += 1;
  let contactId: string | null = null;
  try {
    contactId = await resolvePushContactId(pending.eventId);
  } catch (e) {
    console.warn("[basic] push resolve contact", e);
  }

  // Have an eventId but message not ingested yet — keep pending and retry.
  if (pending.eventId && !contactId && pending.attempts < MAX_FLUSH_ATTEMPTS) {
    scheduleFlush(600 * Math.min(pending.attempts, 5));
    return false;
  }

  const ok = navigateWake(nav, contactId);
  if (!ok) {
    scheduleFlush(500);
    return false;
  }

  console.warn("[basic] push wake navigated", {
    contactId: contactId?.slice(0, 12) ?? null,
    eventId: pending.eventId.slice(0, 12) || null,
    attempts: pending.attempts,
  });
  lastConsumedResponseKey = pending.responseKey;
  pendingWake = null;
  try {
    Notifications.clearLastNotificationResponse();
  } catch {
    /* optional on older native */
  }
  return true;
}

function scheduleFlush(delayMs: number): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPendingPushWake();
  }, delayMs);
}

/**
 * Call once when the root navigator mounts (wallet session, not warming).
 * Sets up tap → Chat thread (or Pay hub) + gift-wrap catch-up; refreshes registration if opt-in.
 */
export function bindPushNotificationListeners(
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>,
): () => void {
  if (Platform.OS !== "android") {
    return () => undefined;
  }
  ensureHandler();
  navRefForFlush = navigationRef;

  if (!responseSub) {
    responseSub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        queueWakeFromResponse(response);
        void flushPendingPushWake(navigationRef);
        // Cover unlock / late catch-up.
        scheduleFlush(400);
        scheduleFlush(1_200);
        scheduleFlush(2_500);
        scheduleFlush(5_000);
      },
    );
  }

  if (!unlockSub) {
    unlockSub = subscribeAppUnlocked(() => {
      void flushPendingPushWake(navigationRef);
      scheduleFlush(300);
      scheduleFlush(1_500);
    });
  }

  if (!tokenSub) {
    tokenSub = Notifications.addPushTokenListener(() => {
      if (tokenRefreshTimer) clearTimeout(tokenRefreshTimer);
      tokenRefreshTimer = setTimeout(() => {
        tokenRefreshTimer = null;
        void (async () => {
          const prefs = await readPushNotificationPrefs();
          if (!prefs.enabled) return;
          const r = await registerPushWithNotifier();
          if (!r.ok) console.warn("[basic] push re-register on token refresh", r.reason);
        })();
      }, TOKEN_REFRESH_DEBOUNCE_MS);
    });
  }

  void (async () => {
    const prefs = await readPushNotificationPrefs();
    if (prefs.enabled) {
      const r = await registerPushWithNotifier();
      if (!r.ok) console.warn("[basic] push boot register", r.reason);
    }
    // Cold start opened from a notification.
    try {
      const last = await Notifications.getLastNotificationResponseAsync();
      if (last) {
        queueWakeFromResponse(last);
        void flushPendingPushWake(navigationRef);
        scheduleFlush(500);
        scheduleFlush(1_500);
        scheduleFlush(3_000);
        scheduleFlush(6_000);
      }
    } catch (e) {
      console.warn("[basic] getLastNotificationResponseAsync", e);
    }
  })();

  return () => {
    responseSub?.remove();
    responseSub = null;
    tokenSub?.remove();
    tokenSub = null;
    unlockSub?.();
    unlockSub = null;
    if (tokenRefreshTimer) {
      clearTimeout(tokenRefreshTimer);
      tokenRefreshTimer = null;
    }
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (navRefForFlush === navigationRef) navRefForFlush = null;
  };
}
