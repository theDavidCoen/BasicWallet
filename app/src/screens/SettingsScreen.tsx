/**
 * Settings hub. Account / Wallet Settings are section headers (not nested entries).
 * Arkade-specific rows live under Arkade Settings.
 */

import { useNavigation } from "@react-navigation/native";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { colors } from "../theme/colors";

const DANGER = "#E07070";

type NavTarget =
  | "DisplayCurrencies"
  | "AdvancedBackup"
  | "NostrIdentity"
  | "RestoreWallet"
  | "ResetApp"
  | "Privacy"
  | "ConnectedNode"
  | "ArkadeSettings"
  | "About";

type Row = {
  label: string;
  stub?: boolean;
  danger?: boolean;
  on?: NavTarget;
  restoreMode?: "full";
};

type Block =
  | { kind: "section"; title: string }
  | { kind: "row"; row: Row };

const BLOCKS: Block[] = [
  { kind: "row", row: { label: "Display currencies", on: "DisplayCurrencies" } },

  { kind: "section", title: "Account" },
  { kind: "row", row: { label: "Privacy", on: "Privacy" } },
  { kind: "row", row: { label: "Nostr identity", on: "NostrIdentity" } },
  { kind: "row", row: { label: "Contacts", stub: true } },
  { kind: "row", row: { label: "Duress PIN", stub: true } },

  { kind: "section", title: "Wallet Settings" },
  { kind: "row", row: { label: "Connected node", on: "ConnectedNode" } },
  { kind: "row", row: { label: "Hardware wallet", stub: true } },
  { kind: "row", row: { label: "Multisig", stub: true } },
  { kind: "row", row: { label: "Backup", on: "AdvancedBackup" } },
  { kind: "row", row: { label: "Restore", on: "RestoreWallet", restoreMode: "full" } },

  { kind: "section", title: "Provider Settings" },
  { kind: "row", row: { label: "Arkade", on: "ArkadeSettings" } },

  { kind: "row", row: { label: "Reset app", on: "ResetApp", danger: true } },
  { kind: "row", row: { label: "About", on: "About" } },
];

export function SettingsScreen() {
  const navigation = useNavigation<RootNav>();

  const go = (target: NavTarget, restoreMode?: "full") => {
    if (target === "RestoreWallet") {
      navigation.navigate("RestoreWallet", { mode: restoreMode ?? "full" });
    } else {
      navigation.navigate(target);
    }
  };

  return (
    <ScreenChrome logoScale={0.77}>
      <Text style={styles.title}>SETTINGS</Text>
      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 40 }}>
        {BLOCKS.map((block, i) => {
          if (block.kind === "section") {
            return (
              <Text
                key={`sec-${block.title}`}
                style={[styles.section, i === 0 && styles.sectionFirst]}
              >
                {block.title}
              </Text>
            );
          }
          const { row } = block;
          return (
            <Pressable
              key={row.label}
              style={styles.row}
              onPress={() => {
                if (!row.on) return;
                go(row.on, row.restoreMode);
              }}
            >
              <Text style={[styles.rowLabel, row.danger && styles.dangerLabel]}>
                {row.label}
              </Text>
              <Text style={[styles.chevron, row.danger && styles.dangerLabel]}>
                {row.stub ? "soon" : "›"}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 20,
    color: colors.fg,
    textAlign: "center",
    marginVertical: 16,
  },
  list: { flex: 1 },
  section: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 12,
    color: colors.hint,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 28,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sectionFirst: { marginTop: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 16,
    color: colors.fg,
    flex: 1,
    paddingRight: 12,
  },
  chevron: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 16,
    color: colors.caption,
  },
  dangerLabel: { color: DANGER },
});
