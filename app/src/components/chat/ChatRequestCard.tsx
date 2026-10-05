import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { AdaptiveText, useI18n } from "../../i18n";
import { colors } from "../../theme/colors";

export function ChatRequestCard({
  outgoing,
  amountSats,
  memo,
  status,
  timeLabel,
  busy,
  busyLabel,
  onPay,
  onDecline,
  primaryAmount,
  secondaryAmount,
}: {
  outgoing: boolean;
  amountSats: number;
  memo?: string | null;
  status: string | null;
  timeLabel?: string;
  busy?: boolean;
  /** When busy, optional status under Pay (e.g. Converting…). */
  busyLabel?: string | null;
  onPay?: () => void;
  onDecline?: () => void;
  primaryAmount?: string | null;
  secondaryAmount?: string | null;
}) {
  const { t } = useI18n();
  const pending =
    status === "pending" || status === "pending_out" || status === "sent";
  const statusLabel =
    status === "paid"
      ? t("chat.requestPaid")
      : status === "declined"
        ? t("chat.requestDeclined")
        : status === "expired"
          ? t("chat.requestExpired")
          : status === "pending_out"
            ? t("chat.requestWaitingNetwork")
            : t("chat.requestPending");
  const primary =
    primaryAmount?.trim() || `${amountSats.toLocaleString("en-US")} sats`;
  const secondary = secondaryAmount?.trim() || null;

  return (
    <View style={[styles.card, outgoing ? styles.out : styles.in]}>
      <AdaptiveText
        style={[styles.kicker, outgoing && styles.kickerOut]}
        baseFontSize={11}
      >
        {statusLabel}
      </AdaptiveText>
      <Text style={[styles.amount, outgoing && styles.amountOut]}>{primary}</Text>
      {secondary ? (
        <Text style={[styles.secondary, outgoing && styles.secondaryOut]}>
          {secondary}
        </Text>
      ) : null}
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
            accessibilityLabel={t("chat.decline")}
          >
            <AdaptiveText style={styles.declineText} baseFontSize={14}>
              {t("chat.decline")}
            </AdaptiveText>
          </Pressable>
          <Pressable
            style={styles.payBtn}
            disabled={busy}
            onPress={onPay}
            accessibilityRole="button"
            accessibilityLabel={t("chat.pay")}
          >
            {busy ? (
              <View style={styles.busyCol}>
                <ActivityIndicator color="#000" />
                {busyLabel ? (
                  <AdaptiveText style={styles.busyText} baseFontSize={10}>
                    {busyLabel}
                  </AdaptiveText>
                ) : null}
              </View>
            ) : (
              <AdaptiveText style={styles.payText} baseFontSize={14}>
                {t("chat.pay")}
              </AdaptiveText>
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
  secondary: {
    marginTop: 4,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
  },
  secondaryOut: {},
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
    justifyContent: "center",
    minHeight: 44,
  },
  payText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: "#000",
  },
  busyCol: { alignItems: "center", gap: 4 },
  busyText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 10,
    color: "#333",
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
