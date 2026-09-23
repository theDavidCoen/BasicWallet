/**
 * Settings → Account → Archived wallets.
 * Lists passkey children marked archived; Restore rematerializes into the switcher.
 */

import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import {
  listArchivedPasskeyChildren,
  type PasskeyChildEntry,
} from "../onboarding/passkeyChildIndexMap";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";
import { useWallet } from "../wallet/WalletProvider";
import { getMnemonicSource } from "../wallet/mnemonicMeta";

export function ArchivedWalletsScreen() {
  const navigation = useNavigation<RootNav>();
  const { restoreArchivedPasskeyWallet } = useWallet();
  const [entries, setEntries] = useState<PasskeyChildEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const [passkeyRoot, setPasskeyRoot] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const source = await getMnemonicSource();
      setPasskeyRoot(source === "passkey-prf");
      setEntries(await listArchivedPasskeyChildren());
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function onRestore(entry: PasskeyChildEntry) {
    Alert.alert(
      "Restore wallet?",
      `${entry.label} will return to your wallet list.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          onPress: () => {
            void (async () => {
              setBusyIndex(entry.index);
              try {
                await restoreArchivedPasskeyWallet(entry.index);
                await reload();
                navigation.navigate("Home");
              } catch (e) {
                Alert.alert(
                  "Could not restore",
                  e instanceof Error ? e.message : "Unknown error",
                );
              } finally {
                setBusyIndex(null);
              }
            })();
          },
        },
      ],
    );
  }

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={ui.title}>ARCHIVED WALLETS</Text>
        <Text style={ui.caption}>
          Passkey wallets you removed stay archived across fresh installs.{"\n"}
          Restore puts them back in your wallet list.
        </Text>

        {loading ? (
          <ActivityIndicator color={colors.fg} style={{ marginTop: 24 }} />
        ) : !passkeyRoot && entries.length === 0 ? (
          <View style={ui.card}>
            <Text style={ui.caption}>
              Archive applies to passkey-derived wallets. Device-only wallets are
              removed permanently unless you have a backup.
            </Text>
          </View>
        ) : entries.length === 0 ? (
          <View style={ui.card}>
            <Text style={ui.caption}>No archived wallets.</Text>
          </View>
        ) : (
          entries.map((entry) => (
            <View key={entry.index} style={[ui.card, styles.rowCard]}>
              <View style={styles.rowText}>
                <Text style={styles.label}>{entry.label}</Text>
                <Text style={styles.meta}>Index {entry.index}</Text>
              </View>
              <Pressable
                style={[ui.secondaryBtn, busyIndex === entry.index && { opacity: 0.6 }]}
                disabled={busyIndex !== null}
                onPress={() => void onRestore(entry)}
              >
                {busyIndex === entry.index ? (
                  <ActivityIndicator color={colors.fg} />
                ) : (
                  <Text style={ui.secondaryBtnText}>Restore</Text>
                )}
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 40 },
  rowCard: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowText: { flex: 1 },
  label: {
    color: colors.fg,
    fontSize: 16,
    fontWeight: "600",
  },
  meta: {
    color: colors.caption,
    fontSize: 13,
    marginTop: 4,
  },
});
