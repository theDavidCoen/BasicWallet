/**
 * Settings hub. Account / Provider / Advanced are section headers (not nested entries).
 * Arkade-specific rows live under Arkade Settings (incl. Restore Wallet).
 */

import { useNavigation } from "@react-navigation/native";
import { ScrollView, StyleSheet } from "react-native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import {
  ScreenTitle,
  SectionHeader,
  SettingsRow,
} from "../components/ui";
import { useI18n } from "../i18n";

type NavTarget =
  | "Language"
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
  labelKey: string;
  stub?: boolean;
  danger?: boolean;
  on?: NavTarget;
};

type Block =
  | { kind: "section"; titleKey: string }
  | { kind: "row"; row: Row };

const BLOCKS: Block[] = [
  { kind: "row", row: { labelKey: "settings.language", on: "Language" } },
  { kind: "row", row: { labelKey: "settings.displayCurrencies", on: "DisplayCurrencies" } },
  { kind: "row", row: { labelKey: "settings.bitcoinMaxiMode", on: "BitcoinMaxiSettings" } },
  { kind: "row", row: { labelKey: "settings.fiatMode", on: "FiatModeSettings" } },

  { kind: "section", titleKey: "settings.sectionAccount" },
  { kind: "row", row: { labelKey: "settings.privacy", on: "Privacy" } },
  { kind: "row", row: { labelKey: "settings.notifications", on: "Notifications" } },
  { kind: "row", row: { labelKey: "settings.archivedWallets", on: "ArchivedWallets" } },
  { kind: "row", row: { labelKey: "settings.duressPin", stub: true } },

  { kind: "section", titleKey: "settings.sectionProvider" },
  { kind: "row", row: { labelKey: "settings.arkade", on: "ArkadeSettings" } },
  { kind: "row", row: { labelKey: "settings.cursor", on: "CursorAgentSettings" } },

  { kind: "section", titleKey: "settings.sectionNostr" },
  { kind: "row", row: { labelKey: "settings.nostrIdentity", on: "NostrIdentity" } },
  { kind: "row", row: { labelKey: "settings.chatAndPay", on: "PayHub" } },
  { kind: "row", row: { labelKey: "settings.contacts", on: "Contacts" } },

  { kind: "section", titleKey: "settings.sectionAdvanced" },
  { kind: "row", row: { labelKey: "settings.logs", on: "Logs" } },
  { kind: "row", row: { labelKey: "settings.connectedNode", on: "ConnectedNode" } },
  { kind: "row", row: { labelKey: "settings.hardwareWallet", stub: true } },
  { kind: "row", row: { labelKey: "settings.multisig", stub: true } },
  { kind: "row", row: { labelKey: "settings.backup", on: "AdvancedBackup" } },
  { kind: "row", row: { labelKey: "settings.pairBluetooth", on: "PairBluetooth" } },
  { kind: "row", row: { labelKey: "settings.resetApp", on: "ResetApp", danger: true } },

  { kind: "row", row: { labelKey: "settings.about", on: "About" } },
];

export function SettingsScreen() {
  const navigation = useNavigation<RootNav>();
  const { t } = useI18n();

  return (
    <ScreenChrome logoScale={0.77}>
      <ScreenTitle style={styles.title}>{t("settings.title")}</ScreenTitle>
      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 40 }}>
        {BLOCKS.map((block, i) => {
          if (block.kind === "section") {
            const title = t(block.titleKey);
            return (
              <SectionHeader key={`sec-${block.titleKey}`} first={i === 0}>
                {title}
              </SectionHeader>
            );
          }
          const { row } = block;
          const label = t(row.labelKey);
          return (
            <SettingsRow
              key={row.labelKey}
              label={label}
              danger={row.danger}
              stub={row.stub}
              stubLabel={t("common.soon")}
              onPress={
                row.on
                  ? () => {
                      navigation.navigate(row.on!);
                    }
                  : undefined
              }
            />
          );
        })}
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
