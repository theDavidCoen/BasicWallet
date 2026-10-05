/**
 * Settings → Notifications (Android closed-app push).
 * Opt-in, default off. Opaque Pay / contact-share wake only.
 */

import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ScreenChrome } from "../components/ScreenChrome";
import { AdaptiveText, useI18n } from "../i18n";
import { hasNostrIdentity } from "../nostr/identityStore";
import {
  ensureAndroidNotificationPermission,
  getPermissionStatus,
  readPushNotificationPrefs,
  registerPushWithNotifier,
  unregisterPushBestEffort,
  writePushNotificationPrefs,
} from "../notifications";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

export function NotificationsSettingsScreen() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [hasIdentity, setHasIdentity] = useState(false);
  const [permLabel, setPermLabel] = useState("…");

  const reload = useCallback(() => {
    void (async () => {
      const prefs = await readPushNotificationPrefs();
      setEnabled(prefs.enabled);
      setHasIdentity(await hasNostrIdentity());
      const status = await getPermissionStatus();
      setPermLabel(
        status === "unavailable"
          ? t("notifications.permAndroidOnly")
          : status === "granted"
            ? t("notifications.permGranted")
            : status === "denied"
              ? t("notifications.permDenied")
              : t("notifications.permStatus", { status }),
      );
      setReady(true);
    })();
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const onToggle = useCallback(
    async (next: boolean) => {
      if (busy) return;
      if (Platform.OS !== "android") {
        Alert.alert(
          t("notifications.alertAndroidOnlyTitle"),
          t("notifications.alertAndroidOnlyBody"),
        );
        return;
      }
      setBusy(true);
      try {
        if (!next) {
          await writePushNotificationPrefs({ enabled: false });
          setEnabled(false);
          await unregisterPushBestEffort();
          return;
        }

        if (!(await hasNostrIdentity())) {
          Alert.alert(
            t("notifications.alertNostrRequiredTitle"),
            t("notifications.alertNostrRequiredBody"),
          );
          return;
        }

        const perm = await ensureAndroidNotificationPermission();
        if (!perm.granted) {
          Alert.alert(
            t("notifications.alertPermissionTitle"),
            t("notifications.alertPermissionBody"),
          );
          setPermLabel(t("notifications.permDenied"));
          return;
        }

        await writePushNotificationPrefs({ enabled: true });
        setEnabled(true);
        const reg = await registerPushWithNotifier();
        if (!reg.ok) {
          // Keep local opt-in so boot can retry; surface the blocker clearly.
          Alert.alert(
            t("notifications.alertRegisteredLocallyTitle"),
            t("notifications.alertRegisteredLocallyBody", {
              reason: reg.reason,
            }),
          );
        }
        reload();
      } finally {
        setBusy(false);
      }
    },
    [busy, reload, t],
  );

  if (!ready) {
    return (
      <ScreenChrome logoScale={0.77}>
        <AdaptiveText style={ui.title} baseFontSize={20}>
          {t("notifications.title")}
        </AdaptiveText>
        <ActivityIndicator color={colors.fg} style={{ marginTop: 24 }} />
      </ScreenChrome>
    );
  }

  return (
    <ScreenChrome logoScale={0.77}>
      <AdaptiveText style={ui.title} baseFontSize={20}>
        {t("notifications.title")}
      </AdaptiveText>
      <Text style={ui.caption}>{t("notifications.caption")}</Text>

      <Pressable
        style={styles.row}
        onPress={() => void onToggle(!enabled)}
        disabled={busy || Platform.OS !== "android"}
      >
        <View style={styles.rowText}>
          <AdaptiveText style={styles.label} baseFontSize={15}>
            {t("notifications.closedAppAlerts")}
          </AdaptiveText>
          <Text style={styles.hint}>{t("notifications.closedAppHint")}</Text>
        </View>
        {busy ? (
          <ActivityIndicator color={colors.fg} />
        ) : (
          <Switch
            value={enabled}
            onValueChange={(v) => void onToggle(v)}
            disabled={Platform.OS !== "android"}
            trackColor={{ false: colors.border, true: colors.fg }}
            thumbColor="#000000"
          />
        )}
      </Pressable>

      <Text style={styles.meta}>{permLabel}</Text>
      {!hasIdentity ? (
        <Text style={styles.meta}>{t("notifications.nostrMissing")}</Text>
      ) : (
        <Text style={styles.meta}>{t("notifications.nostrReady")}</Text>
      )}
      {Platform.OS !== "android" ? (
        <Text style={styles.meta}>{t("notifications.notAndroidBuild")}</Text>
      ) : null}
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowText: { flex: 1 },
  label: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 15,
    color: colors.fg,
  },
  hint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    marginTop: 4,
    lineHeight: 16,
  },
  meta: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    marginTop: 16,
    lineHeight: 18,
  },
});
