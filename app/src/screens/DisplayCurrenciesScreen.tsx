/**
 * Penpot 05b Display currencies — toggles under Home sats balance.
 */

import { useCallback, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ScreenChrome } from "../components/ScreenChrome";
import { useI18n } from "../i18n";
import {
  DISPLAY_CURRENCY_CODES,
  readDisplayCurrencies,
  setDisplayCurrencyEnabled,
  type DisplayCurrencyCode,
  type DisplayCurrencySettings,
} from "../settings/displayCurrencies";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

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
      <Text style={ui.title}>{t("settings.currenciesTitle")}</Text>
      <Text style={ui.caption}>{t("settings.currenciesCaption")}</Text>

      {DISPLAY_CURRENCY_CODES.map((code) => {
        const on = settings?.enabled.includes(code) ?? false;
        return (
          <View key={code} style={styles.row}>
            <Text style={styles.label}>{code}</Text>
            <Switch
              value={on}
              onValueChange={(v) => void toggle(code, v)}
              trackColor={{ false: colors.border, true: colors.fg }}
              thumbColor="#000"
            />
          </View>
        );
      })}
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  label: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 16,
    color: colors.fg,
  },
});
