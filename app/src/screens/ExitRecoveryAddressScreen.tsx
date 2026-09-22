/**
 * Step 1 — external recovery / sweep address (never Arkade boarding).
 * After save from exit wizard → step 2 prepare. From reminder → Home.
 */

import { useCallback, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from "react-native";
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { ExitStepHeader, EXIT_STEP } from "../components/ExitStepHeader";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { getNetworkConfig } from "../config/network";
import { scheduleAutoPrepareSoon } from "../exit/autoPrepare";
import {
  readRecoveryAddress,
  writeRecoveryAddress,
} from "../exit/recoveryAddress";
import { dismissRecoveryReminder } from "../exit/recoveryReminder";
import { requireExitAuth } from "../exit/gates";
import { useWallet } from "../wallet/WalletProvider";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

export function ExitRecoveryAddressScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "ExitRecoveryAddress">>();
  const from = route.params?.from;
  const network = getNetworkConfig();
  const { selectedWallet } = useWallet();
  const walletId = selectedWallet?.kind === "arkade" ? selectedWallet.id : null;
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const inWizard = from === "exit";

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const cur = await readRecoveryAddress(network.id);
        setDraft(cur ?? "");
      })();
    }, [network.id]),
  );

  function routeAfterSave(savedNonEmpty: boolean) {
    if (from === "reminder") {
      navigation.navigate("Home");
      return;
    }
    if (from === "exit" && savedNonEmpty) {
      navigation.navigate("UnilateralExitPrepare");
      return;
    }
    if (from === "exit") {
      navigation.navigate("UnilateralExitHub");
      return;
    }
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Settings");
  }

  async function onSave(nextDraft?: string) {
    const value = nextDraft !== undefined ? nextDraft : draft;
    const auth = await requireExitAuth("Confirm recovery address");
    if (!auth.ok) {
      Alert.alert("Cancelled", auth.reason);
      return;
    }
    setBusy(true);
    try {
      const res = await writeRecoveryAddress(network.id, value, { walletId });
      if (!res.ok) {
        Alert.alert("Address", res.error);
        return;
      }
      setDraft(value.trim());
      if (value.trim()) {
        await dismissRecoveryReminder();
        scheduleAutoPrepareSoon("recovery-address-saved");
      }
      Alert.alert(
        "Saved",
        value.trim()
          ? inWizard
            ? "Next: review the exit package. Auto-prepare may already have one ready (or will build it while the operator is reachable)."
            : "Basic will auto-prepare an exit package in the background when your Arkade balance changes."
          : "Recovery address cleared. Auto-prepare is paused.",
        [{ text: "OK", onPress: () => routeAfterSave(!!value.trim()) }],
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {inWizard ? (
          <ExitStepHeader
            step={EXIT_STEP.recovery}
            title="RECOVERY ADDRESS"
            caption={
              "Where exited funds should land: an address from an external Bitcoin wallet you control.\n\n" +
              "After you start unilateral exit, Basic unrolls your VTXOs onchain, then a CSV locktime must expire before the sweep can pay this address. That wait is normal (ASP unilateralExitDelay; often tens of minutes on Mutinynet, longer on mainnet). Progress and the remaining lock show on the Exit screen.\n\n" +
              "You do not need to sit and wait. After Start execute, keep using Basic as usual: receive, send, and board new funds. The exit continues in the background and finishes when the lock clears."
            }
          />
        ) : (
          <>
            <Text style={ui.title}>RECOVERY ADDRESS</Text>
            <Text style={ui.caption}>
              External Bitcoin address for unilateral exit. Funds land here after
              onchain unroll and the CSV locktime. You can keep using the wallet
              normally once exit has started; you do not have to wait on this screen.
            </Text>
          </>
        )}

        <Text style={[ui.hint, { marginTop: inWizard ? 4 : 8 }]}>
          Network: {network.label}
        </Text>

        <Text style={styles.warn}>
          Do not use an Arkade boarding address (the onchain address you use to deposit into
          Arkade). Boarding is for entering Arkade; recovery must be a different wallet.
        </Text>

        <Text style={styles.label}>Onchain address (external wallet)</Text>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={network.id === "mainnet" ? "bc1…" : "tb1…"}
          placeholderTextColor={colors.hint}
          style={styles.input}
        />

        <Pressable
          style={[ui.primaryBtn, busy && { opacity: 0.6 }]}
          disabled={busy}
          onPress={() => void onSave()}
        >
          <Text style={ui.primaryBtnText}>
            {inWizard ? "Save · continue" : "Save"}
          </Text>
        </Pressable>
        <Pressable
          style={ui.secondaryBtn}
          disabled={busy}
          onPress={() => void onSave("")}
        >
          <Text style={ui.secondaryBtnText}>Clear</Text>
        </Pressable>
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  warn: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    lineHeight: 18,
    marginTop: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
  },
  label: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    marginTop: 20,
    marginBottom: 6,
  },
  input: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.fg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
});
