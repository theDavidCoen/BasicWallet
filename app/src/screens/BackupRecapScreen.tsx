/**
 * Path C enable Recap — save nsec + passphrase before packaging.
 * Reveal Secrets under biometrics; only nsec is one-tap copy.
 */

import * as Clipboard from "expo-clipboard";
import * as ScreenCapture from "expo-screen-capture";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { mnemonicFromEntropy, randomEntropy32 } from "../onboarding/mnemonicFromEntropy";
import {
  enableEncryptedBackup,
  readCipherBlob,
} from "../nostr/backupPackage";
import {
  publishEncryptedBackupToRelays,
  rememberPublishMeta,
} from "../nostr/backupBroadcast";
import { ensureNostrIdentity, loadNostrKeyPairForCrypto } from "../nostr/identityStore";
import { uploadHomeBackupCipher } from "../nostr/homeServerWebdav";
import { requireUserPresence } from "../security/userPresence";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";
import { useWallet } from "../wallet/WalletProvider";

export function BackupRecapScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "BackupRecap">>();
  const params = route.params;
  const { hasWallet, provisionFromMnemonic, noteLocalSend } = useWallet();

  const [revealed, setRevealed] = useState(false);
  const [nsec, setNsec] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nsecRef = useRef<string | null>(null);

  const clearReveal = useCallback(() => {
    nsecRef.current = null;
    setNsec(null);
    setRevealed(false);
    void ScreenCapture.allowScreenCaptureAsync().catch(() => {});
  }, []);

  useEffect(() => {
    const onAppState = (next: AppStateStatus) => {
      if (next !== "active" && nsecRef.current) clearReveal();
    };
    const sub = AppState.addEventListener("change", onAppState);
    return () => {
      sub.remove();
      clearReveal();
    };
  }, [clearReveal]);

  async function onRevealSecrets() {
    if (revealed) {
      clearReveal();
      return;
    }
    try {
      const auth = await requireUserPresence("Confirm to reveal backup secrets");
      if (!auth.ok) {
        Alert.alert("Authentication required", "Secrets were not shown.");
        return;
      }
      await ensureNostrIdentity();
      const pair = await loadNostrKeyPairForCrypto();
      if (!pair?.nsec) {
        Alert.alert("No identity", "Could not load nsec.");
        return;
      }
      try {
        await ScreenCapture.preventScreenCaptureAsync();
      } catch (e) {
        console.warn("[basic] preventScreenCapture unavailable", e);
      }
      nsecRef.current = pair.nsec;
      setNsec(pair.nsec);
      setRevealed(true);
    } catch (e) {
      Alert.alert(
        "Could not reveal secrets",
        e instanceof Error ? e.message : "Unknown error",
      );
    }
  }

  async function onCopyNsec() {
    if (!nsec) return;
    await Clipboard.setStringAsync(nsec);
    Alert.alert("Copied", "nsec copied. Clear the clipboard when you are done.");
  }

  async function onEnable() {
    setBusy(true);
    try {
      const auth = await requireUserPresence(
        params.channel === "home"
          ? "Confirm to enable home server backup"
          : "Confirm to enable Nostr backup",
      );
      if (!auth.ok) {
        Alert.alert("Authentication required", "Backup was not enabled.");
        return;
      }

      noteLocalSend();
      await ensureNostrIdentity();

      if (!hasWallet) {
        const mnemonic = mnemonicFromEntropy(await randomEntropy32());
        await provisionFromMnemonic(mnemonic, "device-only");
      }

      await ensureNostrIdentity();

      if (params.channel === "nostr") {
        const relays = params.relays;
        if (!relays?.length) throw new Error("Missing relay list");
        const meta = await enableEncryptedBackup({
          channel: "nostr",
          passphrase: params.passphrase,
          relays,
        });
        try {
          const pub = await publishEncryptedBackupToRelays(meta.relays);
          await rememberPublishMeta(meta, pub);
        } catch (e) {
          console.warn("[basic] nostr publish after enable failed", e);
        }
      } else {
        if (!params.homeUrl?.trim()) throw new Error("Missing home server URL");
        const creds = {
          token: params.homeToken?.trim() || null,
          username: params.homeUser?.trim() || null,
          password: params.homePassword?.trim() || null,
        };
        const meta = await enableEncryptedBackup({
          channel: "home",
          passphrase: params.passphrase,
          homeUrl: params.homeUrl,
          homeToken: creds.token,
          homeUser: creds.username,
          homePassword: creds.password,
        });
        void meta;
        const blob = await readCipherBlob();
        if (!blob) throw new Error("Local backup package missing after enable");
        await uploadHomeBackupCipher(params.homeUrl, blob, creds);
      }

      clearReveal();
      navigation.replace("BackupEnabledSuccess", { channel: params.channel });
    } catch (e) {
      Alert.alert(
        "Could not enable backup",
        e instanceof Error ? e.message : "Unknown error",
      );
    } finally {
      setBusy(false);
    }
  }

  const enableLabel =
    params.channel === "home" ? "Enable Home Backup" : "Enable Nostr Backup";

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={ui.title}>BACKUP RECAP</Text>
        <Text style={ui.caption}>
          Save your nsec and backup passphrase offline.{"\n"}
          Together they encrypt your login package.{"\n"}
          Lose either and you can lose access to wallets restored from this backup.
        </Text>

        <Pressable
          style={styles.revealRow}
          onPress={() => void onRevealSecrets()}
          accessibilityRole="button"
          accessibilityLabel={
            revealed ? "Hide secrets" : "Reveal Secrets"
          }
        >
          <Text style={styles.revealLabel}>Reveal Secrets</Text>
          <Text style={styles.chevron}>{revealed ? "⌃" : "⌄"}</Text>
        </Pressable>

        {revealed && nsec ? (
          <View style={styles.secretsCard}>
            <Text style={styles.secretLabel}>nsec · tap to copy</Text>
            <Pressable
              onPress={() => void onCopyNsec()}
              accessibilityRole="button"
              accessibilityLabel="Copy nsec"
            >
              <Text style={styles.nsec} selectable={false}>
                {nsec}
              </Text>
            </Pressable>

            <Text style={[styles.secretLabel, { marginTop: 16 }]}>
              backup passphrase · copy manually
            </Text>
            <Text style={styles.passphrase} selectable>
              {params.passphrase}
            </Text>
          </View>
        ) : null}

        <Pressable
          style={[ui.primaryBtn, { marginTop: 28 }, busy && { opacity: 0.6 }]}
          disabled={busy}
          onPress={() => void onEnable()}
        >
          {busy ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={ui.primaryBtnText}>{enableLabel}</Text>
          )}
        </Pressable>
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  revealRow: {
    marginTop: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  revealLabel: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
  },
  chevron: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 18,
    color: colors.hint,
  },
  secretsCard: {
    marginTop: 12,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  secretLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
    marginBottom: 8,
  },
  nsec: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.fg,
    lineHeight: 20,
  },
  passphrase: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.fg,
    lineHeight: 22,
  },
});
