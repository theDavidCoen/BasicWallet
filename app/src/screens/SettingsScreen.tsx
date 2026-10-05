/**
 * Settings hub. Account / Provider / Advanced are section headers (not nested entries).
 * Arkade-specific rows live under Arkade Settings (incl. Restore Wallet).
 */

import { useNavigation } from "@react-navigation/native";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { colors } from "../theme/colors";

const DANGER = "#E07070";

type NavTarget =
  | "DisplayCurrencies"
  | "BitcoinMaxiSettings"
  | "FiatModeSettings"
  | "AdvancedBackup"
  | "NostrIdentity"
  | "ArchivedWallets"
  | "Contacts"
  | "PayHub"
  | "ResetApp"
  | "Logs"
  | "Privacy"
  | "Notifications"
  | "CursorAgentSettings"
  | "ConnectedNode"
  | "ArkadeSettings"
  | "PairBluetooth"
  | "About";

type Row = {
  label: string;
  stub?: boolean;
  danger?: boolean;
  on?: NavTarget;
};

type Block =
  | { kind: "section"; title: string }
  | { kind: "row"; row: Row };

const BLOCKS: Block[] = [
  { kind: "row", row: { label: "Display currencies", on: "DisplayCurrencies" } },
  { kind: "row", row: { label: "Bitcoin Maxi Mode", on: "BitcoinMaxiSettings" } },
  { kind: "row", row: { label: "Fiat Mode", on: "FiatModeSettings" } },

  { kind: "section", title: "Account" },
  { kind: "row", row: { label: "Privacy", on: "Privacy" } },
  { kind: "row", row: { label: "Notifications", on: "Notifications" } },
  { kind: "row", row: { label: "Archived wallets", on: "ArchivedWallets" } },
  { kind: "row", row: { label: "Duress PIN", stub: true } },

  { kind: "section", title: "Provider Settings" },
  { kind: "row", row: { label: "Arkade", on: "ArkadeSettings" } },
  { kind: "row", row: { label: "Cursor", on: "CursorAgentSettings" } },

  { kind: "section", title: "Nostr" },
  { kind: "row", row: { label: "Nostr Identity", on: "NostrIdentity" } },
  { kind: "row", row: { label: "Chat & Pay", on: "PayHub" } },
  { kind: "row", row: { label: "Contacts", on: "Contacts" } },

  { kind: "section", title: "Advanced settings" },
  { kind: "row", row: { label: "Logs", on: "Logs" } },
  { kind: "row", row: { label: "Connected node", on: "ConnectedNode" } },
  { kind: "row", row: { label: "Hardware wallet", stub: true } },
  { kind: "row", row: { label: "Multisig", stub: true } },
  { kind: "row", row: { label: "Backup", on: "AdvancedBackup" } },
  { kind: "row", row: { label: "Pair with Bluetooth", on: "PairBluetooth" } },
  { kind: "row", row: { label: "Reset app", on: "ResetApp", danger: true } },

  { kind: "row", row: { label: "About", on: "About" } },
];

export function SettingsScreen() {
  const navigation = useNavigation<RootNav>();

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
                navigation.navigate(row.on);
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
