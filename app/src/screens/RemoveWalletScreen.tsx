import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { Button, Caption, ScreenTitle } from "../components/ui";
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

  const isPasskeyChild =
    wallet?.tag === "passkey" ||
    wallet?.meta?.derivedFrom === "passkey-index" ||
    wallet?.meta?.derivedFrom === "passkey-label";

  if (!wallet) {
    return (
      <ScreenChrome logoScale={0.77}>
        <ScreenTitle>REMOVE WALLET?</ScreenTitle>
        <Caption>Wallet not found.</Caption>
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
      <ScreenTitle>{isPasskeyChild ? "ARCHIVE WALLET?" : "REMOVE WALLET?"}</ScreenTitle>
      <Caption>
        {isPasskeyChild
          ? `${wallet.label} will leave your wallet list and move to Archived wallets.\nAfter a fresh install it stays archived until you restore it.`
          : `${wallet.label} will be deleted from this device.\nWithout a backup you cannot recover funds.`}
      </Caption>

      {!isPasskeyChild ? (
        <View style={ui.card}>
          <Text style={ui.cardTitle}>Recommended</Text>
          <Text style={ui.caption}>
            Export the recovery phrase first,{"\n"}then remove this wallet.
          </Text>
        </View>
      ) : (
        <View style={ui.card}>
          <Text style={ui.cardTitle}>Archived</Text>
          <Text style={ui.caption}>
            Settings → Account → Archived wallets{"\n"}
            to restore this passkey child later.
          </Text>
        </View>
      )}

      {!isPasskeyChild ? (
        <Button
          style={{ marginTop: 28 }}
          disabled={busy}
          onPress={() =>
            navigation.navigate("ExportRecoveryPhrase", { walletId: wallet.id })
          }
        >
          Backup recovery phrase
        </Button>
      ) : null}

      <Pressable
        style={styles.dangerHit}
        disabled={busy}
        onPress={() => void onRemoveWithoutBackup()}
      >
        {busy ? (
          <ActivityIndicator color="#E5484D" />
        ) : (
          <Text style={styles.dangerText}>
            {isPasskeyChild ? "Archive wallet" : "Remove without backup"}
          </Text>
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
