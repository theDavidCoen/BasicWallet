/**
 * Penpot 05b Display currencies — toggles under Home sats balance.
 */

import { useCallback, useState } from "react";
import { Switch } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ScreenChrome } from "../components/ScreenChrome";
import { Caption, ScreenTitle, SettingsRow } from "../components/ui";
import { useI18n } from "../i18n";
import {
  DISPLAY_CURRENCY_CODES,
  readDisplayCurrencies,
  setDisplayCurrencyEnabled,
  type DisplayCurrencyCode,
  type DisplayCurrencySettings,
} from "../settings/displayCurrencies";
import { colors } from "../theme/colors";

export function DisplayCurrenciesScreen() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<DisplayCurrencySettings | null>(null);

  useFocusEffect(
    useCallback(() => {
      void readDisplayCurrencies().then(setSettings);
    }, []),
  );

  const toggle = async (code: DisplayCurrencyCode, on: boolean) => {
    const next = await setDisplayCurrencyEnabled(code, on);
    setSettings(next);
  };

  return (
    <ScreenChrome logoScale={0.77}>
      <ScreenTitle>{t("settings.currenciesTitle")}</ScreenTitle>
      <Caption>{t("settings.currenciesCaption")}</Caption>

      {DISPLAY_CURRENCY_CODES.map((code) => {
        const on = settings?.enabled.includes(code) ?? false;
        return (
          <SettingsRow
            key={code}
            label={code}
            onPress={() => void toggle(code, !on)}
            right={
              <Switch
                value={on}
                onValueChange={(v) => void toggle(code, v)}
                trackColor={{ false: colors.border, true: colors.fg }}
                thumbColor={colors.onPrimary}
              />
            }
          />
        );
      })}
    </ScreenChrome>
  );
}
