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
import { ui } from "../theme/ui";

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
      <Text style={ui.title}>{t("logs.title")}</Text>
      <Text style={ui.caption}>{t("logs.caption")}</Text>

      <View style={styles.actions}>
        <Pressable
          style={[styles.primary, busy != null && styles.disabled]}
          disabled={busy != null}
          onPress={() => void onSaveCsv()}
        >
          {busy === "save" ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.primaryText}>{t("logs.save")}</Text>
          )}
        </Pressable>
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
  primary: {
    backgroundColor: colors.fg,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 15,
    color: "#000",
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
    fontFamily: "JetBrainsMono_400Regular",
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
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 15,
    color: DANGER,
  },
  actionHint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    textAlign: "center",
    marginBottom: 4,
  },
  disabled: { opacity: 0.6 },
});
