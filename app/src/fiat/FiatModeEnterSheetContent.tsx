/**
 * Enter Fiat Mode body for InteractiveBottomSheet (Home).
 * Intrinsic height (no flex:1 ScrollView) so fitContent sheets stay compact.
 */

import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { getNetworkConfig } from "../config/network";
import { colors } from "../theme/colors";
import { sheetUi } from "../theme/sheetUi";
import {
  fiatFeeBps,
  fiatMinBaseSats,
  fiatStableForNetwork,
  isFiatModeSwapAvailable,
} from "./depixAssets";

export function FiatModeEnterSheetContent({
  availableSats,
  onConfirm,
  onCancel,
}: {
  availableSats: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const network = getNetworkConfig();
  const swapOk = isFiatModeSwapAvailable(network.id);
  const stable = fiatStableForNetwork(network.id);
  const feePct = (fiatFeeBps(network.id) / 100).toFixed(1);
  const minSats = fiatMinBaseSats(network.id).toLocaleString("en-US");
  const unitName =
    stable.displayCode === "USD" ? "US Dollars (USDT)" : "Brazilian Real (BRL via DePix)";
  const shortName = stable.displayCode;

  return (
    <View style={styles.root}>
      <Text style={sheetUi.title}>Enter Fiat Mode</Text>

      {!swapOk ? (
        <Text style={[styles.body, styles.warn]}>
          No stable swap card is pinned for this network. Switch network in
          Settings to use Fiat Mode.
        </Text>
      ) : (
        <>
          <Text style={styles.body}>
            Fiat Mode keeps your balance in {unitName} instead of bitcoin.
          </Text>
          <Text style={styles.body}>
            When you turn it on, your sats are converted to {shortName} so everyday
            spending feels familiar: prices stay steady while you still use Bitcoin
            under the hood.
          </Text>
          <Text style={styles.body}>
            You can leave Fiat Mode whenever you want and go back to sats.
          </Text>
          <Text style={styles.body}>No KYC is applied!</Text>

          <View style={styles.feeCard}>
            <Text style={styles.feeTitle}>What it costs to switch</Text>
            <Text style={styles.feeLine}>About {feePct}% conversion fee</Text>
            <Text style={styles.feeLine}>Minimum {minSats} sats</Text>
          </View>

          <Text style={styles.available}>
            Available now: {availableSats.toLocaleString("en-US")} sats
          </Text>
        </>
      )}

      {swapOk ? (
        <Pressable
          style={sheetUi.primaryBtn}
          onPress={onConfirm}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Confirm Enter Fiat Mode"
        >
          <Text style={sheetUi.primaryBtnText}>Confirm</Text>
        </Pressable>
      ) : null}
      <Pressable
        style={styles.secondaryBtn}
        onPress={onCancel}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Cancel"
      >
        <Text style={sheetUi.secondaryBtnText}>{swapOk ? "Cancel" : "Close"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingBottom: 8,
  },
  body: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 19,
    marginBottom: 10,
  },
  warn: {
    color: colors.fg,
    marginBottom: 16,
  },
  feeCard: {
    alignSelf: "stretch",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginTop: 8,
    marginBottom: 10,
  },
  feeTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 13,
    color: colors.fg,
    textAlign: "center",
    marginBottom: 8,
  },
  feeLine: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 18,
  },
  available: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    textAlign: "center",
    marginBottom: 8,
  },
  secondaryBtn: {
    ...sheetUi.secondaryBtn,
    backgroundColor: "#000",
  },
});
