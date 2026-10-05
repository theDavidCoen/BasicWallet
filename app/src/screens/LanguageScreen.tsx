/**
 * Settings → Language — system default or pin en / it / pt.
 */

import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ScreenChrome } from "../components/ScreenChrome";
import { useI18n, type LanguagePreference } from "../i18n";
import { resolveDeviceLocale } from "../i18n/languagePrefs";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

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
      <Text style={ui.title}>{t("settings.languageTitle")}</Text>
      <Text style={ui.caption}>{t("settings.languageCaption")}</Text>

      {rows.map((row) => {
        const selected = preference === row.preference;
        const label = t(row.labelKey);
        return (
          <Pressable
            key={row.preference}
            style={styles.row}
            onPress={() => void onSelect(row.preference)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            disabled={saving}
          >
            <View style={styles.rowText}>
              <Text style={styles.label}>
                {label}
              </Text>
              {row.hint ? (
                <Text style={styles.hint} numberOfLines={2}>
                  {row.hint}
                </Text>
              ) : null}
            </View>
            <Text style={styles.check}>{selected ? "✓" : ""}</Text>
          </Pressable>
        );
      })}

      <Text style={styles.footer}>
        {locale.toUpperCase()}
      </Text>
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
    gap: 12,
  },
  rowText: { flex: 1, paddingRight: 8 },
  label: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 16,
    color: colors.fg,
  },
  hint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    marginTop: 4,
    lineHeight: 16,
  },
  check: {
    fontFamily: "JetBrainsMono_700Bold",
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
