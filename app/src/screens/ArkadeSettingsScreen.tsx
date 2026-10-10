/**
 * Arkade-specific settings: network, delegates, restore, recovery, exits.
 */

import { useNavigation } from "@react-navigation/native";
import { ScrollView, StyleSheet } from "react-native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { ScreenTitle, SettingsRow } from "../components/ui";
import { useI18n } from "../i18n";

type Row = {
  labelKey: string;
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
  { labelKey: "arkade.network", on: "ArkadeNetwork" },
  { labelKey: "arkade.delegates", on: "Delegates" },
  { labelKey: "arkade.restoreWallet", on: "RestoreWallet" },
  { labelKey: "arkade.recoveryAddress", on: "ExitRecoveryAddress" },
  { labelKey: "arkade.collaborativeExit", on: "CollaborativeOffboard" },
  { labelKey: "arkade.unilateralExit", on: "UnilateralExitHub", danger: true },
];

export function ArkadeSettingsScreen() {
  const navigation = useNavigation<RootNav>();
  const { t } = useI18n();

  return (
    <ScreenChrome logoScale={0.77}>
      <ScreenTitle style={styles.title}>{t("arkade.title")}</ScreenTitle>
      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 40 }}>
        {ROWS.map((row) => (
          <SettingsRow
            key={row.labelKey}
            label={t(row.labelKey)}
            danger={row.danger}
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
          />
        ))}
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  title: {
    marginVertical: 16,
    marginBottom: 16,
  },
  list: { flex: 1 },
});
