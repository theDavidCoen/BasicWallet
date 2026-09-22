/**
 * Collaborative offboard while the Arkade operator is healthy.
 */

import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { getNetworkConfig } from "../config/network";
import { onchainTxUrl } from "../config/explorers";
import { requireExitAuth } from "../exit/gates";
import { collaborativeOffboard, validateSweepAddress } from "../exit/runExit";
import { useWallet } from "../wallet/WalletProvider";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

export function CollaborativeOffboardScreen() {
  const navigation = useNavigation<RootNav>();
  const network = getNetworkConfig();
  const { selectedWallet, refresh } = useWallet();
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);

  const isArkade = selectedWallet?.kind === "arkade";

  async function onSubmit() {
    if (!isArkade) return;
    const err = validateSweepAddress(address, network.id);
    if (err) {
      Alert.alert("Address", err);
      return;
    }
    const auth = await requireExitAuth("Confirm collaborative exit");
    if (!auth.ok) {
      Alert.alert("Cancelled", auth.reason);
      return;
    }
    setBusy(true);
    try {
      const txid = await collaborativeOffboard(address);
      await refresh();
      const url = onchainTxUrl(network.id, txid);
      Alert.alert(
        "Withdraw submitted",
        url ? `Settlement started.\n${txid.slice(0, 16)}…` : txid,
        [{ text: "OK", onPress: () => navigation.navigate("Home") }],
      );
    } catch (e) {
      Alert.alert(
        "Withdraw failed",
        e instanceof Error ? e.message : "Operator may be unreachable. Try unilateral exit.",
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
        <Text style={ui.title}>COLLABORATIVE EXIT</Text>
        <Text style={ui.caption}>
          Exit to an external Bitcoin address while the Arkade operator can settle a
          batch. Prefer this over unilateral exit when the service is healthy.
          {"\n\n"}
          There is no unilateral CSV locktime on this path: you and the operator
          cosign, so funds leave Arkade without waiting for the emergency
          timelock. (That CSV delay applies only to unilateral exit.)
        </Text>

        {!isArkade ? (
          <Text style={ui.hint}>Select an Arkade wallet first.</Text>
        ) : (
          <>
            <Text style={styles.label}>Destination address</Text>
            <TextInput
              value={address}
              onChangeText={setAddress}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={network.id === "mainnet" ? "bc1…" : "tb1…"}
              placeholderTextColor={colors.hint}
              style={styles.input}
            />
            <Pressable
              style={[ui.primaryBtn, busy && { opacity: 0.6 }]}
              disabled={busy}
              onPress={() => void onSubmit()}
            >
              {busy ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={ui.primaryBtnText}>Withdraw all</Text>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    marginTop: 16,
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
