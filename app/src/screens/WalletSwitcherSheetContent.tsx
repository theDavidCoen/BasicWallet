/**
 * Wallet switcher body for InteractiveBottomSheet (no ScreenChrome).
 */

import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button, Caption, ScreenTitle } from "../components/ui";
import { useWallet } from "../wallet/WalletProvider";
import { colors } from "../theme/colors";
import { sheetUi } from "../theme/sheetUi";

type Props = {
  onClose: () => void;
  onAddWallet: () => void;
  onEditWallet: (walletId: string) => void;
  onConnectNode: () => void;
};

export function WalletSwitcherSheetContent({
  onClose,
  onAddWallet,
  onEditWallet,
  onConnectNode,
}: Props) {
  const { wallets, selectedWallet, selectWallet, refreshWalletList } = useWallet();
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    refreshWalletList();
  }, [refreshWalletList]);

  const onSelect = useCallback(
    async (id: string) => {
      if (id === selectedWallet?.id) {
        onClose();
        return;
      }
      setBusyId(id);
      try {
        await selectWallet(id);
        onClose();
      } catch (e) {
        console.warn("[basic] selectWallet failed", e);
      } finally {
        setBusyId(null);
      }
    },
    [onClose, selectWallet, selectedWallet?.id],
  );

  return (
    <View style={styles.root}>
      <ScreenTitle style={sheetUi.title}>WALLETS</ScreenTitle>
      <Caption style={sheetUi.caption}>Select your default wallet</Caption>

      <FlatList
        data={wallets}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListFooterComponent={
          <View>
            <Button size="sheet" onPress={() => onAddWallet()}>
              + Create wallet
            </Button>
            <Button size="sheet" onPress={() => onConnectNode()}>
              Connect Lightning Node
            </Button>
          </View>
        }
        renderItem={({ item }) => {
          const selected = item.id === selectedWallet?.id;
          const busy = busyId === item.id;
          return (
            <View style={[styles.row, selected && styles.rowOn]}>
              <Pressable
                style={styles.rowMain}
                onPress={() => void onSelect(item.id)}
                disabled={busyId !== null}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {(item.label[0] ?? "?").toUpperCase()}
                  </Text>
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{item.label}</Text>
                  <Text style={styles.rowSub}>
                    {item.kind}
                    {item.tag ? ` · ${item.tag}` : ""}
                    {selected ? " · selected" : ""}
                  </Text>
                </View>
                {busy ? <ActivityIndicator color={colors.fg} /> : null}
              </Pressable>
              <Pressable
                style={styles.chevronHit}
                hitSlop={12}
                onPress={() => {
                  onEditWallet(item.id);
                }}
                disabled={busyId !== null}
              >
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { paddingBottom: 24, gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingLeft: 12,
    paddingVertical: 4,
  },
  rowOn: { borderColor: colors.fg },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.fg,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
  },
  rowBody: { flex: 1 },
  rowTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
  },
  rowSub: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.caption,
    marginTop: 2,
  },
  chevronHit: {
    paddingHorizontal: 14,
    paddingVertical: 16,
    justifyContent: "center",
  },
  chevron: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 22,
    color: "#666666",
  },
});
