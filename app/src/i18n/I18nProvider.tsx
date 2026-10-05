import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { TranslateOptions } from "i18n-js";
import { i18n, setI18nLocale } from "./i18n";
import {
  readLanguagePreference,
  resolveActiveLocale,
  writeLanguagePreference,
} from "./languagePrefs";
import type { AppLocale, LanguagePreference } from "./types";

type I18nContextValue = {
  ready: boolean;
  /** Resolved locale used for strings (never "system"). */
  locale: AppLocale;
  /** Stored preference including system. */
  preference: LanguagePreference;
  t: (scope: string, options?: TranslateOptions) => string;
  setPreference: (preference: LanguagePreference) => Promise<void>;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [preference, setPreferenceState] = useState<LanguagePreference>("system");
  const [locale, setLocale] = useState<AppLocale>("en");
  /** Bump to force re-render of consumers when locale changes. */
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const settings = await readLanguagePreference();
      if (cancelled) return;
      const active = resolveActiveLocale(settings.preference);
      setI18nLocale(active);
      setPreferenceState(settings.preference);
      setLocale(active);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback(async (next: LanguagePreference) => {
    await writeLanguagePreference(next);
    const active = resolveActiveLocale(next);
    setI18nLocale(active);
    setPreferenceState(next);
    setLocale(active);
    setTick((n) => n + 1);
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    void tick;
    return {
      ready,
      locale,
      preference,
      t: (scope, options) => i18n.t(scope, options),
      setPreference,
    };
  }, [ready, locale, preference, setPreference, tick]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}
