/**
 * Connect Node hub body for InteractiveBottomSheet (Penpot 06).
 */

import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ConnectProviderStep } from "../navigation/connectFlow";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

const ROWS: {
  letter: string;
  title: string;
  tag: string;
  detail: string;
  on?: ConnectProviderStep;
  soon?: boolean;
}[] = [
  {
    letter: "L",
    title: "LNDHub",
    tag: "LNbits",
    detail: "Scan or paste connection URL",
    on: "lndhub",
  },
  {
    letter: "B",
    title: "BTCPay Server",
    tag: "BTCPay",
    detail: "Services → LND (REST) · may be blocked",
    on: "btcpay",
  },
  {
    letter: "N",
    title: "Nostr Wallet Connect",
    tag: "NWC",
    detail: "Paste connection string",
    soon: true,
  },
  {
    letter: "M",
    title: "Manual LND",
    tag: "macaroon",
    detail: "Endpoint · payments only",
    soon: true,
  },
];

type Props = {
  onSelect: (dest: ConnectProviderStep) => void;
};

export function ConnectNodeSheetContent({ onSelect }: Props) {
  return (
    <View style={styles.root}>
      <Text style={ui.title}>CONNECT NODE</Text>
      <Text style={ui.caption}>Link Lightning for payments.</Text>

      <View style={styles.list}>
        {ROWS.map((row) => (
          <Pressable
            key={row.title}
            style={[styles.row, row.soon && styles.rowSoon]}
            disabled={row.soon || !row.on}
            onPress={() => {
              if (!row.on) return;
              onSelect(row.on);
            }}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{row.letter}</Text>
            </View>
            <View style={styles.body}>
              <Text style={styles.rowTitle}>{row.title}</Text>
              <Text style={styles.rowSub}>
                {row.tag} · {row.detail}
              </Text>
            </View>
            <Text style={styles.chevron}>{row.soon ? "soon" : "›"}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={[ui.hint, { marginTop: 28 }]}>
        Send / receive only.{"\n"}No channel management in-app.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { marginTop: 24, gap: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 12,
  },
  rowSoon: { opacity: 0.45 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.fg,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 16,
    color: colors.fg,
  },
  body: { flex: 1 },
  rowTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
  },
  rowSub: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.caption,
    marginTop: 4,
  },
  chevron: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.hint,
  },
});
