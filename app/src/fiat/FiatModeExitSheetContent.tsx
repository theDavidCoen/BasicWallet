/**
 * Exit Fiat Mode body for InteractiveBottomSheet (Home).
 */

import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { colors } from "../theme/colors";
import { sheetUi } from "../theme/sheetUi";
import { DEPIX_FEE_BPS, formatBrlDisplay } from "./depixAssets";

export function FiatModeExitSheetContent({
  brlDisplay,
  onConfirm,
  onCancel,
}: {
  brlDisplay: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const feePct = (DEPIX_FEE_BPS / 100).toFixed(1);

  return (
    <View style={styles.root}>
      <Text style={sheetUi.title}>Exit Fiat Mode</Text>

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
        style={sheetUi.primaryBtn}
        onPress={onConfirm}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Confirm Exit Fiat Mode"
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
  bodyLast: {
    marginBottom: 4,
  },
  secondaryBtn: {
    ...sheetUi.secondaryBtn,
    backgroundColor: "#000",
  },
});
