import { StyleSheet, Text, View } from "react-native";
import type { ChatMessageStatus } from "../../chat/types";
import { useI18n } from "../../i18n";
import { colors } from "../../theme/colors";

function paymentTitle(
  t: (scope: string) => string,
  outgoing: boolean,
  status: ChatMessageStatus | null | undefined,
  receivingLabel?: string | null,
): string {
  if (!outgoing) {
    if (status === "arriving") {
      return receivingLabel?.trim() || t("chat.receivingEllipsis");
    }
    if (status === "converting") return t("chat.converting");
    return t("chat.youReceived");
  }
  if (status === "converting") return t("chat.converting");
  if (status === "sending" || status === "pending" || status === "pending_out") {
    return t("chat.sending");
  }
  if (status === "failed") return t("chat.sendFailed");
  return t("chat.youSent");
}

export function ChatPaymentCard({
  outgoing,
  amountSats,
  memo,
  timeLabel,
  status,
  primaryAmount,
  secondaryAmount,
  receivingLabel,
  hideAmount,
}: {
  outgoing: boolean;
  amountSats: number;
  memo?: string | null;
  timeLabel?: string;
  status?: ChatMessageStatus | null;
  /** Viewer-mode primary (defaults to sats). */
  primaryAmount?: string | null;
  /** Optional secondary line (e.g. ≈ N sats for Fiat). */
  secondaryAmount?: string | null;
  /** Fiat inbound pending title, e.g. "You are receiving R$". */
  receivingLabel?: string | null;
  /** Hide amount while inbound Fiat is arriving/converting. */
  hideAmount?: boolean;
}) {
  const { t } = useI18n();
  const primary =
    primaryAmount?.trim() || `${amountSats.toLocaleString("en-US")} sats`;
  const secondary = secondaryAmount?.trim() || null;
  const title = paymentTitle(t, outgoing, status, receivingLabel);
  const inboundPending =
    !outgoing && (status === "arriving" || status === "converting");
  const inFlight =
    inboundPending ||
    (outgoing &&
      (status === "converting" ||
        status === "sending" ||
        status === "pending" ||
        status === "pending_out"));
  const failed = outgoing && status === "failed";
  const showAmount = !hideAmount && !inboundPending;

  return (
    <View style={[styles.card, outgoing ? styles.out : styles.in]}>
      <Text
        style={[
          styles.title,
          outgoing && styles.titleOut,
          failed && styles.titleFailed,
          inFlight && styles.titleInFlight
        ]}>
        {title}
      </Text>
      {showAmount ? (
        <Text style={[styles.amount, outgoing && styles.amountOut]}>{primary}</Text>
      ) : null}
      {showAmount && secondary ? (
        <Text style={[styles.secondary, outgoing && styles.secondaryOut]}>
          {secondary}
        </Text>
      ) : null}
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
  titleInFlight: { color: "#888" },
  titleFailed: { color: "#B00020" },
  amount: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 18,
    color: colors.fg,
  },
  amountOut: { color: "#000" },
  secondary: {
    marginTop: 4,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
  },
  secondaryOut: { color: "#555" },
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
