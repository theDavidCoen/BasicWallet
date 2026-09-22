import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { colors } from "../theme/colors";

export type FundsReceivedKind = "boarding" | "arkade" | "lightning";

export function FundsReceivedView({
  amount,
  kind,
  onViewDetails,
  onDone,
}: {
  amount: number;
  kind: FundsReceivedKind;
  onViewDetails: () => void;
  onDone: () => void;
}) {
  const title =
    kind === "boarding"
      ? "BOARDING RECEIVED"
      : kind === "lightning"
        ? "LIGHTNING RECEIVED"
        : "FUNDS RECEIVED";
  const caption =
    kind === "boarding"
      ? "Onchain deposit detected.\nIt will settle into Arkade when the batch completes."
      : kind === "lightning"
        ? "Lightning invoice paid.\nNew balance is available."
        : "New Arkade balance is available.";

  return (
    <View style={styles.root} collapsable={false}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.amount}>+{amount.toLocaleString("en-US")} sats</Text>
      <Text style={styles.caption}>{caption}</Text>

      <Pressable
        style={styles.primary}
        onPress={onViewDetails}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="View details"
      >
        <Text style={styles.primaryText}>View details</Text>
      </Pressable>
      <Pressable
        style={styles.secondary}
        onPress={onDone}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Done"
      >
        <Text style={styles.secondaryText}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    backgroundColor: colors.bg,
  },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 20,
    color: colors.fg,
    textAlign: "center",
  },
  amount: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 28,
    color: "#8FDF8F",
    textAlign: "center",
    marginTop: 16,
  },
  caption: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 20,
    marginTop: 14,
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
