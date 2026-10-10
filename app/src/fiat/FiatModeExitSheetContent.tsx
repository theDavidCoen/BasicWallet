/**
 * Exit Fiat Mode body for InteractiveBottomSheet (Home).
 * Same reliable pattern as Enter: ScrollView + sticky Confirm/Cancel.
 * Sheet uses fixed visibleFraction (no fitContent) so translateY stays bottom-anchored.
 */

import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, ScreenTitle } from "../components/ui";
import { getNetworkConfig } from "../config/network";
import { fiatFeeBps, fiatStableForNetwork, formatBrlDisplay } from "./depixAssets";
import { colors } from "../theme/colors";
import { sheetUi } from "../theme/sheetUi";

export function FiatModeExitSheetContent({
  brlDisplay,
  onConfirm,
  onCancel,
}: {
  brlDisplay: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const networkId = getNetworkConfig().id;
  const stable = fiatStableForNetwork(networkId);
  const feePct = (fiatFeeBps(networkId) / 100).toFixed(1);
  const unitLabel =
    stable.displayCode === "USD" ? "US Dollar" : "Brazilian Real";

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        bounces={false}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScreenTitle style={sheetUi.title}>Exit Fiat Mode</ScreenTitle>

        <Text style={styles.body}>
          Leaving Fiat Mode converts your {unitLabel} balance back to sats.
        </Text>
        <Text style={styles.body}>
          About {feePct}% conversion fee applies the same way as when you entered.
        </Text>
        <Text style={styles.body}>
          Current balance: {formatBrlDisplay(brlDisplay, { networkId })}
        </Text>
        <Text style={[styles.body, styles.bodyLast]}>
          You can turn Fiat Mode on again whenever you want.
        </Text>
      </ScrollView>

      <View style={styles.actions}>
        <Button
          size="sheet"
          onPress={onConfirm}
          accessibilityLabel="Confirm Exit Fiat Mode"
        >
          Confirm
        </Button>
        <Button
          size="sheet"
          variant="secondary"
          style={styles.secondaryBtn}
          onPress={onCancel}
          accessibilityLabel="Cancel"
        >
          Cancel
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 12,
    flexGrow: 1,
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
  actions: {
    paddingTop: 4,
    paddingBottom: 8,
  },
  secondaryBtn: {
    backgroundColor: "#000",
  },
});
