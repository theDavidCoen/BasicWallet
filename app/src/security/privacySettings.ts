/**
 * Penpot 05c Privacy preferences.
 * Biometrics lock gates app open; also unlocks Path C backup passphrase into RAM.
 * App PIN is optional unlock fallback (01f) — configured separately.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "basic.wallet.privacy.v1";
/** One-shot: old defaults had blockScreenshots on; turn off unless user re-enables later. */
const BLOCK_SHOTS_DEFAULT_OFF_MIGRATION = "basic.wallet.privacy.blockScreenshotsDefaultOff.v1";

export type PrivacySettings = {
  /** Require biometrics when opening the app (01e). App PIN is optional fallback. */
  biometricsLock: boolean;
  /** FLAG_SECURE-style: block screenshots while app is open. */
  blockScreenshots: boolean;
};

const DEFAULTS: PrivacySettings = {
  biometricsLock: true,
  blockScreenshots: false,
};

export async function readPrivacySettings(): Promise<PrivacySettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    let settings: PrivacySettings;
    if (!raw) {
      settings = { ...DEFAULTS };
    } else {
      const parsed = JSON.parse(raw) as Partial<PrivacySettings>;
      settings = {
        biometricsLock: parsed.biometricsLock !== false,
        // Opt-in only — missing / undefined stays off.
        blockScreenshots: parsed.blockScreenshots === true,
      };
    }
    const migrated = await AsyncStorage.getItem(BLOCK_SHOTS_DEFAULT_OFF_MIGRATION);
    if (!migrated) {
      await AsyncStorage.setItem(BLOCK_SHOTS_DEFAULT_OFF_MIGRATION, "1");
      if (settings.blockScreenshots) {
        settings = { ...settings, blockScreenshots: false };
        await AsyncStorage.setItem(KEY, JSON.stringify(settings));
      }
    }
    return settings;
  } catch {
    return { ...DEFAULTS };
  }
}

export async function writePrivacySettings(next: PrivacySettings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}

export async function patchPrivacySettings(
  patch: Partial<PrivacySettings>,
): Promise<PrivacySettings> {
  const cur = await readPrivacySettings();
  const next = { ...cur, ...patch };
  await writePrivacySettings(next);
  return next;
}
