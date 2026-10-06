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
/** `PIN: CODE` or `PIN: CODE https://…` (deeplink attached to PIN value). */
const PIN_RE =
  /PIN:\s*([A-Za-z0-9][A-Za-z0-9._-]*)(?:\s+(https:\/\/[^\s<>"'）)\]]+))?/gi;

function trimTrailingPunct(url: string): string {
  return url.replace(/[.,;:!?)]+$/g, "");
}

type BodyPart =
  | { type: "text"; value: string }
  | { type: "link"; value: string }
  | { type: "pin"; label: string; copyValue: string; url?: string };

function splitBodyWithLinks(body: string): BodyPart[] {
  const parts: BodyPart[] = [];
  let last = 0;
  // Merge PIN + bare HTTPS matches in one left-to-right pass.
  type Hit =
    | { kind: "pin"; index: number; end: number; code: string; url?: string }
    | { kind: "link"; index: number; end: number; url: string };
  const hits: Hit[] = [];
  const pinRe = new RegExp(PIN_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = pinRe.exec(body)) != null) {
    const code = m[1] ?? "";
    const rawUrl = m[2] ? trimTrailingPunct(m[2]) : undefined;
    hits.push({
      kind: "pin",
      index: m.index,
      end: m.index + m[0].length,
      code,
      url: rawUrl,
    });
  }
  const linkRe = new RegExp(HTTPS_URL_RE.source, "gi");
  while ((m = linkRe.exec(body)) != null) {
    const url = trimTrailingPunct(m[0]);
    const end = m.index + url.length;
    // Skip URLs already consumed as PIN deeplinks.
    const covered = hits.some(
      (h) => h.kind === "pin" && m!.index >= h.index && end <= h.end,
    );
    if (!covered) {
      hits.push({ kind: "link", index: m.index, end, url });
    }
  }
  hits.sort((a, b) => a.index - b.index || a.end - b.end);

  for (const hit of hits) {
    if (hit.index < last) continue;
    if (hit.index > last) {
      parts.push({ type: "text", value: body.slice(last, hit.index) });
    }
    if (hit.kind === "pin") {
      parts.push({
        type: "pin",
        label: `PIN: ${hit.code}`,
        copyValue: hit.code,
        url: hit.url,
      });
    } else {
      parts.push({ type: "link", value: hit.url });
    }
    last = hit.end;
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
  const hasLink = parts.some(
    (p) => p.type === "link" || (p.type === "pin" && Boolean(p.url)),
  );
  const hasPinCopy = parts.some((p) => p.type === "pin" && !p.url);

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

  async function onPinPress(p: Extract<BodyPart, { type: "pin" }>) {
    if (p.url) {
      await openLink(p.url);
      return;
    }
    try {
      await Clipboard.setStringAsync(p.copyValue);
      Alert.alert("Copied", "PIN copied.");
    } catch {
      /* */
    }
  }

  return (
    <Pressable
      onLongPress={() => void onLongPress()}
      delayLongPress={350}
      accessibilityRole="text"
      accessibilityHint={
        hasLink
          ? "Tap a link or PIN to open. Long-press to copy."
          : hasPinCopy
            ? "Tap PIN to copy. Long-press to copy message."
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
            ) : p.type === "pin" ? (
              <Text
                key={`p-${i}`}
                style={[styles.link, outgoing ? styles.linkOut : styles.linkIn]}
                onPress={() => void onPinPress(p)}
              >
                {p.label}
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
