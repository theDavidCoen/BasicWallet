import { I18n, type TranslateOptions } from "i18n-js";
import { catalogs } from "./catalog";
import type { AppLocale } from "./types";

export const i18n = new I18n(catalogs);

i18n.defaultLocale = "en";
i18n.locale = "en";
i18n.enableFallback = true;
i18n.missingBehavior = "message";

export function setI18nLocale(locale: AppLocale): void {
  i18n.locale = locale;
}

export type TranslateFn = (scope: string, options?: TranslateOptions) => string;

/** Imperative translate (non-React). Prefer useI18n().t in components. */
export function t(scope: string, options?: TranslateOptions): string {
  return i18n.t(scope, options);
}
