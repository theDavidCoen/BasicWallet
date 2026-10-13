/**
 * Collaborative offboard while the Arkade operator is healthy.
 */

import { useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { Button, Caption, Hint, ScreenTitle, TextField } from "../components/ui";
import { getNetworkConfig } from "../config/network";
import { onchainTxUrl } from "../config/explorers";
import { requireExitAuth } from "../exit/gates";
import { collaborativeOffboard, validateSweepAddress } from "../exit/runExit";
import { useWallet } from "../wallet/WalletProvider";
import { useI18n } from "../i18n";
import { colors } from "../theme/colors";

export function CollaborativeOffboardScreen() {
  const navigation = useNavigation<RootNav>();
  const { t } = useI18n();
  const network = getNetworkConfig();
  const { selectedWallet, refresh } = useWallet();
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);

  const isArkade = selectedWallet?.kind === "arkade";

  async function onSubmit() {
    if (!isArkade) return;
    const err = validateSweepAddress(address, network.id);
    if (err) {
      Alert.alert(t("exit.addressTitle"), err);
      return;
    }
    const auth = await requireExitAuth(t("exit.confirmCollab"));
    if (!auth.ok) {
      Alert.alert(t("exit.cancelled"), auth.reason);
      return;
    }
    setBusy(true);
    try {
      const txid = await collaborativeOffboard(address);
      await refresh();
      const url = onchainTxUrl(network.id, txid);
      Alert.alert(
        t("exit.withdrawSubmitted"),
        url ? t("exit.settlementStarted", { txid: txid.slice(0, 16) }) : txid,
        [{ text: t("exit.ok"), onPress: () => navigation.navigate("Home") }],
      );
    } catch (e) {
      Alert.alert(
        t("exit.withdrawFailed"),
        e instanceof Error ? e.message : t("exit.withdrawFailedBody"),
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
        <ScreenTitle>{t("exit.collabTitle")}</ScreenTitle>
        <Caption>{t("exit.collabCaption")}</Caption>

        {!isArkade ? (
          <Hint>{t("exit.selectArkadeFirst")}</Hint>
        ) : (
          <>
            <Text style={styles.label}>{t("exit.destinationAddress")}</Text>
            <TextField
              value={address}
              onChangeText={setAddress}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={network.id === "mainnet" ? "bc1…" : "tb1…"}
              style={{ fontSize: 14, marginBottom: 0 }}
            />
            <Button busy={busy} onPress={() => void onSubmit()}>
              {t("exit.withdrawAll")}
            </Button>
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
});
