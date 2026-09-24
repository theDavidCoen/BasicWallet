/**
 * Node Status body for InteractiveBottomSheet — post-connect summary.
 */

import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";
import { sheetUi } from "../theme/sheetUi";
import { ui } from "../theme/ui";
import type { NodeStatusPayload } from "../navigation/connectFlow";

type Props = {
  payload: NodeStatusPayload;
  onDone: () => void;
};

export function NodeStatusSheetContent({
  payload,
  onDone,
}: Props) {
  const { localSats, alias, pubkey } = payload;
  const bal =
    typeof localSats === "number"
      ? `${localSats.toLocaleString("en-US")} sats`
      : "—";

  return (
    <View style={styles.root}>
      <Text style={sheetUi.title}>NODE</Text>
      <View style={ui.card}>
        <Text style={styles.ok}>Connected · Lightning</Text>
        <Text style={styles.alias}>{alias?.trim() || "Lightning"}</Text>
        <Text style={styles.bal}>{bal}</Text>
        <Text style={styles.caption}>Local channel balance</Text>
        {pubkey ? (
          <Text style={styles.pub} numberOfLines={2}>
            {pubkey}
          </Text>
        ) : null}
      </View>

      <Text style={[sheetUi.hint, { marginTop: 20 }]}>
        Switcher row uses this balance on Home.{"\n"}
        Send and receive Lightning invoices from this node. No channels UI.
      </Text>

      <Pressable style={sheetUi.primaryBtn} onPress={onDone}>
        <Text style={sheetUi.primaryBtnText}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  ok: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 16,
    color: colors.fg,
    marginBottom: 8,
  },
  alias: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
    marginBottom: 16,
  },
  bal: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 28,
    color: colors.fg,
  },
  caption: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    marginTop: 6,
  },
  pub: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
    marginTop: 16,
  },
});
