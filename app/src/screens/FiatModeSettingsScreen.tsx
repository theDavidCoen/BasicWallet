/**
 * Settings → Fiat Mode — status card + enter/exit for selected Arkade wallet.
 */

import { Pressable, StyleSheet, Text, View } from "react-native";
import { ScreenChrome } from "../components/ScreenChrome";
import { useFiatMode } from "../fiat/FiatModeProvider";
import { DEPIX_FEE_BPS, DEPIX_MIN_BASE_SATS, formatBrlDisplay } from "../fiat/depixAssets";
import { useWallet } from "../wallet/WalletProvider";
import { colors } from "../theme/colors";

export function FiatModeSettingsScreen() {
  const { selectedWallet } = useWallet();
  const {
    fiatMode,
    status,
    converting,
    convertingMessage,
    depixDisplay,
    requestEnter,
    requestExit,
    feeBps,
    minEnterSats,
  } = useFiatMode();

  const arkade = selectedWallet?.kind === "arkade";
  const statusLabel =
    status === "converting"
      ? `Converting… ${convertingMessage}`
      : fiatMode
        ? `On (BRL)${depixDisplay != null ? ` · ${formatBrlDisplay(depixDisplay)}` : ""}`
        : "Off";

  return (
    <ScreenChrome logoScale={0.77}>
      <Text style={styles.title}>FIAT MODE</Text>
      <Text style={styles.caption}>
        Hold BRL via DePix on Bitcoin/Arkade. This is not a bank account. Enter
        converts sats → DePix (~{feeBps / 100}% fee, min {minEnterSats} sats);
        Exit converts DePix → sats. Applies to the selected Arkade wallet only.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Selected wallet</Text>
        <Text style={styles.cardValue}>
          {selectedWallet?.label ?? "—"}
          {!arkade ? " (Arkade only)" : ""}
        </Text>
        <Text style={[styles.cardLabel, styles.cardLabelSpaced]}>Status</Text>
        <Text style={styles.cardValue}>{statusLabel}</Text>
      </View>

      {arkade && !converting ? (
        <Pressable
          style={styles.primary}
          onPress={fiatMode ? requestExit : requestEnter}
        >
          <Text style={styles.primaryLabel}>
            {fiatMode ? "Exit Fiat Mode" : "Enter Fiat Mode"}
          </Text>
        </Pressable>
      ) : null}

      <Text style={styles.footnote}>
        Fee reference from pinned DePix solver card ({DEPIX_FEE_BPS} bps). Reload
        the card before shipping if terms change.
      </Text>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 18,
    color: colors.fg,
    letterSpacing: 1,
    marginBottom: 12,
  },
  caption: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    lineHeight: 18,
    marginBottom: 20,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  cardLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
  },
  cardLabelSpaced: {
    marginTop: 12,
  },
  cardValue: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.fg,
    marginTop: 4,
  },
  primary: {
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryLabel: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: "#000",
  },
  footnote: {
    marginTop: 20,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
    lineHeight: 16,
  },
});
