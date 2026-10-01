import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme/colors";

export function ChatTextBubble({
  body,
  outgoing,
  status,
  timeLabel,
}: {
  body: string;
  outgoing: boolean;
  status?: string | null;
  timeLabel?: string;
}) {
  return (
    <View style={[styles.wrap, outgoing ? styles.out : styles.in]}>
      <Text style={[styles.body, outgoing ? styles.bodyOut : styles.bodyIn]}>{body}</Text>
      <View style={styles.meta}>
        {timeLabel ? (
          <Text style={[styles.metaText, outgoing && styles.metaOut]}>{timeLabel}</Text>
        ) : null}
        {status === "pending_out" ? (
          <Text style={[styles.metaText, outgoing && styles.metaOut]}>Waiting for network</Text>
        ) : status === "failed" ? (
          <Text style={[styles.metaText, outgoing && styles.metaOut]}>Failed</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    maxWidth: "88%",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginVertical: 4,
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
  body: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    lineHeight: 20,
  },
  bodyOut: { color: "#000" },
  bodyIn: { color: colors.fg },
  meta: {
    marginTop: 4,
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
  },
  metaText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 10,
    color: colors.hint,
  },
  metaOut: { color: "#666" },
});
