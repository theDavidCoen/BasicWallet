import * as Clipboard from "expo-clipboard";
import { useMemo } from "react";
import {
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors } from "../../theme/colors";

const HTTPS_URL_RE = /https:\/\/[^\s<>"'）)\]]+/gi;

function trimTrailingPunct(url: string): string {
  return url.replace(/[.,;:!?)]+$/g, "");
}

function splitBodyWithLinks(
  body: string,
): Array<{ type: "text" | "link"; value: string }> {
  const parts: Array<{ type: "text" | "link"; value: string }> = [];
  let last = 0;
  const re = new RegExp(HTTPS_URL_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) != null) {
    if (m.index > last) {
      parts.push({ type: "text", value: body.slice(last, m.index) });
    }
    const raw = m[0];
    const url = trimTrailingPunct(raw);
    parts.push({ type: "link", value: url });
    const trailing = raw.slice(url.length);
    if (trailing) parts.push({ type: "text", value: trailing });
    last = m.index + raw.length;
  }
  if (last < body.length) {
    parts.push({ type: "text", value: body.slice(last) });
  }
  if (parts.length === 0) parts.push({ type: "text", value: body });
  return parts;
}

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
  const parts = useMemo(() => splitBodyWithLinks(body), [body]);
  const hasLink = parts.some((p) => p.type === "link");

  async function onLongPress() {
    const text = body.trim();
    if (!text) return;
    try {
      await Clipboard.setStringAsync(text);
      Alert.alert("Copied", "Message copied.");
    } catch {
      /* */
    }
  }

  async function openLink(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert("Could not open link", url.slice(0, 120));
    }
  }

  return (
    <Pressable
      onLongPress={() => void onLongPress()}
      delayLongPress={350}
      accessibilityRole="text"
      accessibilityHint={
        hasLink
          ? "Tap a link to open. Long-press to copy."
          : "Long-press to copy."
      }
    >
      <View style={[styles.wrap, outgoing ? styles.out : styles.in]}>
        <Text style={[styles.body, outgoing ? styles.bodyOut : styles.bodyIn]}>
          {parts.map((p, i) =>
            p.type === "link" ? (
              <Text
                key={`l-${i}`}
                style={[styles.link, outgoing ? styles.linkOut : styles.linkIn]}
                onPress={() => void openLink(p.value)}
              >
                {p.value}
              </Text>
            ) : (
              <Text key={`t-${i}`}>{p.value}</Text>
            ),
          )}
        </Text>
        <View style={styles.meta}>
          {timeLabel ? (
            <Text style={[styles.metaText, outgoing && styles.metaOut]}>
              {timeLabel}
            </Text>
          ) : null}
          {status === "pending_out" ? (
            <Text style={[styles.metaText, outgoing && styles.metaOut]}>
              Waiting for network
            </Text>
          ) : status === "failed" ? (
            <Text style={[styles.metaText, outgoing && styles.metaOut]}>
              Failed
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
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
  link: {
    textDecorationLine: "underline",
  },
  linkOut: { color: "#0A5" },
  linkIn: { color: "#7EC8FF" },
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
