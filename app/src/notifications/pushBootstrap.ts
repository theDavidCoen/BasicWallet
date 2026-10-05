/**
 * Boot helpers for closed-app push (Android).
 * Reuses existing gift-wrap catch-up — does not start a second watcher.
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
import { readPushNotificationPrefs } from "./prefs";
import { registerPushWithNotifier } from "./register";

let handlerSet = false;
let responseSub: Notifications.EventSubscription | null = null;
let tokenSub: Notifications.EventSubscription | null = null;
/** Debounce FCM token-refresh re-register (Expo can fire a burst → rate_limited). */
let tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null;
const TOKEN_REFRESH_DEBOUNCE_MS = 8_000;

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

function readEventId(data: Record<string, unknown> | undefined): string {
  const raw = data?.["basic.eventId"] ?? data?.basicEventId ?? data?.eventId;
  if (typeof raw !== "string") return "";
  const id = raw.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(id) ? id : "";
}

/**
 * After catch-up: map wrap event → contact, else single unread thread, else null.
 */
async function resolvePushContactId(eventId: string): Promise<string | null> {
  resumeContactShareWatch();
  if (eventId) {
    await catchUpGiftWrapByEventId(eventId);
  }
  // catchUpGiftWraps === catchUpContactShares (alias) — one force catch-up is enough.
  await catchUpGiftWraps({ force: true });

  if (eventId) {
    const msg = findMessageByNostrEventId(eventId);
    if (msg?.contactId) return msg.contactId;
  }
  const unread = listUnreadChatThreads();
  if (unread.length === 1) return unread[0]!.contactId;
  return null;
}

/**
 * Navigate under AppLockGate overlay — user unlocks first, then sees the screen.
 * Retries cover cold-start nav-not-ready and post-biometric paint.
 */
async function handleWakeNavigation(
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>,
  data?: Record<string, unknown>,
): Promise<void> {
  const eventId = readEventId(data);
  let contactId: string | null = null;
  try {
    contactId = await resolvePushContactId(eventId);
  } catch (e) {
    console.warn("[basic] push resolve contact", e);
  }

  const go = () => {
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
  };

  go();
  setTimeout(go, 400);
  setTimeout(go, 1_200);
  // After unlock + catch-up race: retry once more if eventId landed late.
  if (eventId) {
    setTimeout(() => {
      const msg = findMessageByNostrEventId(eventId);
      if (msg?.contactId) {
        contactId = msg.contactId;
      }
      go();
    }, 2_500);
  }
}

/**
 * Call once when the root navigator mounts (wallet session).
 * Sets up tap → Chat thread (or Pay hub) + gift-wrap catch-up; refreshes registration if opt-in.
 */
export function bindPushNotificationListeners(
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>,
): () => void {
  if (Platform.OS !== "android") {
    return () => undefined;
  }
  ensureHandler();

  if (!responseSub) {
    responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as
        | Record<string, unknown>
        | undefined;
      const wake = data?.["basic.wake"] ?? data?.basicWake;
      if (wake === "nostr" || wake == null) {
        void handleWakeNavigation(navigationRef, data);
      }
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
        const data = last.notification.request.content.data as
          | Record<string, unknown>
          | undefined;
        const wake = data?.["basic.wake"] ?? data?.basicWake;
        if (wake === "nostr" || last.notification.request.content.data) {
          void handleWakeNavigation(navigationRef, data);
        }
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
    if (tokenRefreshTimer) {
      clearTimeout(tokenRefreshTimer);
      tokenRefreshTimer = null;
    }
  };
}
