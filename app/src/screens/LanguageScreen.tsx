/**
 * Settings → Language — system default or pin en / it / pt.
 */

import { useCallback, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ScreenChrome } from "../components/ScreenChrome";
import { Caption, ScreenTitle, SettingsRow } from "../components/ui";
import { useI18n, type LanguagePreference } from "../i18n";
import { resolveDeviceLocale } from "../i18n/languagePrefs";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";

type Row = {
  preference: LanguagePreference;
  labelKey: string;
  hint?: string;
};

export function LanguageScreen() {
  const { t, preference, setPreference, locale } = useI18n();
  const [saving, setSaving] = useState(false);
  const deviceLocale = resolveDeviceLocale();

  useFocusEffect(
    useCallback(() => {
      /* preference comes from provider; focus keeps screen in sync after remount */
    }, [preference]),
  );

  const rows: Row[] = [
    {
      preference: "system",
      labelKey: "settings.systemDefault",
      hint: t("settings.systemDefaultHint") + ` (${deviceLocale.toUpperCase()})`,
    },
    { preference: "en", labelKey: "settings.english" },
    { preference: "it", labelKey: "settings.italian" },
    { preference: "pt", labelKey: "settings.portuguese" },
  ];

  const onSelect = async (next: LanguagePreference) => {
    if (next === preference || saving) return;
    setSaving(true);
    try {
      await setPreference(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenChrome logoScale={0.77}>
      <ScreenTitle>{t("settings.languageTitle")}</ScreenTitle>
      <Caption>{t("settings.languageCaption")}</Caption>

      {rows.map((row) => {
        const selected = preference === row.preference;
        const label = t(row.labelKey);
        return (
          <SettingsRow
            key={row.preference}
            label={label}
            hint={row.hint}
            disabled={saving}
            onPress={() => void onSelect(row.preference)}
            right={<Text style={styles.check}>{selected ? "✓" : ""}</Text>}
          />
        );
      })}

      <Text style={styles.footer}>
        {locale.toUpperCase()}
      </Text>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  check: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.fg,
    width: 24,
    textAlign: "center",
  },
  footer: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    textAlign: "center",
    marginTop: 24,
  },
});
