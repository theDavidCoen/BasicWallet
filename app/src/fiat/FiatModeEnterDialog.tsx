/**
 * Full-screen Enter Fiat Mode confirm (FundsReceived-style; not Alert).
 */

import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme/colors";
import { DEPIX_FEE_BPS, DEPIX_MIN_BASE_SATS } from "./depixAssets";

export function FiatModeEnterDialog({
  availableSats,
  onConfirm,
  onCancel,
}: {
  availableSats: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const feePct = (DEPIX_FEE_BPS / 100).toFixed(1);
  const minSats = DEPIX_MIN_BASE_SATS.toLocaleString("en-US");

  return (
    <View
      style={[
        styles.fill,
        {
          paddingTop: Math.max(insets.top, 12) + 8,
          paddingBottom: insets.bottom + 16,
        },
      ]}
      pointerEvents="auto"
      collapsable={false}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        bounces={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Enter Fiat Mode</Text>

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
          style={styles.primary}
          onPress={onConfirm}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Confirm Enter Fiat Mode"
        >
          <Text style={styles.primaryText}>Confirm</Text>
        </Pressable>
        <Pressable
          style={styles.secondary}
          onPress={onCancel}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    zIndex: 110,
    elevation: 110,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingVertical: 24,
  },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 20,
    color: colors.fg,
    textAlign: "center",
    marginBottom: 20,
  },
  body: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 12,
  },
  feeCard: {
    alignSelf: "stretch",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginTop: 12,
    marginBottom: 12,
  },
  feeTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
    textAlign: "center",
    marginBottom: 10,
  },
  feeLine: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 20,
  },
  available: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    textAlign: "center",
    marginBottom: 28,
  },
  primary: {
    alignSelf: "stretch",
    backgroundColor: colors.fg,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 15,
    color: "#000",
  },
  secondary: {
    alignSelf: "stretch",
    backgroundColor: "#000",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 12,
  },
  secondaryText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 15,
    color: colors.fg,
  },
});
