import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  type AppStateStatus,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as ScreenCapture from "expo-screen-capture";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { Button, Caption, ScreenTitle } from "../components/ui";
import { getNetworkConfig } from "../config/network";
import { getWallet } from "../account/walletRegistry";
import { loadMnemonicForCrypto } from "../security/mnemonicStore";
import { requireUserPresence } from "../security/userPresence";
import { markSeedExportConfirmed } from "../wallet/backupReminder";
import { useWallet } from "../wallet/WalletProvider";
import { colors } from "../theme/colors";
/**
 * Settings-only 24-word export (Penpot 11e).
 * Never onboarding. Reveal only after biometrics/PIN. FLAG_SECURE while shown.
 * Backgrounding clears words from UI state immediately.
 */
export function ExportRecoveryPhraseScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "ExportRecoveryPhrase">>();
  const { selectedWallet } = useWallet();
  const paramWalletId = route.params?.walletId;
  const targetWalletId = paramWalletId ?? selectedWallet?.id;
  const targetKind = paramWalletId
    ? getWallet(getNetworkConfig().id, paramWalletId)?.kind
    : selectedWallet?.kind;
  const [busy, setBusy] = useState(false);
  const [words, setWords] = useState<string[] | null>(null);
  const wordsRef = useRef<string[] | null>(null);

  const clearReveal = useCallback(() => {
    wordsRef.current = null;
    setWords(null);
    void ScreenCapture.allowScreenCaptureAsync().catch(() => {});
  }, []);

  useEffect(() => {
    const onAppState = (next: AppStateStatus) => {
      if (next !== "active" && wordsRef.current) {
        clearReveal();
      }
    };
    const sub = AppState.addEventListener("change", onAppState);
    return () => {
      sub.remove();
      clearReveal();
    };
  }, [clearReveal]);

  async function onReveal() {
    const walletId = targetWalletId;
    if (!walletId || targetKind !== "arkade") {
      Alert.alert("No seed wallet", "Select an Arkade wallet first.");
      return;
    }

    setBusy(true);
    try {
      const auth = await requireUserPresence("Confirm to show your recovery phrase");
      if (!auth.ok) {
        Alert.alert("Authentication required", "Recovery phrase was not shown.");
        return;
      }

      const mnemonic = await loadMnemonicForCrypto(walletId);
      if (!mnemonic?.trim()) {
        Alert.alert("No recovery phrase", "No seed is stored for this wallet.");
        return;
      }

      const list = mnemonic.trim().split(/\s+/).filter(Boolean);
      if (list.length !== 12 && list.length !== 24) {
        Alert.alert("Invalid phrase", "Stored seed has an unexpected word count.");
        return;
      }

      try {
        await ScreenCapture.preventScreenCaptureAsync();
      } catch (e) {
        console.warn("[basic] preventScreenCapture unavailable", e);
      }

      wordsRef.current = list;
      setWords(list);
    } catch (e) {
      Alert.alert("Could not load phrase", e instanceof Error ? e.message : "Unknown error");
      clearReveal();
    } finally {
      setBusy(false);
    }
  }

  async function onDone() {
    clearReveal();
    await markSeedExportConfirmed();
    navigation.goBack();
  }

  const walletLabel =
    (paramWalletId
      ? getWallet(getNetworkConfig().id, paramWalletId)?.label
      : selectedWallet?.label) ?? "Wallet";

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <ScreenTitle>RECOVERY PHRASE</ScreenTitle>
        <Caption>
          {`${walletLabel} · this Arkade wallet only.\nWrite offline. Shown only after biometrics / PIN.`}
        </Caption>

        {words ? (
          <>
            <View style={styles.box}>
              <View style={styles.grid}>
                {words.map((w, i) => (
                  <Text key={`${i}-${w}`} style={styles.word} selectable={false}>
                    <Text style={styles.idx}>{i + 1} </Text>
                    {w}
                  </Text>
                ))}
              </View>
            </View>

            <Text style={styles.hintList}>
              · These words restore this Arkade wallet only.{"\n"}
              · Anyone with these words can spend your bitcoin.{"\n"}
              · Screenshots are blocked while revealed.
            </Text>

            <Button style={{ marginTop: 24 }} onPress={() => void onDone()}>
              I wrote it down
            </Button>
          </>
        ) : (
          <View style={styles.locked}>
            <Text style={styles.lockedText}>
              Your 24-word phrase stays hidden until you authenticate.
            </Text>
            <Button busy={busy} onPress={() => void onReveal()}>
              Authenticate · Reveal
            </Button>
          </View>
        )}
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: 32,
  },
  hintList: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    textAlign: "left",
    lineHeight: 18,
    marginTop: 20,
  },
  box: {
    marginTop: 20,
    backgroundColor: "#1A1A1A",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.fg,
    padding: 16,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  word: {
    width: "48%",
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.fg,
    lineHeight: 22,
  },
  idx: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
  },
  locked: {
    marginTop: 28,
    paddingHorizontal: 8,
  },
  lockedText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 8,
  },
});
