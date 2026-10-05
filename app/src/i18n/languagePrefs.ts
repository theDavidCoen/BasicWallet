/**
 * Language preference (Settings → Language).
 * Default: follow OS locale; unsupported OS languages fall back to English.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import {
  isAppLocale,
  isLanguagePreference,
  type AppLocale,
  type LanguagePreference,
} from "./types";

const KEY = "basic.wallet.language.v1";

export type LanguageSettings = {
  preference: LanguagePreference;
};

const DEFAULTS: LanguageSettings = {
  preference: "system",
};

/** Map device language tags → supported app locale (else English). */
export function resolveDeviceLocale(): AppLocale {
  try {
    const locales = getLocales();
    for (const loc of locales) {
      const code = (loc.languageCode ?? "").toLowerCase();
      if (isAppLocale(code)) return code;
      // pt-BR / pt-PT → pt
      if (code.startsWith("pt")) return "pt";
      if (code.startsWith("it")) return "it";
      if (code.startsWith("en")) return "en";
    }
  } catch {
    /* native module unavailable in some test hosts */
  }
  return "en";
}

export function resolveActiveLocale(preference: LanguagePreference): AppLocale {
  if (preference === "system") return resolveDeviceLocale();
  return preference;
}

export async function readLanguagePreference(): Promise<LanguageSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<LanguageSettings>;
    if (isLanguagePreference(parsed.preference)) {
      return { preference: parsed.preference };
    }
    return { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function writeLanguagePreference(
  preference: LanguagePreference,
): Promise<LanguageSettings> {
  const next: LanguageSettings = { preference };
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
