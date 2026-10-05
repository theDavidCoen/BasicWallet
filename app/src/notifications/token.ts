import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { PAY_NOTIFICATION_CHANNEL_ID } from "./config";

let cachedToken: string | null = null;

export function lastKnownFcmToken(): string | null {
  return cachedToken;
}

/** Android 13+ POST_NOTIFICATIONS + channel. No-op on non-Android. */
export async function ensureAndroidNotificationPermission(): Promise<{
  granted: boolean;
  status: Notifications.PermissionStatus;
}> {
  if (Platform.OS !== "android") {
    return { granted: false, status: Notifications.PermissionStatus.DENIED };
  }

  try {
    await Notifications.setNotificationChannelAsync(PAY_NOTIFICATION_CHANNEL_ID, {
      name: "Pay messages",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180],
      lightColor: "#FFFFFF",
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  } catch (e) {
    console.warn("[basic] notification channel", e);
  }

  const current = await Notifications.getPermissionsAsync();
  if (current.granted || current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return { granted: true, status: current.status };
  }
  const asked = await Notifications.requestPermissionsAsync();
  return { granted: Boolean(asked.granted), status: asked.status };
}

/**
 * Native FCM device token (not Expo push token).
 * Requires google-services.json in a production/dev-client build.
 */
export async function getAndroidFcmToken(): Promise<string | null> {
  if (Platform.OS !== "android") return null;
  try {
    const device = await Notifications.getDevicePushTokenAsync();
    if (device?.type === "fcm" && typeof device.data === "string" && device.data.length > 0) {
      cachedToken = device.data;
      return cachedToken;
    }
    // Some builds may return the token string under data without type — accept string.
    if (typeof device?.data === "string" && device.data.length > 20) {
      cachedToken = device.data;
      return cachedToken;
    }
    return null;
  } catch (e) {
    console.warn("[basic] getDevicePushTokenAsync failed", e);
    return null;
  }
}

export async function getPermissionStatus(): Promise<Notifications.PermissionStatus | "unavailable"> {
  if (Platform.OS !== "android") return "unavailable";
  try {
    const p = await Notifications.getPermissionsAsync();
    return p.status;
  } catch {
    return "unavailable";
  }
}
