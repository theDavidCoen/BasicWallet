import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { readActivityFromDb, searchActivity, type StoredActivity } from "../account/activityStore";
import { shareActivityCsv } from "../account/activityCsv";
import { syncLightningHistory } from "../account/lightningActivity";
import { backfillMissingFiat } from "../account/fiatRate";
import { getNetworkConfig } from "../config/network";
import { filterFiatModeActivityRows } from "../fiat/fiatActivityFilter";
import { useFiatMode } from "../fiat/FiatModeProvider";
import { useWallet } from "../wallet/WalletProvider";
import { activityDepixAtomic, formatActivityAmountSigned, formatWhen, statusLabel } from "../wallet/activity";
import { colors } from "../theme/colors";

export function ActivityScreen() {
  const navigation = useNavigation<RootNav>();
  const { selectedWallet, activityEpoch, refreshActivity, bumpActivity } = useWallet();
  const { fiatMode, depixDisplay } = useFiatMode();
  const network = getNetworkConfig();
  const [rows, setRows] = useState<StoredActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const loadFromDb = useCallback(() => {
    if (!selectedWallet) {
      setRows([]);
      setError("No wallet selected");
      return;
    }
    try {
      setError(null);
      const list = query.trim()
        ? searchActivity(network.id, query, { walletId: selectedWallet.id })
        : readActivityFromDb(network.id, { walletId: selectedWallet.id });
      setRows(
        fiatMode
          ? filterFiatModeActivityRows(list, network.id, depixDisplay)
          : list,
      );
      void backfillMissingFiat(network.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load activity");
      setRows([]);
    }
  }, [selectedWallet, network.id, query, fiatMode, depixDisplay]);

  useEffect(() => {
    setLoading(true);
    loadFromDb();
    setLoading(false);
  }, [loadFromDb, activityEpoch]);

  useEffect(() => {
    if (selectedWallet?.kind !== "lightning") return;
    let cancelled = false;
    void (async () => {
      try {
        const n = await syncLightningHistory(network.id, selectedWallet.id);
        if (!cancelled && n > 0) bumpActivity();
      } catch (e) {
        console.warn("[basic] activity ln sync", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedWallet?.id, selectedWallet?.kind, network.id, bumpActivity]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await refreshActivity();
      loadFromDb();
    } catch (e) {
      console.warn("[basic] activity pull refresh failed", e);
      loadFromDb();
    } finally {
      setRefreshing(false);
    }
  }

  async function onExportCsv() {
    if (exporting) return;
    if (rows.length === 0) {
      Alert.alert("Export", "No activity to export.");
      return;
    }
    setExporting(true);
    try {
      await shareActivityCsv({
        networkId: network.id,
        rows,
        walletLabel: selectedWallet?.label,
      });
    } catch (e) {
      Alert.alert(
        "Export failed",
        e instanceof Error ? e.message : "Could not share CSV.",
      );
    } finally {
      setExporting(false);
    }
  }

  const emptyHint =
    selectedWallet?.kind === "lightning"
      ? "No Lightning activity yet.\nCreate or pay an invoice."
      : "No activity yet.\nFund boarding or receive on Arkade.";

  return (
    <ScreenChrome logoScale={0.77}>
      <View style={styles.titleRow}>
        <View style={styles.titleSide} />
        <Text style={styles.title}>ACTIVITY</Text>
        <Pressable
          style={styles.titleSide}
          onPress={() => void onExportCsv()}
          disabled={exporting}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Export activity CSV"
        >
          <Text style={[styles.exportLabel, exporting && styles.exportBusy]}>
            {exporting ? "…" : "CSV"}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.sub}>
        {selectedWallet
          ? `${selectedWallet.label} · boarding, receives, sends`
          : "No wallet selected"}
      </Text>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search notes / title…"
          placeholderTextColor={colors.hint}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 ? (
          <Pressable
            style={styles.searchClear}
            onPress={() => setQuery("")}
            hitSlop={10}
            accessibilityLabel="Clear search"
          >
            <Text style={styles.searchClearLabel}>×</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.fg} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => `${item.walletId}:${item.id}`}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={colors.fg}
            />
          }
          contentContainerStyle={rows.length === 0 ? styles.emptyWrap : styles.list}
          ListEmptyComponent={<Text style={styles.empty}>{error ?? emptyHint}</Text>}
          renderItem={({ item }) => {
            const amountLabel = formatActivityAmountSigned(item, network.id);
            const depix = activityDepixAtomic(item, network.id);
            const signed =
              depix != null && depix !== 0n
                ? depix > 0n
                  ? 1
                  : -1
                : item.amount;
            return (
              <Pressable
                onPress={() =>
                  navigation.navigate("ActivityDetail", {
                    activityId: item.id,
                    walletId: item.walletId,
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`${item.title}, ${amountLabel}`}
              >
                <View style={styles.row}>
                  <View style={styles.rowTop}>
                    <Text style={styles.rowTitle}>{item.title}</Text>
                    <Text
                      style={[
                        styles.rowAmount,
                        signed > 0
                          ? styles.pos
                          : signed < 0
                            ? styles.neg
                            : null,
                      ]}
                    >
                      {amountLabel}
                    </Text>
                  </View>
                  <Text style={styles.rowSub}>{item.subtitle}</Text>
                  <Text style={styles.rowMeta}>
                    {statusLabel(item.status)}
                    {` · ${formatWhen(item.createdAt)}`}
                    {item.fiatAmount != null &&
                    item.fiatCode &&
                    !(depix != null && depix !== 0n)
                      ? ` · ~${item.fiatAmount.toFixed(2)} ${item.fiatCode.toUpperCase()}`
                      : ""}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  titleSide: {
    width: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 22,
    color: colors.fg,
    textAlign: "center",
  },
  exportLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.fg,
  },
  exportBusy: { color: colors.hint },
  sub: {
    marginTop: 6,
    marginBottom: 10,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    textAlign: "center",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: "#0D0D0D",
  },
  search: {
    flex: 1,
    paddingVertical: 10,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.fg,
  },
  searchClear: { padding: 4 },
  searchClearLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 18,
    color: colors.hint,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingBottom: 40 },
  emptyWrap: { flexGrow: 1, justifyContent: "center" },
  empty: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 22,
  },
  row: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 12,
  },
  rowTitle: {
    flex: 1,
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 15,
    color: colors.fg,
  },
  rowAmount: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 15,
    color: colors.fg,
  },
  pos: { color: "#2E7D32" },
  neg: { color: "#B00020" },
  rowSub: {
    marginTop: 4,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
  },
  rowMeta: {
    marginTop: 4,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
  },
});
