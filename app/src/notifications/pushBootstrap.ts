/**
 * Boot helpers for closed-app push (Android).
 * Reuses existing gift-wrap catch-up — does not start a second watcher.
 */

import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import type { NavigationContainerRefWithCurrent } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/types";
import { catchUpContactShares, resumeContactShareWatch } from "../contacts/contactShareWatch";
import { readPushNotificationPrefs } from "./prefs";
import { registerPushWithNotifier } from "./register";

let handlerSet = false;
let responseSub: Notifications.EventSubscription | null = null;
let tokenSub: Notifications.EventSubscription | null = null;

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

async function handleWakeNavigation(
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>,
): Promise<void> {
  // Existing demux — force catch-up after cold start from tray.
  resumeContactShareWatch();
  void catchUpContactShares({ force: true });

  const go = () => {
    if (!navigationRef.isReady()) return;
    try {
      navigationRef.navigate("PayHub");
    } catch (e) {
      console.warn("[basic] push navigate PayHub", e);
    }
  };
  go();
  // Cold start: nav may not be ready on first tick.
  setTimeout(go, 400);
}

/**
 * Call once when the root navigator mounts (wallet session).
 * Sets up tap → Pay hub + gift-wrap catch-up; refreshes registration if opt-in.
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
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      const wake = data?.["basic.wake"] ?? data?.basicWake;
      if (wake === "nostr" || wake == null) {
        // Treat unknown/opaque Pay channel taps as Nostr wake.
        void handleWakeNavigation(navigationRef);
      }
    });
  }

  if (!tokenSub) {
    tokenSub = Notifications.addPushTokenListener(() => {
      void (async () => {
        const prefs = await readPushNotificationPrefs();
        if (prefs.enabled) {
          const r = await registerPushWithNotifier();
          if (!r.ok) console.warn("[basic] push re-register on token refresh", r.reason);
        }
      })();
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
        const data = last.notification.request.content.data as Record<string, unknown> | undefined;
        const wake = data?.["basic.wake"] ?? data?.basicWake;
        if (wake === "nostr" || last.notification.request.content.data) {
          void handleWakeNavigation(navigationRef);
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
  };
}
