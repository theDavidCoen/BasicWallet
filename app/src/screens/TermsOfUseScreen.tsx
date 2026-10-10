import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { useI18n } from "../i18n";
import { mnemonicFromEntropy, randomEntropy32 } from "../onboarding/mnemonicFromEntropy";
import { requireUserPresence } from "../security/userPresence";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";
import { setMnemonicSource } from "../wallet/mnemonicMeta";
import { useWallet } from "../wallet/WalletProvider";

export function TermsOfUseScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "TermsOfUse">>();
  const { t } = useI18n();
  const { provisionFromMnemonic } = useWallet();
  const [busy, setBusy] = useState(false);
  const mode = route.params.mode;
  const isPasskey = mode === "passkey";
  const isDev = mode === "dev-csprng";

  async function onContinue() {
    if (mode === "device-only") {
      // Mark install intent immediately so Add Wallet caption is correct
      // even before Advanced Backup provisions the seed.
      await setMnemonicSource("device-only");
      navigation.navigate("AdvancedBackup");
      return;
    }

    if (isPasskey) {
      // Detect first (cross-device). PasskeyProgress auto-creates when none found.
      navigation.navigate("PasskeyProgress", { mode: "detect" });
      return;
    }

    setBusy(true);
    try {
      if (isDev) {
        const auth = await requireUserPresence(t("onboarding.termsDevAuth"));
        if (!auth.ok) {
          Alert.alert(t("onboarding.termsAuthRequired"), auth.reason);
          return;
        }
        const entropy = await randomEntropy32();
        const mnemonic = mnemonicFromEntropy(entropy);
        await provisionFromMnemonic(mnemonic, "dev-csprng");
      }

      navigation.replace("Ready");
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("common.unknownError");
      Alert.alert(t("onboarding.passkeyOpenFailedTitle"), msg);
    } finally {
      setBusy(false);
    }
  }

  const responsibilitiesBody =
    t("onboarding.termsRespLine1") + "\n" + t("onboarding.termsRespLine2");

  const zkBody =
    t("onboarding.termsZkLine1") +
    "\n" +
    t("onboarding.termsZkLine2") +
    "\n" +
    t("onboarding.termsZkLine3") +
    "\n" +
    t("onboarding.termsZkLine4");

  return (
    <View style={ui.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={ui.title}>{t("onboarding.termsTitle")}</Text>

        {isPasskey ? (
          <View style={ui.card}>
            <Text style={ui.cardTitle}>{t("onboarding.termsAcrossTitle")}</Text>
            <Text style={[ui.caption, styles.cardBody]}>
              {t("onboarding.termsAcrossSync")}
              {"\n"}
              {t("onboarding.termsAcrossManagers")}
            </Text>
          </View>
        ) : (
          <View style={ui.cardMuted}>
            <Text style={ui.cardTitle}>{t("onboarding.termsDeviceOnlyTitle")}</Text>
            <Text style={[ui.caption, styles.cardBody]}>
              {t("onboarding.termsDeviceOnlyBody")}
              {"\n"}
              {t("onboarding.termsDeviceOnlyRisk")}
            </Text>
          </View>
        )}

        <View style={ui.card}>
          <Text style={ui.cardTitle}>{t("onboarding.termsZkTitle")}</Text>
          <Text style={[ui.caption, styles.cardBody]}>{zkBody}</Text>
        </View>

        {isDev ? (
          <Text style={[ui.hint, { marginTop: 12 }]}>{t("onboarding.termsDevHint")}</Text>
        ) : null}

        <View style={styles.termsBlock}>
          <Text style={styles.termsHeading}>{t("onboarding.termsReadBefore")}</Text>
          <Text style={styles.termsBody}>{responsibilitiesBody}</Text>
        </View>

        <Pressable
          style={[ui.primaryBtn, { marginTop: 28 }, busy && { opacity: 0.6 }]}
          disabled={busy}
          onPress={() => void onContinue()}
        >
          {busy ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={ui.primaryBtnText}>{t("onboarding.termsContinue")}</Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: 24,
  },
  cardBody: {
    textAlign: "left",
    marginBottom: 0,
  },
  termsBlock: {
    marginTop: 20,
    paddingHorizontal: 4,
  },
  termsHeading: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
    marginBottom: 10,
    textAlign: "center",
  },
  termsBody: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    lineHeight: 20,
    textAlign: "left",
  },
});
