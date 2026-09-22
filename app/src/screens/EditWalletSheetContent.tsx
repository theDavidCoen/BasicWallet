/**
 * Edit wallet body for InteractiveBottomSheet (Wallets › arrow).
 */

import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { getNetworkConfig } from "../config/network";
import { getWallet } from "../account/walletRegistry";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";
import { useWallet } from "../wallet/WalletProvider";

type Props = {
  walletId: string;
  onDone: () => void;
  onRemove: (walletId: string, kind: "arkade" | "lightning") => void;
};

export function EditWalletSheetContent({
  walletId,
  onDone,
  onRemove,
}: Props) {
  const { renameWallet, refreshWalletList } = useWallet();
  const networkId = getNetworkConfig().id;
  const wallet = getWallet(networkId, walletId);
  const [name, setName] = useState(wallet?.label ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(wallet?.label ?? "");
  }, [wallet?.label, walletId]);

  if (!wallet) {
    return (
      <View style={styles.root}>
        <Text style={ui.title}>EDIT WALLET</Text>
        <Text style={ui.caption}>Wallet not found.</Text>
        <Pressable style={ui.primaryBtn} onPress={onDone}>
          <Text style={ui.primaryBtnText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  const kindLabel = wallet.kind === "lightning" ? "lightning" : "ark";

  async function onSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert("Name required", "Enter a wallet name.");
      return;
    }
    setBusy(true);
    try {
      await renameWallet(wallet!.id, trimmed);
      refreshWalletList();
      onDone();
    } catch (e) {
      Alert.alert("Could not save", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <Text style={ui.title}>EDIT WALLET</Text>
      <Text style={ui.caption}>
        {wallet.label} · {kindLabel}
      </Text>

      <Text style={styles.label}>name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        autoCorrect={false}
        placeholder="Wallet name"
        placeholderTextColor={colors.hint}
      />

      <Pressable
        style={[ui.primaryBtn, { marginTop: 24 }, busy && { opacity: 0.6 }]}
        disabled={busy}
        onPress={() => void onSave()}
      >
        {busy ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={ui.primaryBtnText}>Save name</Text>
        )}
      </Pressable>

      <Pressable
        style={styles.removeHit}
        onPress={() =>
          onRemove(
            wallet.id,
            wallet.kind === "lightning" ? "lightning" : "arkade",
          )
        }
      >
        <Text style={styles.removeText}>Remove wallet</Text>
      </Pressable>

      {wallet.kind !== "lightning" ? (
        <Text style={[ui.hint, { marginTop: 16 }]}>
          Removing a seed wallet is permanent{"\n"}unless you backed up the phrase.
        </Text>
      ) : (
        <Text style={[ui.hint, { marginTop: 16 }]}>
          Removes the Lightning connection from Basic.{"\n"}Funds stay on your node.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  label: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    marginTop: 28,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: colors.fg,
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 16,
  },
  removeHit: {
    marginTop: 36,
    alignItems: "center",
    paddingVertical: 12,
  },
  removeText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 15,
    color: "#E5484D",
  },
});
