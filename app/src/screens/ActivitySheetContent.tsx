/**
 * Activity list body for InteractiveBottomSheet (no ScreenChrome).
 * Detail step is owned by SheetHost (same pattern as Wallets → Create Wallet).
 */

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
import { Pressable as GHPressable } from "react-native-gesture-handler";
import { readActivityFromDb, searchActivity, type StoredActivity } from "../account/activityStore";
import { shareActivityCsv } from "../account/activityCsv";
import { syncLightningHistory } from "../account/lightningActivity";
import { backfillMissingFiat } from "../account/fiatRate";
import { getNetworkConfig } from "../config/network";
import { useWallet } from "../wallet/WalletProvider";
import { activityDepixAtomic, formatActivityAmountSigned, formatWhen, statusLabel } from "../wallet/activity";
import { colors } from "../theme/colors";

type Props = {
  active?: boolean;
  onOpenDetail: (activityId: string, walletId: string) => void;
};

/** Delay before allowing pull-to-refresh after the sheet opens. */
const REFRESH_ARM_MS = 700;

export function ActivitySheetContent({ active = true, onOpenDetail }: Props) {
  const { selectedWallet, activityEpoch, refreshActivity, bumpActivity } = useWallet();
  const network = getNetworkConfig();
  const [rows, setRows] = useState<StoredActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshArmed, setRefreshArmed] = useState(false);
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
      setRows(list);
      void backfillMissingFiat(network.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load activity");
      setRows([]);
    }
  }, [selectedWallet, network.id, query]);

  useEffect(() => {
    setLoading(true);
    loadFromDb();
    setLoading(false);
  }, [loadFromDb, activityEpoch]);

  useEffect(() => {
    if (!active) {
      setRefreshArmed(false);
      setRefreshing(false);
      return;
    }
    setRefreshArmed(false);
    const t = setTimeout(() => setRefreshArmed(true), REFRESH_ARM_MS);
    // Rebuild list from SDK+vtxos when opening (recovers after a partial wipe).
    void (async () => {
      try {
        await refreshActivity();
        loadFromDb();
      } catch (e) {
        console.warn("[basic] activity open rematerialize failed", e);
      }
    })();
    return () => clearTimeout(t);
  }, [active, refreshActivity, loadFromDb]);

  useEffect(() => {
    if (!active || selectedWallet?.kind !== "lightning") return;
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
  }, [active, selectedWallet?.id, selectedWallet?.kind, network.id, bumpActivity]);

  async function onRefresh() {
    if (!refreshArmed) return;
    setRefreshing(true);
    try {
      await refreshActivity();
      loadFromDb();
    } catch (e) {
      console.warn("[basic] activity sheet pull refresh failed", e);
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
    <View style={styles.root}>
      <View style={styles.titleRow}>
        <View style={styles.titleSide} />
        <Text style={styles.title}>ACTIVITY</Text>
        <Pressable
          style={[styles.titleSide, styles.exportBtn]}
          onPress={() => void onExportCsv()}
          disabled={exporting || loading}
          hitSlop={8}
          accessibilityLabel="Export activity CSV"
        >
          {exporting ? (
            <ActivityIndicator color={colors.fg} size="small" />
          ) : (
            <Text style={styles.exportLabel}>CSV</Text>
          )}
        </Pressable>
      </View>
      <Text style={styles.caption}>
        {selectedWallet?.label ?? "Wallet"}
        {selectedWallet?.kind === "lightning"
          ? " · Lightning invoices"
          : " · boarding, receives, sends"}
      </Text>

      <View style={styles.searchWrap}>
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
          style={styles.listFlex}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          refreshControl={
            refreshArmed ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void onRefresh()}
                tintColor={colors.fg}
              />
            ) : undefined
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
            <GHPressable
              onPress={() => onOpenDetail(item.id, item.walletId)}
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
                  {item.fiatAmount != null && item.fiatCode && !(depix != null && depix !== 0n)
                    ? ` · ~${item.fiatAmount.toFixed(2)} ${item.fiatCode.toUpperCase()}`
                    : ""}
                </Text>
              </View>
            </GHPressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  listFlex: { flex: 1 },
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
    fontSize: 20,
    color: colors.fg,
    textAlign: "center",
  },
  exportBtn: {
    minHeight: 32,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  exportLabel: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 12,
    color: colors.fg,
  },
  caption: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    marginTop: 6,
    marginBottom: 8,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    marginBottom: 8,
    paddingRight: 4,
  },
  search: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    paddingRight: 8,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.fg,
  },
  searchClear: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  searchClearLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 22,
    lineHeight: 24,
    color: colors.caption,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingBottom: 24 },
  emptyWrap: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 16 },
  empty: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 22,
  },
  row: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 14,
  },
  rowTop: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
    flex: 1,
  },
  rowAmount: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
  },
  pos: { color: "#7DCEA0" },
  neg: { color: "#E07070" },
  rowSub: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    marginTop: 4,
  },
  rowMeta: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
    marginTop: 4,
  },
});
