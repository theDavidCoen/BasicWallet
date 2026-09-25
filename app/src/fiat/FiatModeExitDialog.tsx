/**
 * Full-screen Exit Fiat Mode confirm (FundsReceived-style; not Alert).
 */

import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme/colors";
import { DEPIX_FEE_BPS, formatBrlDisplay } from "./depixAssets";

export function FiatModeExitDialog({
  brlDisplay,
  onConfirm,
  onCancel,
}: {
  brlDisplay: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const feePct = (DEPIX_FEE_BPS / 100).toFixed(1);

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
        <Text style={styles.title}>Exit Fiat Mode</Text>

        <Text style={styles.body}>
          Leaving Fiat Mode converts your Brazilian Real balance back to sats.
        </Text>
        <Text style={styles.body}>
          About {feePct}% conversion fee applies the same way as when you entered.
        </Text>
        <Text style={styles.body}>
          Current balance: {formatBrlDisplay(brlDisplay)}
        </Text>
        <Text style={[styles.body, styles.bodyLast]}>
          You can turn Fiat Mode on again whenever you want.
        </Text>

        <Pressable
          style={styles.primary}
          onPress={onConfirm}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Confirm Exit Fiat Mode"
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
  bodyLast: {
    marginBottom: 36,
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
