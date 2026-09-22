import { useNavigation } from "@react-navigation/native";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Passkeys from "react-native-passkeys";
import type { RootNav } from "../navigation/types";
import { BasicLogo } from "../components/BasicLogo";
import { colors } from "../theme/colors";
import { PasskeyPrfUnavailableError } from "../onboarding/passkeyPrf";
import { needsOnboardingSecurityGate } from "../security/onboardingSecurityGate";
import type { OnboardingContinueTo } from "../security/onboardingSecurityGate";

/**
 * Penpot `11 Onboarding Create` (390×844):
 * logo y≈180 scale 1.1 · taglines y≈300 · CTAs y≈400/468 · restore y≈780.
 * Logo is centered (Penpot places it slightly left; we center on purpose).
 */
const PENPOT = {
  frameH: 844,
  logoY: 180,
  tagY: 300,
  btn1Y: 400,
  btn2Y: 468,
  footerY: 780,
  btnH: 52,
  logoScale: 1.7,
} as const;

/** Matches BasicLogo height math (VIEW_H * 0.55 * scale). */
const LOGO_H = Math.round(62 * 0.55 * PENPOT.logoScale);

export function OnboardingCreateScreen() {
  const navigation = useNavigation<RootNav>();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  async function goCreate(continueTo: OnboardingContinueTo) {
    if (await needsOnboardingSecurityGate()) {
      navigation.navigate("OnboardingSecurity", { continueTo });
      return;
    }
    if (continueTo === "restore") {
      navigation.navigate("RestoreWallet", { mode: "full" });
      return;
    }
    navigation.navigate("TermsOfUse", {
      mode: continueTo === "passkey" ? "passkey" : "device-only",
    });
  }

  async function onContinuePasskey() {
    setBusy(true);
    try {
      if (!Passkeys.isSupported()) {
        throw new PasskeyPrfUnavailableError(
          "Passkeys are not supported on this device. Need platform Credential Manager / iCloud Keychain.",
        );
      }
      await goCreate("passkey");
    } catch (e) {
      if (e instanceof PasskeyPrfUnavailableError) {
        Alert.alert(
          "Passkey PRF",
          e.message + "\n\nUse Continue without passkey for Advanced Backup, or Restore.",
        );
      } else {
        Alert.alert("Error", e instanceof Error ? e.message : "Passkey failed");
      }
    } finally {
      setBusy(false);
    }
  }

  const logoMarginTop = Math.max(24, PENPOT.logoY - insets.top);
  const tagMarginTop = PENPOT.tagY - PENPOT.logoY - LOGO_H;
  const btnMarginTop = PENPOT.btn1Y - PENPOT.tagY - 48;
  const btnGap = PENPOT.btn2Y - PENPOT.btn1Y - PENPOT.btnH;

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top,
          paddingBottom: Math.max(insets.bottom, 12) + 8,
        },
      ]}
    >
      <View style={[styles.logoWrap, { marginTop: logoMarginTop }]}>
        <BasicLogo scale={PENPOT.logoScale} />
      </View>

      <Text style={[styles.tagline, { marginTop: Math.max(16, tagMarginTop) }]}>
        Your payments app.{"\n"}
        No seed phrase in setup.{"\n"}
        OS passkey + multi-cloud backups.
      </Text>

      <View style={{ marginTop: Math.max(24, btnMarginTop) }}>
        <Pressable
          style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
          disabled={busy}
          onPress={() => void onContinuePasskey()}
        >
          {busy ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.primaryBtnText}>Continue</Text>
          )}
        </Pressable>

        <Text
          style={[styles.textLink, { marginTop: Math.max(16, btnGap) }]}
          onPress={() => void goCreate("device-only")}
        >
          Continue without passkey
        </Text>
      </View>

      <View style={{ flex: 1 }} />

      <Text
        style={styles.footer}
        onPress={() => void goCreate("restore")}
      >
        Seed phrase or nsec? Restore here.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    // Penpot buttons: x=28, w=334 on 390 → 28px side inset
    paddingHorizontal: 28,
  },
  logoWrap: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  tagline: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 19, // ~1.35 × 14
  },
  primaryBtn: {
    backgroundColor: colors.fg,
    borderRadius: 10,
    minHeight: PENPOT.btnH,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 16,
    color: "#000000",
  },
  textLink: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
    textAlign: "center",
    paddingVertical: 8,
  },
  footer: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
    textAlign: "center",
    // Penpot restore ≈ y 780 → ~40px above frame bottom before system inset
    paddingBottom: 8,
  },
});
