/** Supported UI locales. `pt` = Portuguese (Brazilian-leaning wallet copy; see locales/pt/README.md). */
export const APP_LOCALES = ["en", "it", "pt"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

/** Persisted preference: follow OS or pin a locale. */
export type LanguagePreference = "system" | AppLocale;

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (APP_LOCALES as readonly string[]).includes(value);
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "system" || isAppLocale(value);
}
