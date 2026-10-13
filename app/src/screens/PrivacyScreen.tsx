import { useCallback, useState } from "react";
import { Switch } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import * as ScreenCapture from "expo-screen-capture";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { Caption, ScreenTitle, SettingsRow } from "../components/ui";
import { useI18n } from "../i18n";
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

/** Privacy — biometrics lock · app PIN · block screenshots. */
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
        <ScreenTitle>{t("privacy.title")}</ScreenTitle>
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
      <ScreenTitle>{t("privacy.title")}</ScreenTitle>
      <Caption>{t("privacy.caption")}</Caption>

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
        <SettingsRow
          label={t("privacy.enableOsBiometrics")}
          hint={t("privacy.enableOsBiometricsHint")}
          onPress={() => void openOsSecuritySettings()}
        />
      ) : null}

      <SettingsRow
        label={t("privacy.appPin")}
        hint={
          pinSet
            ? osBio?.available
              ? t("privacy.appPinSetBioOn")
              : t("privacy.appPinSetBioOff")
            : osBio?.available
              ? t("privacy.appPinUnsetBioOn")
              : t("privacy.appPinUnsetBioOff")
        }
        onPress={() =>
          navigation.navigate("SetAppPin", { intent: pinSet ? "change" : "set" })
        }
      />

      {pinSet ? (
        <SettingsRow
          label={t("privacy.removeAppPin")}
          hint={
            osBio?.available
              ? t("privacy.removeAppPinHintBioOn")
              : t("privacy.removeAppPinHintBioOff")
          }
          onPress={() => navigation.navigate("SetAppPin", { intent: "remove" })}
        />
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
    <SettingsRow
      label={label}
      hint={hint}
      onPress={() => onChange(!value)}
      right={
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ false: colors.border, true: colors.fg }}
          thumbColor={colors.onPrimary}
        />
      }
    />
  );
}
