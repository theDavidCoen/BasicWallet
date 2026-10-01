import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme/colors";

export function ChatRequestCard({
  outgoing,
  amountSats,
  memo,
  status,
  timeLabel,
  busy,
  onPay,
  onDecline,
}: {
  outgoing: boolean;
  amountSats: number;
  memo?: string | null;
  status: string | null;
  timeLabel?: string;
  busy?: boolean;
  onPay?: () => void;
  onDecline?: () => void;
}) {
  const pending =
    status === "pending" || status === "pending_out" || status === "sent";
  const statusLabel =
    status === "paid"
      ? "paid"
      : status === "declined"
        ? "declined"
        : status === "expired"
          ? "expired"
          : status === "pending_out"
            ? "Waiting for network"
            : "pending";

  return (
    <View style={[styles.card, outgoing ? styles.out : styles.in]}>
      <Text style={[styles.kicker, outgoing && styles.kickerOut]}>
        Request · {statusLabel}
      </Text>
      <Text style={[styles.amount, outgoing && styles.amountOut]}>
        {amountSats.toLocaleString("en-US")} sats
      </Text>
      {memo ? (
        <Text style={[styles.memo, outgoing && styles.memoOut]} numberOfLines={3}>
          {memo}
        </Text>
      ) : null}
      {!outgoing && pending ? (
        <View style={styles.actions}>
          <Pressable
            style={styles.declineBtn}
            disabled={busy}
            onPress={onDecline}
            accessibilityRole="button"
            accessibilityLabel="Decline"
          >
            <Text style={styles.declineText}>Decline</Text>
          </Pressable>
          <Pressable
            style={styles.payBtn}
            disabled={busy}
            onPress={onPay}
            accessibilityRole="button"
            accessibilityLabel="Pay"
          >
            {busy ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.payText}>Pay</Text>
            )}
          </Pressable>
        </View>
      ) : null}
      {timeLabel ? (
        <Text style={[styles.time, outgoing && styles.timeOut]}>{timeLabel}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    maxWidth: "94%",
    borderRadius: 12,
    padding: 14,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignSelf: "stretch",
  },
  out: { alignSelf: "flex-end", width: "94%" },
  in: { alignSelf: "flex-start", width: "94%" },
  kicker: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.caption,
    marginBottom: 6,
  },
  kickerOut: {},
  amount: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 18,
    color: colors.fg,
  },
  amountOut: {},
  memo: {
    marginTop: 8,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
  },
  memoOut: {},
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  declineBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    alignItems: "center",
  },
  declineText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
  },
  payBtn: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: colors.fg,
    paddingVertical: 12,
    alignItems: "center",
  },
  payText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: "#000",
  },
  time: {
    marginTop: 10,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 10,
    color: colors.hint,
    textAlign: "right",
  },
  timeOut: {},
});
