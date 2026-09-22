import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { getNetworkConfig } from "../config/network";
import { getWallet } from "../account/walletRegistry";
import { requireUserPresence } from "../security/userPresence";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";
import { useWallet } from "../wallet/WalletProvider";

/** Penpot 01k — confirm remove seed/passkey wallet. */
export function RemoveWalletScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "RemoveWallet">>();
  const { removeWalletById } = useWallet();
  const networkId = getNetworkConfig().id;
  const wallet = getWallet(networkId, route.params.walletId);
  const [busy, setBusy] = useState(false);

  if (!wallet) {
    return (
      <ScreenChrome logoScale={0.77}>
        <Text style={ui.title}>REMOVE WALLET?</Text>
        <Text style={ui.caption}>Wallet not found.</Text>
      </ScreenChrome>
    );
  }

  async function onRemoveWithoutBackup() {
    setBusy(true);
    try {
      const auth = await requireUserPresence("Confirm remove wallet");
      if (!auth.ok) {
        Alert.alert("Authentication required", "Wallet was not removed.");
        return;
      }
      await removeWalletById(wallet!.id);
      navigation.reset({
        index: 0,
        routes: [{ name: "Home" }],
      });
    } catch (e) {
      Alert.alert("Could not remove", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenChrome logoScale={0.77}>
      <Text style={ui.title}>REMOVE WALLET?</Text>
      <Text style={ui.caption}>
        {wallet.label} will be deleted from this device.{"\n"}
        Without a backup you cannot recover funds.
      </Text>

      <View style={ui.card}>
        <Text style={ui.cardTitle}>Recommended</Text>
        <Text style={ui.caption}>
          Export the recovery phrase first,{"\n"}then remove this wallet.
        </Text>
      </View>

      <Pressable
        style={[ui.primaryBtn, { marginTop: 28 }, busy && { opacity: 0.6 }]}
        disabled={busy}
        onPress={() =>
          navigation.navigate("ExportRecoveryPhrase", { walletId: wallet.id })
        }
      >
        <Text style={ui.primaryBtnText}>Backup recovery phrase</Text>
      </Pressable>

      <Pressable
        style={styles.dangerHit}
        disabled={busy}
        onPress={() => void onRemoveWithoutBackup()}
      >
        {busy ? (
          <ActivityIndicator color="#E5484D" />
        ) : (
          <Text style={styles.dangerText}>Remove without backup</Text>
        )}
      </Pressable>

      <Pressable
        style={[ui.secondaryBtn, { marginTop: 16 }]}
        disabled={busy}
        onPress={() => navigation.goBack()}
      >
        <Text style={ui.secondaryBtnText}>Cancel</Text>
      </Pressable>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  dangerHit: {
    marginTop: 28,
    alignItems: "center",
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: "center",
  },
  dangerText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 15,
    color: "#E5484D",
  },
});
