import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
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
      <Text style={ui.title}>SECURE THIS DEVICE</Text>
      <Text style={ui.caption}>
        Basic needs a way to confirm it&apos;s you.{"\n"}
        OS biometrics are recommended.
      </Text>

      <View style={ui.card}>
        <Text style={ui.cardTitle}>OS Face ID / fingerprint</Text>
        <Text style={[ui.caption, { textAlign: "left", marginBottom: 12 }]}>
          {bioAvailable
            ? "Enabled on this device. Preferred unlock."
            : "Not enabled. Turn them on in system settings for faster, safer unlock."}
        </Text>
        {!bioAvailable ? (
          <Pressable
            style={styles.secondary}
            onPress={() => void openOsSecuritySettings()}
          >
            <Text style={styles.secondaryText}>Open system settings</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={pinSet ? ui.card : ui.cardMuted}>
        <Text style={ui.cardTitle}>App PIN</Text>
        <Text style={[ui.caption, { textAlign: "left", marginBottom: 12 }]}>
          {bioAvailable
            ? pinSet
              ? "Set · fallback when biometrics fail."
              : "Optional while OS biometrics are on."
            : pinSet
              ? "Set · required until OS biometrics are enabled."
              : "Required while OS biometrics are off."}
        </Text>
        {!pinSet ? (
          <Pressable
            style={styles.secondary}
            onPress={() =>
              navigation.navigate("SetAppPin", {
                intent: "onboarding",
                continueTo,
              })
            }
          >
            <Text style={styles.secondaryText}>Set App PIN</Text>
          </Pressable>
        ) : (
          <Text style={styles.ok}>PIN ready</Text>
        )}
      </View>

      <Pressable
        style={[ui.primaryBtn, { marginTop: 28 }, (busy || !canProceed) && { opacity: 0.5 }]}
        disabled={busy || !canProceed}
        onPress={() => void onContinue()}
      >
        {busy ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={ui.primaryBtnText}>Continue</Text>
        )}
      </Pressable>

      {!canProceed ? (
        <Text style={[ui.hint, { marginTop: 16 }]}>
          Enable OS biometrics or set an App PIN to continue.
        </Text>
      ) : null}
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  secondary: {
    borderWidth: 1,
    borderColor: colors.fg,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.fg,
  },
  ok: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
  },
});
