import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { Button, Caption, Hint, ScreenTitle } from "../components/ui";
import { useI18n } from "../i18n";
import { hasAppPin } from "../security/appPin";
import {
  getOsBiometricsStatus,
  openOsSecuritySettings,
} from "../security/osBiometrics";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

/**
 * Shown when OS biometrics are not enrolled: recommend enabling them, require App PIN.
 */
export function OnboardingSecurityScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "OnboardingSecurity">>();
  const { t } = useI18n();
  const continueTo = route.params.continueTo;
  const [busy, setBusy] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [pinSet, setPinSet] = useState(false);

  const refresh = useCallback(() => {
    void (async () => {
      const bio = await getOsBiometricsStatus();
      setBioAvailable(bio.available);
      setPinSet(await hasAppPin());
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  function goNext() {
    if (continueTo === "restore") {
      navigation.replace("RestoreWallet", { mode: "full" });
      return;
    }
    navigation.replace("TermsOfUse", {
      mode: continueTo === "passkey" ? "passkey" : "device-only",
    });
  }

  async function onContinue() {
    setBusy(true);
    try {
      const bio = await getOsBiometricsStatus();
      const pin = await hasAppPin();
      if (bio.available || pin) {
        goNext();
        return;
      }
      navigation.navigate("SetAppPin", {
        intent: "onboarding",
        continueTo,
      });
    } finally {
      setBusy(false);
    }
  }

  const canProceed = bioAvailable || pinSet;

  return (
    <ScreenChrome logoScale={0.77}>
      <ScreenTitle>{t("privacy.secureDeviceTitle")}</ScreenTitle>
      <Caption>{t("privacy.secureDeviceCaption")}</Caption>

      <View style={ui.card}>
        <Text style={ui.cardTitle}>
          {t("privacy.osFaceIdTitle")}
        </Text>
        <Text style={[ui.caption, { textAlign: "left", marginBottom: 12 }]}>
          {bioAvailable
            ? t("privacy.osBioEnabled")
            : t("privacy.osBioNotEnabled")}
        </Text>
        {!bioAvailable ? (
          <Button
            variant="secondary"
            style={{ marginTop: 0, paddingVertical: 12, borderColor: colors.fg }}
            textStyle={{ fontSize: 14 }}
            onPress={() => void openOsSecuritySettings()}
          >
            {t("privacy.openSystemSettings")}
          </Button>
        ) : null}
      </View>

      <View style={pinSet ? ui.card : ui.cardMuted}>
        <Text style={ui.cardTitle}>
          {t("privacy.appPin")}
        </Text>
        <Text style={[ui.caption, { textAlign: "left", marginBottom: 12 }]}>
          {bioAvailable
            ? pinSet
              ? t("privacy.appPinSetFallback")
              : t("privacy.appPinOptionalBioOn")
            : pinSet
              ? t("privacy.appPinSetRequired")
              : t("privacy.appPinRequiredBioOff")}
        </Text>
        {!pinSet ? (
          <Button
            variant="secondary"
            style={{ marginTop: 0, paddingVertical: 12, borderColor: colors.fg }}
            textStyle={{ fontSize: 14 }}
            onPress={() =>
              navigation.navigate("SetAppPin", {
                intent: "onboarding",
                continueTo,
              })
            }
          >
            {t("privacy.setAppPinCta")}
          </Button>
        ) : (
          <Text style={styles.ok}>{t("privacy.pinReady")}</Text>
        )}
      </View>

      <Button
        busy={busy}
        disabled={!canProceed}
        style={{ marginTop: 28 }}
        onPress={() => void onContinue()}
      >
        {t("common.continue")}
      </Button>

      {!canProceed ? (
        <Hint style={{ marginTop: 16 }}>{t("privacy.secureContinueHint")}</Hint>
      ) : null}
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  ok: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
  },
});
