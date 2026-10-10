import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { Button, Caption, ScreenTitle } from "../components/ui";
import { getNetworkConfig } from "../config/network";
import { getWallet } from "../account/walletRegistry";
import { requireUserPresence } from "../security/userPresence";
import { ui } from "../theme/ui";
import { useWallet } from "../wallet/WalletProvider";

/** Penpot 01m — disconnect Lightning row (funds stay on node). */
export function RemoveLightningWalletScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "RemoveLightningWallet">>();
  const { removeWalletById } = useWallet();
  const networkId = getNetworkConfig().id;
  const wallet = getWallet(networkId, route.params.walletId);
  const [busy, setBusy] = useState(false);

  if (!wallet) {
    return (
      <ScreenChrome logoScale={0.77}>
        <ScreenTitle>REMOVE LIGHTNING?</ScreenTitle>
        <Caption>Wallet not found.</Caption>
      </ScreenChrome>
    );
  }

  async function onRemove() {
    setBusy(true);
    try {
      const auth = await requireUserPresence("Confirm remove Lightning wallet");
      if (!auth.ok) {
        Alert.alert("Authentication required", "Lightning wallet was not removed.");
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
      <ScreenTitle>REMOVE LIGHTNING?</ScreenTitle>
      <Caption>
        {"Removes this Lightning connection from Basic.\nFunds stay on your Lightning node."}
      </Caption>

      <View style={ui.card}>
        <Text style={ui.cardTitle}>No recovery phrase</Text>
        <Text style={ui.caption}>Node wallets have no seed to export.</Text>
      </View>

      <Pressable
        style={styles.dangerHit}
        disabled={busy}
        onPress={() => void onRemove()}
      >
        {busy ? (
          <ActivityIndicator color="#E5484D" />
        ) : (
          <Text style={styles.dangerText}>Remove Lightning wallet</Text>
        )}
      </Pressable>

      <Button
        variant="secondary"
        style={{ marginTop: 16 }}
        disabled={busy}
        onPress={() => navigation.goBack()}
      >
        Cancel
      </Button>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  dangerHit: {
    marginTop: 36,
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
