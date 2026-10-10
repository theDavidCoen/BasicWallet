import { StyleSheet, Text, View } from "react-native";
import { getNetworkConfig } from "../config/network";
import { fiatStableForNetwork, formatBrlDisplay } from "../fiat/depixAssets";
import { Button } from "../components/ui";
import { colors } from "../theme/colors";

export type FundsReceivedKind = "boarding" | "arkade" | "lightning" | "brl";

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
  const networkId = getNetworkConfig().id;
  const stable = fiatStableForNetwork(networkId);
  const title =
    kind === "boarding"
      ? "BOARDING RECEIVED"
      : kind === "lightning"
        ? "LIGHTNING RECEIVED"
        : kind === "brl"
          ? `${stable.displayCode} RECEIVED`
          : "FUNDS RECEIVED";
  const caption =
    kind === "boarding"
      ? "Onchain deposit detected.\nIt will settle into Arkade when the batch completes."
      : kind === "lightning"
        ? "Lightning invoice paid.\nNew balance is available."
        : kind === "brl"
          ? `${stable.ticker} / ${stable.displayCode} arrived.\nNew Fiat Mode balance is available.`
          : "New Arkade balance is available.";

  const amountLabel =
    kind === "brl"
      ? `+${formatBrlDisplay(amount, { networkId })}`
      : `+${amount.toLocaleString("en-US")} sats`;

  return (
    <View style={styles.root} collapsable={false}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.amount}>{amountLabel}</Text>
      <Text style={styles.caption}>{caption}</Text>

      <Button
        style={{ alignSelf: "stretch", marginTop: 0 }}
        onPress={onViewDetails}
        accessibilityLabel="View details"
      >
        View details
      </Button>
      <Button
        variant="secondary"
        style={{ alignSelf: "stretch" }}
        onPress={onDone}
        accessibilityLabel="Done"
      >
        Done
      </Button>
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
  secondary: {
    alignSelf: "stretch",
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 16,
    alignItems: "center",
    backgroundColor: "#000",
  },
  secondaryText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 15,
    color: colors.fg,
  },
});
