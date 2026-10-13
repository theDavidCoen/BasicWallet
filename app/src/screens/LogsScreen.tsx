/**
 * Settings → Advanced → Logs — save CSV / share raw / clear.
 * Disk hydrate + export only run when the user taps a button (not on open).
 */

import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { Button, Caption, ScreenTitle } from "../components/ui";
import {
  buildAppLogsCsv,
  buildAppLogsRaw,
  clearAppLogs,
  defaultLogsFilename,
  ensureAppLogsHydrated,
  getAppLogCount,
} from "../diagnostics/appLog";
import { useI18n } from "../i18n";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";

const DANGER = "#E07070";

export function LogsScreen() {
  const navigation = useNavigation<RootNav>();
  const { t } = useI18n();
  const [busy, setBusy] = useState<"save" | "share" | "clear" | null>(null);

  async function onSaveCsv() {
    setBusy("save");
    try {
      await ensureAppLogsHydrated();
      if (getAppLogCount() === 0) {
        Alert.alert(t("logs.noLogsTitle"), t("logs.noLogsBody"));
        return;
      }
      const csv = buildAppLogsCsv();
      const filename = defaultLogsFilename("csv");
      await Share.share({
        message: csv,
        title: filename,
      });
    } catch (e) {
      Alert.alert(t("logs.saveFailed"), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onShareRaw() {
    setBusy("share");
    try {
      await ensureAppLogsHydrated();
      if (getAppLogCount() === 0) {
        Alert.alert(t("logs.noLogsTitle"), t("logs.noLogsBody"));
        return;
      }
      const raw = buildAppLogsRaw();
      const filename = defaultLogsFilename("log");
      await Share.share({
        message: raw,
        title: filename,
      });
    } catch (e) {
      Alert.alert(t("logs.shareFailed"), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function onClear() {
    Alert.alert(t("logs.clearTitle"), t("logs.clearBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("logs.clearAction"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusy("clear");
            try {
              await clearAppLogs();
              navigation.goBack();
            } catch (e) {
              Alert.alert(
                t("logs.clearFailed"),
                e instanceof Error ? e.message : String(e),
              );
              setBusy(null);
            }
          })();
        },
      },
    ]);
  }

  return (
    <ScreenChrome logoScale={0.77}>
      <ScreenTitle>{t("logs.title")}</ScreenTitle>
      <Caption>{t("logs.caption")}</Caption>

      <View style={styles.actions}>
        <Button
          busy={busy === "save"}
          disabled={busy != null}
          onPress={() => void onSaveCsv()}
        >
          {t("logs.save")}
        </Button>
        <Text style={styles.actionHint}>{t("logs.saveHint")}</Text>

        <Pressable
          style={[styles.secondary, busy != null && styles.disabled]}
          disabled={busy != null}
          onPress={() => void onShareRaw()}
        >
          {busy === "share" ? (
            <ActivityIndicator color={colors.fg} />
          ) : (
            <Text style={styles.secondaryText}>{t("logs.share")}</Text>
          )}
        </Pressable>
        <Text style={styles.actionHint}>{t("logs.shareHint")}</Text>

        <Pressable
          style={[styles.dangerBtn, busy != null && styles.disabled]}
          disabled={busy != null}
          onPress={onClear}
        >
          {busy === "clear" ? (
            <ActivityIndicator color={DANGER} />
          ) : (
            <Text style={styles.dangerText}>{t("logs.clear")}</Text>
          )}
        </Pressable>
      </View>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  actions: {
    marginTop: 28,
    gap: 8,
  },
  secondary: {
    marginTop: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 16,
    alignItems: "center",
  },
  secondaryText: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.fg,
  },
  dangerBtn: {
    marginTop: 24,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: DANGER,
    paddingVertical: 16,
    alignItems: "center",
  },
  dangerText: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: DANGER,
  },
  actionHint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.hint,
    textAlign: "center",
    marginBottom: 4,
  },
  disabled: { opacity: 0.6 },
});
