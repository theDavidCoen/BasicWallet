import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme/colors";

export function ChatPaymentCard({
  outgoing,
  amountSats,
  memo,
  timeLabel,
}: {
  outgoing: boolean;
  amountSats: number;
  memo?: string | null;
  timeLabel?: string;
}) {
  return (
    <View style={[styles.card, outgoing ? styles.out : styles.in]}>
      <Text style={[styles.title, outgoing && styles.titleOut]}>
        {outgoing ? "You sent" : "You received"}
      </Text>
      <Text style={[styles.amount, outgoing && styles.amountOut]}>
        {amountSats.toLocaleString("en-US")} sats
      </Text>
      {memo ? (
        <Text style={[styles.memo, outgoing && styles.memoOut]} numberOfLines={3}>
          {memo}
        </Text>
      ) : null}
      {timeLabel ? (
        <Text style={[styles.time, outgoing && styles.timeOut]}>{timeLabel}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    maxWidth: "92%",
    borderRadius: 12,
    padding: 14,
    marginVertical: 6,
  },
  out: {
    alignSelf: "flex-end",
    backgroundColor: colors.fg,
  },
  in: {
    alignSelf: "flex-start",
    backgroundColor: "#0D0D0D",
    borderWidth: 1,
    borderColor: "#333",
  },
  title: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    marginBottom: 6,
  },
  titleOut: { color: "#555" },
  amount: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 18,
    color: colors.fg,
  },
  amountOut: { color: "#000" },
  memo: {
    marginTop: 8,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
  },
  memoOut: { color: "#444" },
  time: {
    marginTop: 8,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 10,
    color: colors.hint,
    textAlign: "right",
  },
  timeOut: { color: "#666" },
});
