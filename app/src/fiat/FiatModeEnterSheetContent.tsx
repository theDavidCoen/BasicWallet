/**
 * Enter Fiat Mode body for InteractiveBottomSheet (Home).
 */

import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { colors } from "../theme/colors";
import { sheetUi } from "../theme/sheetUi";
import { DEPIX_FEE_BPS, DEPIX_MIN_BASE_SATS } from "./depixAssets";

export function FiatModeEnterSheetContent({
  availableSats,
  onConfirm,
  onCancel,
}: {
  availableSats: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const feePct = (DEPIX_FEE_BPS / 100).toFixed(1);
  const minSats = DEPIX_MIN_BASE_SATS.toLocaleString("en-US");

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      bounces={false}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Text style={sheetUi.title}>Enter Fiat Mode</Text>

      <Text style={styles.body}>
        Fiat Mode keeps your balance in Brazilian Real instead of bitcoin.
      </Text>
      <Text style={styles.body}>
        When you turn it on, your sats are converted to BRL so everyday spending
        feels familiar: prices stay steady while you still use Bitcoin under the
        hood.
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

      <Pressable
        style={sheetUi.primaryBtn}
        onPress={onConfirm}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Confirm Enter Fiat Mode"
      >
        <Text style={sheetUi.primaryBtnText}>Confirm</Text>
      </Pressable>
      <Pressable
        style={styles.secondaryBtn}
        onPress={onCancel}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Cancel"
      >
        <Text style={sheetUi.secondaryBtnText}>Cancel</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
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
