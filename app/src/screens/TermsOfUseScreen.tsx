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
import { mnemonicFromEntropy, randomEntropy32 } from "../onboarding/mnemonicFromEntropy";
import { requireUserPresence } from "../security/userPresence";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";
import { setMnemonicSource } from "../wallet/mnemonicMeta";
import { useWallet } from "../wallet/WalletProvider";

/** Shared onboarding Terms of Use body (passkey + device-only). */
export const TERMS_OF_USE_BODY =
  "You alone control your keys and backups.\n" +
  "If you lose them with no backup, your bitcoin is gone.\n\n" +
  "Imported wallets are not automatically synced. Set up a Nostr or Home Server backup sync.\n\n" +
  "Basic is zero-knowledge:\n" +
  "• We cannot see your balances or transactions\n" +
  "• We cannot move, freeze, or recover your funds\n" +
  "• We cannot reset a lost passkey or passphrase\n" +
  "• We never store your seed or mnemonic";

export function TermsOfUseScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "TermsOfUse">>();
  const { provisionFromMnemonic } = useWallet();
  const [busy, setBusy] = useState(false);
  const mode = route.params.mode;
  const isPasskey = mode === "passkey";
  const isDev = mode === "dev-csprng";
  const isDeviceOnly = mode === "device-only" || isDev;

  async function onContinue() {
    if (mode === "device-only") {
      // Mark install intent immediately so Add Wallet caption is correct
      // even before Advanced Backup provisions the seed.
      await setMnemonicSource("device-only");
      navigation.navigate("AdvancedBackup");
      return;
    }

    if (isPasskey) {
      // Detect first (cross-device). PasskeyProgress also offers create when needed.
      navigation.navigate("PasskeyProgress", { mode: "detect" });
      return;
    }

    setBusy(true);
    try {
      if (isDev) {
        const auth = await requireUserPresence("Confirm device unlock to create a dev wallet");
        if (!auth.ok) {
          Alert.alert("Authentication required", auth.reason);
          return;
        }
        const entropy = await randomEntropy32();
        const mnemonic = mnemonicFromEntropy(entropy);
        await provisionFromMnemonic(mnemonic, "dev-csprng");
      }

      navigation.replace("Ready");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      Alert.alert("Could not open wallet", msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={ui.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={ui.title}>TERMS OF USE</Text>
        <Text style={ui.caption}>
          {isPasskey
            ? "Passkey syncs across your devices.\nRead before you continue."
            : "This wallet stays on this device unless\nyou add another backup."}
        </Text>

        {isPasskey ? (
          <View style={ui.card}>
            <Text style={ui.cardTitle}>Across your devices</Text>
            <Text style={ui.caption}>
              iCloud Keychain, Google Password{"\n"}Manager, or 3rd party password manager.
            </Text>
          </View>
        ) : (
          <View style={ui.cardMuted}>
            <Text style={ui.cardTitle}>This device only</Text>
            <Text style={ui.caption}>
              Dies with the phone. Enable cloud sync{"\n"}or export 24 words / Nostr package.
            </Text>
          </View>
        )}

        {isDev ? (
          <Text style={[ui.hint, { marginTop: 12 }]}>
            DEV: CSPRNG entropy (not passkey PRF). Mnemonic goes to Keystore only.
          </Text>
        ) : null}

        <View style={styles.termsBlock}>
          <Text style={styles.termsHeading}>Your responsibilities</Text>
          <Text style={styles.termsBody}>{TERMS_OF_USE_BODY}</Text>
        </View>

        {isDeviceOnly && !isDev ? (
          <Text style={[ui.hint, { marginTop: 16 }]}>
            Never mark “safe” without another{"\n"}backup path (Nostr / home server / 24 words).
          </Text>
        ) : null}

        <Pressable
          style={[ui.primaryBtn, { marginTop: 28 }, busy && { opacity: 0.6 }]}
          disabled={busy}
          onPress={() => void onContinue()}
        >
          {busy ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={ui.primaryBtnText}>I understand · Continue</Text>
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
