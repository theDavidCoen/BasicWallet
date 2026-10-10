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
import { Button } from "../components/ui";
import { useI18n } from "../i18n";
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
  const { t } = useI18n();
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
      t("archived.restoreTitle"),
      t("archived.restoreBody", { label: entry.label }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("archived.restore"),
          onPress: () => {
            void (async () => {
              setBusyIndex(entry.index);
              try {
                await restoreArchivedPasskeyWallet(entry.index);
                await reload();
                navigation.navigate("Home");
              } catch (e) {
                Alert.alert(
                  t("archived.restoreFailed"),
                  e instanceof Error ? e.message : t("common.unknownError"),
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
        <Text style={ui.title}>{t("archived.title")}</Text>
        <Text style={ui.caption}>{t("archived.caption")}</Text>

        {loading ? (
          <ActivityIndicator color={colors.fg} style={{ marginTop: 24 }} />
        ) : !passkeyRoot && entries.length === 0 ? (
          <View style={ui.card}>
            <Text style={ui.caption}>{t("archived.deviceOnlyNote")}</Text>
          </View>
        ) : entries.length === 0 ? (
          <View style={ui.card}>
            <Text style={ui.caption}>{t("archived.empty")}</Text>
          </View>
        ) : (
          entries.map((entry) => (
            <View key={entry.index} style={[ui.card, styles.rowCard]}>
              <View style={styles.rowText}>
                <Text style={styles.label}>{entry.label}</Text>
                <Text style={styles.meta}>
                  {t("archived.index", { index: entry.index })}
                </Text>
              </View>
              <Button
                variant="secondary"
                style={{ marginTop: 0, flexShrink: 0 }}
                busy={busyIndex === entry.index}
                disabled={busyIndex !== null}
                onPress={() => void onRestore(entry)}
              >
                {t("archived.restore")}
              </Button>
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
