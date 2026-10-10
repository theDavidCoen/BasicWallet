/**
 * Path C enable Recap — save nsec + passphrase before packaging.
 * Reveal Secrets under biometrics; only nsec is one-tap copy.
 */

import * as Clipboard from "expo-clipboard";
import * as ScreenCapture from "expo-screen-capture";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
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
import { Button, Caption, ScreenTitle } from "../components/ui";
import { mnemonicFromEntropy, randomEntropy32 } from "../onboarding/mnemonicFromEntropy";
import {
  enableEncryptedBackup,
  readCipherBlob,
  sanitizeFiatPrefsBeforePack,
} from "../nostr/backupPackage";
import {
  publishEncryptedBackupToRelays,
  rememberPublishMeta,
} from "../nostr/backupBroadcast";
import {
  clearBackupPackageDirty,
  markBackupPackageDirty,
} from "../nostr/backupSync";
import { ensureNostrIdentity, loadNostrKeyPairForCrypto } from "../nostr/identityStore";
import { uploadHomeBackupCipher } from "../nostr/homeServerWebdav";
import { requireUserPresence } from "../security/userPresence";
import { useI18n } from "../i18n";
import { colors } from "../theme/colors";
import { useWallet } from "../wallet/WalletProvider";
import { listWallets } from "../account/walletRegistry";
import { getNetworkConfig } from "../config/network";
import { writeFiatModeState } from "../fiat/fiatModeStore";
import { hasMnemonic } from "../security/mnemonicStore";

export function BackupRecapScreen() {
  const navigation = useNavigation<RootNav>();
  const { t } = useI18n();
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
      const auth = await requireUserPresence(t("backup.confirmRevealSecrets"));
      if (!auth.ok) {
        Alert.alert(t("backup.authRequired"), t("backup.secretsNotShown"));
        return;
      }
      await ensureNostrIdentity();
      const pair = await loadNostrKeyPairForCrypto();
      if (!pair?.nsec) {
        Alert.alert(t("backup.noIdentityTitle"), t("backup.noIdentityBody"));
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
        t("backup.couldNotReveal"),
        e instanceof Error ? e.message : t("common.unknownError"),
      );
    }
  }

  async function onCopyNsec() {
    if (!nsec) return;
    await Clipboard.setStringAsync(nsec);
    Alert.alert(t("backup.copiedTitle"), t("backup.copiedNsecBody"));
  }

  async function onEnable() {
    setBusy(true);
    try {
      const auth = await requireUserPresence(
        params.channel === "home"
          ? t("backup.confirmEnableHome")
          : t("backup.confirmEnableNostr"),
      );
      if (!auth.ok) {
        Alert.alert(t("backup.authRequired"), t("backup.backupNotEnabled"));
        return;
      }

      noteLocalSend();
      await ensureNostrIdentity();

      const networkId = getNetworkConfig().id;
      let createdWallet = false;
      if (!hasWallet) {
        const mnemonic = mnemonicFromEntropy(await randomEntropy32());
        await provisionFromMnemonic(mnemonic, "device-only");
        createdWallet = true;
      }

      // Settle: Path C pack needs mnemonic-backed wallets. Recap used to pack
      // immediately after provision while openWallet raced in the background.
      const arkade = listWallets(networkId).filter((w) => w.kind === "arkade");
      const seeded: string[] = [];
      for (const w of arkade) {
        if (await hasMnemonic(w.id)) seeded.push(w.id);
      }
      if (!seeded.length) {
        throw new Error("No seed wallets ready to back up yet. Try Enable again.");
      }

      // New Recap-provisioned wallets must start with fiatMode off in the package.
      if (createdWallet) {
        for (const walletId of seeded) {
          await writeFiatModeState(
            networkId,
            walletId,
            {
              fiatMode: false,
              pendingJob: null,
              pendingEnterDisplay: null,
              lastSwapId: null,
              lastGoodDisplay: null,
              labelTouched: false,
            },
            { syncBackup: false },
          );
        }
      }
      await sanitizeFiatPrefsBeforePack(networkId, seeded);

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
          await clearBackupPackageDirty();
        } catch (e) {
          console.warn("[basic] nostr publish after enable failed", e);
          await markBackupPackageDirty();
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
        try {
          const blob = await readCipherBlob();
          if (!blob) throw new Error("Local backup package missing after enable");
          await uploadHomeBackupCipher(params.homeUrl, blob, creds);
          await clearBackupPackageDirty();
        } catch (e) {
          await markBackupPackageDirty();
          throw e;
        }
      }

      clearReveal();
      navigation.replace("BackupEnabledSuccess", { channel: params.channel });
    } catch (e) {
      Alert.alert(
        t("backup.couldNotEnable"),
        e instanceof Error ? e.message : t("common.unknownError"),
      );
    } finally {
      setBusy(false);
    }
  }

  const enableLabel =
    params.channel === "home" ? t("backup.enableHomeBackup") : t("backup.enableNostrBackup");

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenTitle>{t("backup.recapTitle")}</ScreenTitle>
        <Caption>{t("backup.recapCaption")}</Caption>

        <Pressable
          style={styles.revealRow}
          onPress={() => void onRevealSecrets()}
          accessibilityRole="button"
          accessibilityLabel={
            revealed ? t("backup.hideSecretsA11y") : t("backup.revealSecretsA11y")
          }
        >
          <Text style={styles.revealLabel}>
            {t("backup.revealSecrets")}
          </Text>
          <Text style={styles.chevron}>{revealed ? "⌃" : "⌄"}</Text>
        </Pressable>

        {revealed && nsec ? (
          <View style={styles.secretsCard}>
            <Text style={styles.secretLabel}>{t("backup.nsecTapCopy")}</Text>
            <Pressable
              onPress={() => void onCopyNsec()}
              accessibilityRole="button"
              accessibilityLabel={t("backup.copyNsecA11y")}
            >
              <Text style={styles.nsec} selectable={false}>
                {nsec}
              </Text>
            </Pressable>

            <Text style={[styles.secretLabel, { marginTop: 16 }]}>
              {t("backup.passphraseManualCopy")}
            </Text>
            <Text style={styles.passphrase} selectable>
              {params.passphrase}
            </Text>
          </View>
        ) : null}

        <Button
          style={{ marginTop: 28 }}
          busy={busy}
          onPress={() => void onEnable()}
        >
          {enableLabel}
        </Button>
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
