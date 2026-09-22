import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import * as ScreenCapture from "expo-screen-capture";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { hasAppPin } from "../security/appPin";
import {
  getOsBiometricsStatus,
  openOsSecuritySettings,
  type OsBiometricsStatus,
} from "../security/osBiometrics";
import {
  patchPrivacySettings,
  readPrivacySettings,
  type PrivacySettings,
} from "../security/privacySettings";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

/** Penpot 05c Privacy — biometrics lock · app PIN · block screenshots. */
export function PrivacyScreen() {
  const navigation = useNavigation<RootNav>();
  const [settings, setSettings] = useState<PrivacySettings | null>(null);
  const [pinSet, setPinSet] = useState(false);
  const [osBio, setOsBio] = useState<OsBiometricsStatus | null>(null);

  const reload = useCallback(() => {
    void (async () => {
      setSettings(await readPrivacySettings());
      setPinSet(await hasAppPin());
      setOsBio(await getOsBiometricsStatus());
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const apply = useCallback(async (patch: Partial<PrivacySettings>) => {
    const next = await patchPrivacySettings(patch);
    setSettings(next);
    if (patch.blockScreenshots !== undefined) {
      try {
        if (next.blockScreenshots) await ScreenCapture.preventScreenCaptureAsync();
        else await ScreenCapture.allowScreenCaptureAsync();
      } catch (e) {
        console.warn("[basic] screen capture toggle", e);
      }
    }
  }, []);

  if (!settings) {
    return (
      <ScreenChrome logoScale={0.77}>
        <Text style={ui.title}>PRIVACY</Text>
      </ScreenChrome>
    );
  }

  const osBioHint = !osBio
    ? "Checking device…"
    : osBio.available
      ? "OS Face ID / fingerprint: on"
      : osBio.hasHardware
        ? "OS biometrics: off — enable in system settings (recommended)"
        : "This device has no biometric hardware — use App PIN";

  return (
    <ScreenChrome logoScale={0.77}>
      <Text style={ui.title}>PRIVACY</Text>
      <Text style={ui.caption}>
        Unlock also opens Nostr backup sync{"\n"}for this session.
      </Text>

      <ToggleRow
        label="Biometrics lock"
        hint={
          osBio?.available
            ? "Require biometrics when opening the app"
            : `${osBioHint}. App PIN unlocks when biometrics are off.`
        }
        value={settings.biometricsLock}
        onChange={(v) => void apply({ biometricsLock: v })}
      />

      {osBio && !osBio.available ? (
        <Pressable style={styles.row} onPress={() => void openOsSecuritySettings()}>
          <View style={styles.rowText}>
            <Text style={styles.label}>Enable OS biometrics</Text>
            <Text style={styles.hint}>
              Recommended. Opens system settings so you can enroll Face ID / fingerprint.
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ) : null}

      <Pressable
        style={styles.row}
        onPress={() =>
          navigation.navigate("SetAppPin", { intent: pinSet ? "change" : "set" })
        }
      >
        <View style={styles.rowText}>
          <Text style={styles.label}>App PIN</Text>
          <Text style={styles.hint}>
            {pinSet
              ? osBio?.available
                ? "Set · tap to change. Unlock fallback when biometrics fail."
                : "Set · required while OS biometrics are off."
              : osBio?.available
                ? "Not set · optional fallback when biometrics fail"
                : "Not set · required while OS biometrics are off"}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      {pinSet ? (
        <Pressable
          style={styles.row}
          onPress={() => navigation.navigate("SetAppPin", { intent: "remove" })}
        >
          <View style={styles.rowText}>
            <Text style={styles.label}>Remove app PIN</Text>
            <Text style={styles.hint}>
              {osBio?.available
                ? "Biometrics-only unlock after removal"
                : "Not recommended while OS biometrics are off"}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ) : null}

      <ToggleRow
        label="Block screenshots"
        hint="FLAG_SECURE while Basic is open"
        value={settings.blockScreenshots}
        onChange={(v) => void apply({ blockScreenshots: v })}
      />
    </ScreenChrome>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Pressable style={styles.row} onPress={() => onChange(!value)}>
      <View style={styles.rowText}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.fg }}
        thumbColor="#000000"
      />
    </Pressable>
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
  chevron: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 18,
    color: colors.hint,
  },
});
