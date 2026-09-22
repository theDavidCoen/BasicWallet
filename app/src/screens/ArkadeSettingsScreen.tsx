/**
 * Arkade-specific settings: network, delegates, recovery, exits.
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
    | "ExitRecoveryAddress"
    | "CollaborativeOffboard"
    | "UnilateralExitHub";
};

const ROWS: Row[] = [
  { label: "Network", on: "ArkadeNetwork" },
  { label: "Delegates", on: "Delegates" },
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
              if (row.on === "ExitRecoveryAddress") {
                navigation.navigate("ExitRecoveryAddress");
                return;
              }
              navigation.navigate(row.on);
            }}
          >
            <Text style={[styles.rowText, row.danger && { color: DANGER }]}>
              {row.label}
            </Text>
            <Text style={styles.chev}>›</Text>
          </Pressable>
        ))}
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.fg,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 1,
    textAlign: "center",
    marginBottom: 20,
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
  rowText: { color: colors.fg, fontSize: 16 },
  chev: { color: colors.caption, fontSize: 22 },
});
