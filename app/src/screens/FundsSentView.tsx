import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";

function midEllipsis(s: string, left = 12, right = 8): string {
  if (s.length <= left + right + 1) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

export type FundsSentRail = "arkade" | "lightning";

export function FundsSentView({
  amount,
  amountLabel,
  txid,
  address,
  recipientCount,
  rail = "arkade",
  onViewActivity,
  onSaveToContacts,
  onDone,
}: {
  amount: number;
  /** Prefers over sats (e.g. "−R$ 2,00"). */
  amountLabel?: string;
  txid: string;
  address?: string;
  /** When > 1, show "to N addresses" instead of a single address. */
  recipientCount?: number;
  rail?: FundsSentRail;
  onViewActivity: () => void;
  onSaveToContacts?: () => void;
  onDone: () => void;
}) {
  const caption =
    rail === "lightning" ? "Lightning payment sent." : "Arkade payment submitted.";
  const idLabel = rail === "lightning" ? "hash" : "tx";
  const n = recipientCount != null && recipientCount > 0 ? recipientCount : address ? 1 : 0;
  const showSaveToContacts = Boolean(onSaveToContacts && address && n <= 1);
  const amountText =
    amountLabel?.trim() ||
    `−${Math.abs(amount).toLocaleString("en-US")} sats`;

  return (
    <View style={styles.root} collapsable={false}>
      <Text style={styles.title}>FUNDS SENT</Text>
      <Text style={styles.amount}>{amountText}</Text>
      <Text style={styles.caption}>{caption}</Text>
      {n > 1 ? (
        <Text style={styles.meta}>to {n} addresses · one tx</Text>
      ) : address ? (
        <Text style={styles.meta}>to {midEllipsis(address, 14, 8)}</Text>
      ) : null}
      {txid ? (
        <Text style={styles.meta}>
          {idLabel} {midEllipsis(txid, 12, 8)}
        </Text>
      ) : null}

      <Pressable
        style={styles.primary}
        onPress={onViewActivity}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="View details"
      >
        <Text style={styles.primaryText}>View details</Text>
      </Pressable>
      {showSaveToContacts ? (
        <Pressable
          style={styles.secondary}
          onPress={onSaveToContacts}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Save to contacts"
        >
          <Text style={styles.secondaryText}>Save to contacts</Text>
        </Pressable>
      ) : null}
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
    color: "#E09090",
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
  },
  meta: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    textAlign: "center",
    marginTop: 8,
  },
  primary: {
    alignSelf: "stretch",
    backgroundColor: colors.fg,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 36,
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
