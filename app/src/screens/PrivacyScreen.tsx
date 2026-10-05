import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import * as ScreenCapture from "expo-screen-capture";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { AdaptiveText, useI18n } from "../i18n";
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
  const { t } = useI18n();
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
        <AdaptiveText style={ui.title} baseFontSize={20}>
          {t("privacy.title")}
        </AdaptiveText>
      </ScreenChrome>
    );
  }

  const osBioHint = !osBio
    ? t("privacy.checkingDevice")
    : osBio.available
      ? t("privacy.osBioOn")
      : osBio.hasHardware
        ? t("privacy.osBioOff")
        : t("privacy.osBioNone");

  return (
    <ScreenChrome logoScale={0.77}>
      <AdaptiveText style={ui.title} baseFontSize={20}>
        {t("privacy.title")}
      </AdaptiveText>
      <Text style={ui.caption}>{t("privacy.caption")}</Text>

      <ToggleRow
        label={t("privacy.biometricsLock")}
        hint={
          osBio?.available
            ? t("privacy.biometricsHintOn")
            : t("privacy.biometricsHintOff", { osBioHint })
        }
        value={settings.biometricsLock}
        onChange={(v) => void apply({ biometricsLock: v })}
      />

      {osBio && !osBio.available ? (
        <Pressable style={styles.row} onPress={() => void openOsSecuritySettings()}>
          <View style={styles.rowText}>
            <AdaptiveText style={styles.label} baseFontSize={15}>
              {t("privacy.enableOsBiometrics")}
            </AdaptiveText>
            <Text style={styles.hint}>{t("privacy.enableOsBiometricsHint")}</Text>
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
          <AdaptiveText style={styles.label} baseFontSize={15}>
            {t("privacy.appPin")}
          </AdaptiveText>
          <Text style={styles.hint}>
            {pinSet
              ? osBio?.available
                ? t("privacy.appPinSetBioOn")
                : t("privacy.appPinSetBioOff")
              : osBio?.available
                ? t("privacy.appPinUnsetBioOn")
                : t("privacy.appPinUnsetBioOff")}
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
            <AdaptiveText style={styles.label} baseFontSize={15}>
              {t("privacy.removeAppPin")}
            </AdaptiveText>
            <Text style={styles.hint}>
              {osBio?.available
                ? t("privacy.removeAppPinHintBioOn")
                : t("privacy.removeAppPinHintBioOff")}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ) : null}

      <ToggleRow
        label={t("privacy.blockScreenshots")}
        hint={t("privacy.blockScreenshotsHint")}
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
        <AdaptiveText style={styles.label} baseFontSize={15}>
          {label}
        </AdaptiveText>
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
