import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ScreenChrome } from "../components/ScreenChrome";
import type { RootNav } from "../navigation/types";
import { useWallet } from "../wallet/WalletProvider";
import { colors } from "../theme/colors";

/** Penpot 01c — tap row → select; tap › → Edit wallet. */
export function WalletSwitcherScreen() {
  const navigation = useNavigation<RootNav>();
  const { wallets, selectedWallet, selectWallet, refreshWalletList } = useWallet();
  const [busyId, setBusyId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      refreshWalletList();
    }, [refreshWalletList]),
  );

  async function onSelect(id: string) {
    if (id === selectedWallet?.id) {
      navigation.goBack();
      return;
    }
    setBusyId(id);
    try {
      await selectWallet(id);
      navigation.navigate("Home");
    } catch (e) {
      console.warn("[basic] selectWallet failed", e);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ScreenChrome logoScale={0.77}>
      <Text style={styles.title}>WALLETS</Text>
      <Text style={styles.caption}>Select your default wallet</Text>

      <FlatList
        data={wallets}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListFooterComponent={
          <Pressable
            style={styles.addBtn}
            onPress={() => navigation.navigate("AddWallet")}
          >
            <Text style={styles.addLabel}>+ Create wallet</Text>
          </Pressable>
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
                onPress={() => navigation.navigate("EditWallet", { walletId: item.id })}
                disabled={busyId !== null}
              >
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            </View>
          );
        }}
      />
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 20,
    color: colors.fg,
    textAlign: "center",
    marginTop: 8,
  },
  caption: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    marginTop: 6,
    marginBottom: 16,
  },
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
  addBtn: {
    marginTop: 12,
    borderRadius: 10,
    backgroundColor: colors.fg,
    paddingVertical: 16,
    alignItems: "center",
  },
  addLabel: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.bg,
  },
});
