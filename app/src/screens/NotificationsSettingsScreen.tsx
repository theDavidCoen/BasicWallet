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
          ? "Android only"
          : status === "granted"
            ? "OS permission: granted"
            : status === "denied"
              ? "OS permission: denied — enable in system settings"
              : `OS permission: ${status}`,
      );
      setReady(true);
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const onToggle = useCallback(
    async (next: boolean) => {
      if (busy) return;
      if (Platform.OS !== "android") {
        Alert.alert("Android only", "Closed-app push ships on Android first. iOS later.");
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
            "Nostr identity required",
            "Create or import a Nostr identity first (Settings → Nostr identity).",
          );
          return;
        }

        const perm = await ensureAndroidNotificationPermission();
        if (!perm.granted) {
          Alert.alert(
            "Permission needed",
            "Allow notifications in system settings to wake Basic for Pay messages while the app is closed.",
          );
          setPermLabel("OS permission: denied — enable in system settings");
          return;
        }

        await writePushNotificationPrefs({ enabled: true });
        setEnabled(true);
        const reg = await registerPushWithNotifier();
        if (!reg.ok) {
          // Keep local opt-in so boot can retry; surface the blocker clearly.
          Alert.alert(
            "Registered locally",
            `Could not reach the notifier yet:\n${reg.reason}\n\nTray wake needs Firebase credentials + a deployed sidecar. Classic catch-up on open still works.`,
          );
        }
        reload();
      } finally {
        setBusy(false);
      }
    },
    [busy, reload],
  );

  if (!ready) {
    return (
      <ScreenChrome logoScale={0.77}>
        <Text style={ui.title}>NOTIFICATIONS</Text>
        <ActivityIndicator color={colors.fg} style={{ marginTop: 24 }} />
      </ScreenChrome>
    );
  }

  return (
    <ScreenChrome logoScale={0.77}>
      <Text style={ui.title}>NOTIFICATIONS</Text>
      <Text style={ui.caption}>
        Opt-in wake for Pay in Chat and contact share{"\n"}
        while Basic is closed. Off by default.
      </Text>

      <Pressable
        style={styles.row}
        onPress={() => void onToggle(!enabled)}
        disabled={busy || Platform.OS !== "android"}
      >
        <View style={styles.rowText}>
          <Text style={styles.label}>Closed-app alerts</Text>
          <Text style={styles.hint}>
            Opaque only (“New Pay message”). Never amounts, memos, or addresses.
            Classic Bitcoin receives still catch up when you open the app — no tray.
          </Text>
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
        <Text style={styles.meta}>Nostr identity: missing — required to register.</Text>
      ) : (
        <Text style={styles.meta}>Nostr identity: ready (npub registered in background).</Text>
      )}
      {Platform.OS !== "android" ? (
        <Text style={styles.meta}>This build is not Android — toggle disabled.</Text>
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
