/**
 * Arkade-specific settings: network, delegates, restore, recovery, exits.
 */

import { useNavigation } from "@react-navigation/native";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { colors } from "../theme/colors";

const DANGER = "#E07070";

type Row = {
  label: string;
  danger?: boolean;
  on:
    | "ArkadeNetwork"
    | "Delegates"
    | "RestoreWallet"
    | "ExitRecoveryAddress"
    | "CollaborativeOffboard"
    | "UnilateralExitHub";
};

const ROWS: Row[] = [
  { label: "Network", on: "ArkadeNetwork" },
  { label: "Delegates", on: "Delegates" },
  { label: "Restore Wallet", on: "RestoreWallet" },
  { label: "Recovery address", on: "ExitRecoveryAddress" },
  { label: "Collaborative Exit", on: "CollaborativeOffboard" },
  { label: "Unilateral Exit", on: "UnilateralExitHub", danger: true },
];

export function ArkadeSettingsScreen() {
  const navigation = useNavigation<RootNav>();

  return (
    <ScreenChrome logoScale={0.77}>
      <Text style={styles.title}>ARKADE</Text>
      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 40 }}>
        {ROWS.map((row) => (
          <Pressable
            key={row.label}
            style={styles.row}
            onPress={() => {
              if (row.on === "RestoreWallet") {
                // Settings path: seed only. Home/Nostr package restore stays on
                // onboarding + Backup hub flows (mode "full").
                navigation.navigate("RestoreWallet", { mode: "seed" });
                return;
              }
              if (row.on === "ExitRecoveryAddress") {
                navigation.navigate("ExitRecoveryAddress");
                return;
              }
              navigation.navigate(row.on);
            }}
          >
            <Text style={[styles.rowLabel, row.danger && styles.dangerLabel]}>
              {row.label}
            </Text>
            <Text style={[styles.chevron, row.danger && styles.dangerLabel]}>›</Text>
          </Pressable>
        ))}
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
