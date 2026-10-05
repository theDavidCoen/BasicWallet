import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "basic.wallet.notifications.optIn.v1";

export type PushNotificationPrefs = {
  /** Master toggle — default off. */
  enabled: boolean;
  updatedAt: number;
};

const DEFAULT: PushNotificationPrefs = { enabled: false, updatedAt: 0 };

export async function readPushNotificationPrefs(): Promise<PushNotificationPrefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<PushNotificationPrefs>;
    return {
      enabled: Boolean(parsed.enabled),
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return { ...DEFAULT };
  }
}

export async function writePushNotificationPrefs(
  patch: Partial<PushNotificationPrefs>,
): Promise<PushNotificationPrefs> {
  const cur = await readPushNotificationPrefs();
  const next: PushNotificationPrefs = {
    enabled: patch.enabled !== undefined ? patch.enabled : cur.enabled,
    updatedAt: Date.now(),
  };
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
