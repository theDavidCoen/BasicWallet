/**
 * Settings → Fiat Mode: stablecoin cards (select then confirm on this page).
 */

import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ScreenChrome } from "../components/ScreenChrome";
import { getNetworkConfig } from "../config/network";
import { useFiatMode } from "../fiat/FiatModeProvider";
import {
  DEPIX_FEE_BPS,
  DEPIX_MIN_BASE_SATS,
  formatBrlDisplay,
  isFiatModeSwapAvailable,
} from "../fiat/depixAssets";
import { useWallet } from "../wallet/WalletProvider";
import { colors } from "../theme/colors";

type StableId = "brl";

type StableCardProps = {
  title: string;
  status: string;
  selected?: boolean;
  soon?: boolean;
  onSelect?: () => void;
};

function StableCard({ title, status, selected, soon, onSelect }: StableCardProps) {
  if (soon) {
    return (
      <View style={[styles.card, styles.cardSoon]} accessibilityState={{ disabled: true }}>
        <View style={styles.cardRow}>
          <Text style={[styles.cardTitle, styles.cardTitleSoon]}>{title}</Text>
          <Text style={[styles.cardStatus, styles.cardStatusSoon]}>{status}</Text>
        </View>
      </View>
    );
  }

  return (
    <Pressable
      style={[styles.card, selected ? styles.cardSelected : null]}
      onPress={onSelect}
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      accessibilityLabel={`${title}, ${status}`}
    >
      <View style={styles.cardRow}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardStatus}>{status}</Text>
      </View>
    </Pressable>
  );
}

export function FiatModeSettingsScreen() {
  const { selectedWallet } = useWallet();
  const network = getNetworkConfig();
  const swapOk = isFiatModeSwapAvailable(network.id);
  const {
    fiatMode,
    status,
    converting,
    convertingMessage,
    depixDisplay,
    confirmEnter,
    confirmExit,
    feeBps,
    minEnterSats,
  } = useFiatMode();

  const arkade = selectedWallet?.kind === "arkade";
  const [selected, setSelected] = useState<StableId | null>(null);

  // If already in Fiat Mode, keep BRL selected so Exit is one tap away.
  useEffect(() => {
    if (fiatMode) setSelected("brl");
  }, [fiatMode]);

  const feePct = (feeBps / 100).toFixed(1);
  const minSats = minEnterSats.toLocaleString("en-US");

  const brlStatus =
    status === "converting"
      ? `Converting…${convertingMessage ? ` ${convertingMessage}` : ""}`
      : fiatMode
        ? `On${depixDisplay != null ? ` · ${formatBrlDisplay(depixDisplay)}` : ""}`
        : !swapOk
          ? "Mainnet only"
          : "Off";

  const canConfirm =
    arkade && selected === "brl" && !converting && (fiatMode || swapOk);
  const confirmLabel = fiatMode ? "Exit Fiat Mode" : "Enter Fiat Mode";

  return (
    <ScreenChrome logoScale={0.77}>
      <Text style={styles.title}>FIAT MODE</Text>
      <Text style={styles.caption}>
        Fiat Mode lets this wallet hold a stable unit instead of bitcoin, so
        everyday amounts feel familiar while you still use Bitcoin under the hood
        on Arkade.
      </Text>
      <Text style={styles.caption}>
        Brazilian Real (BRL via DePix) is available now. More stables can join
        later. No KYC is applied. You can leave Fiat Mode anytime and switch back
        to sats.
      </Text>
      {!swapOk ? (
        <Text style={[styles.caption, styles.captionLast]}>
          Network is Mutinynet: convert is disabled until a Mutinynet DePix swap
          card is pinned. Switch to Bitcoin mainnet to enter Fiat Mode.
        </Text>
      ) : (
        <Text style={[styles.caption, styles.captionLast]}>
          Select a stable below, then confirm on this page. Back cancels without
          changing mode. Conversion cost is about {feePct}%, minimum {minSats} sats.
        </Text>
      )}

      <StableCard
        title="BRL (DePix)"
        status={brlStatus}
        selected={selected === "brl"}
        onSelect={() => setSelected("brl")}
      />

      <StableCard title="USDT" status="Soon" soon />

      <StableCard title="Other stablecoin" status="Soon" soon />

      {selected === "brl" && swapOk ? (
        <View style={styles.feeCard}>
          <Text style={styles.feeTitle}>What it costs to switch</Text>
          <Text style={styles.feeLine}>
            About {(DEPIX_FEE_BPS / 100).toFixed(1)}% conversion fee
          </Text>
          <Text style={styles.feeLine}>
            Minimum {DEPIX_MIN_BASE_SATS.toLocaleString("en-US")} sats
          </Text>
        </View>
      ) : null}

      {canConfirm ? (
        <Pressable
          style={styles.primary}
          onPress={fiatMode ? confirmExit : confirmEnter}
          accessibilityRole="button"
          accessibilityLabel={confirmLabel}
        >
          <Text style={styles.primaryLabel}>{confirmLabel}</Text>
        </Pressable>
      ) : null}

      {!arkade ? (
        <Text style={styles.footnote}>
          Fiat Mode needs an Arkade wallet selected on Home.
        </Text>
      ) : (
        <Text style={styles.footnote}>
          Cards will let you choose which stable to use. For now only BRL is
          active. Selection does not leave this page.
        </Text>
      )}
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
    fontSize: 13,
    color: colors.hint,
    lineHeight: 20,
    marginBottom: 14,
  },
  captionLast: {
    marginBottom: 20,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  cardSelected: {
    borderColor: colors.fg,
    borderWidth: 2,
    paddingVertical: 11,
    paddingHorizontal: 13,
  },
  cardSoon: {
    opacity: 0.55,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  cardTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
    flexShrink: 1,
  },
  cardTitleSoon: {
    color: colors.hint,
  },
  cardStatus: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    textAlign: "right",
    flexShrink: 1,
  },
  cardStatusSoon: {
    color: colors.hint,
  },
  feeCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginTop: 6,
    marginBottom: 16,
  },
  feeTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 13,
    color: colors.fg,
    textAlign: "center",
    marginBottom: 8,
  },
  feeLine: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 18,
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
    marginTop: 14,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
    lineHeight: 16,
  },
});
