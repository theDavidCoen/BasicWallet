/**
 * Settings → Fiat Mode: stablecoin cards (select then confirm on this page).
 * Mainnet: BRL (DePix). Mutinynet: USDT → USD.
 */

import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ScreenChrome } from "../components/ScreenChrome";
import { getNetworkConfig } from "../config/network";
import { useFiatMode } from "../fiat/FiatModeProvider";
import {
  fiatFeeBps,
  fiatMinBaseSats,
  fiatStableForNetwork,
  formatBrlDisplay,
  isFiatModeSwapAvailable,
} from "../fiat/depixAssets";
import { useWallet } from "../wallet/WalletProvider";
import { colors } from "../theme/colors";

type StableId = "brl" | "usd";

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
  const stable = fiatStableForNetwork(network.id);
  const activeId: StableId = stable.kind === "usd" ? "usd" : "brl";
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

  useEffect(() => {
    if (fiatMode) setSelected(activeId);
  }, [fiatMode, activeId]);

  const feePct = (feeBps / 100).toFixed(1);
  const minSats = minEnterSats.toLocaleString("en-US");

  const activeStatus =
    status === "converting"
      ? `Converting…${convertingMessage ? ` ${convertingMessage}` : ""}`
      : fiatMode
        ? `On${depixDisplay != null ? ` · ${formatBrlDisplay(depixDisplay, { networkId: network.id })}` : ""}`
        : !swapOk
          ? "Unavailable"
          : "Off";

  const canConfirm =
    arkade && selected === activeId && !converting && (fiatMode || swapOk);
  const confirmLabel = fiatMode ? "Exit Fiat Mode" : "Enter Fiat Mode";

  const isMutiny = network.id === "mutinynet";

  return (
    <ScreenChrome logoScale={0.77}>
      <Text style={styles.title}>FIAT MODE</Text>
      <Text style={styles.caption}>
        Fiat Mode lets this wallet hold a stable unit instead of bitcoin, so
        everyday amounts feel familiar while you still use Bitcoin under the hood
        on Arkade.
      </Text>
      <Text style={styles.caption}>
        {isMutiny
          ? "On Mutinynet, Fiat Mode uses USDT and shows USD. No KYC is applied."
          : "On mainnet, Brazilian Real (BRL via DePix) is available. More stables can join later. No KYC is applied."}{" "}
        You can leave Fiat Mode anytime and switch back to sats.
      </Text>
      <Text style={[styles.caption, styles.captionLast]}>
        Select a stable below, then confirm on this page. Back cancels without
        changing mode. Conversion cost is about {feePct}%, minimum {minSats} sats.
      </Text>

      {isMutiny ? (
        <>
          <StableCard
            title="USDT (USD)"
            status={activeStatus}
            selected={selected === "usd"}
            onSelect={() => setSelected("usd")}
          />
          <StableCard title="BRL (DePix)" status="N/A on Mutinynet" soon />
          <StableCard title="Other stablecoin" status="Soon" soon />
        </>
      ) : (
        <>
          <StableCard
            title="BRL (DePix)"
            status={activeStatus}
            selected={selected === "brl"}
            onSelect={() => setSelected("brl")}
          />
          <StableCard title="USDT" status="Soon" soon />
          <StableCard title="Other stablecoin" status="Soon" soon />
        </>
      )}

      {selected === activeId && swapOk ? (
        <View style={styles.feeCard}>
          <Text style={styles.feeTitle}>What it costs to switch</Text>
          <Text style={styles.feeLine}>
            About {(fiatFeeBps(network.id) / 100).toFixed(1)}% conversion fee
          </Text>
          <Text style={styles.feeLine}>
            Minimum {fiatMinBaseSats(network.id).toLocaleString("en-US")} sats
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
          {isMutiny
            ? "USDT is the active Fiat Mode path on Mutinynet."
            : "Cards will let you choose which stable to use. For now only BRL is active on mainnet."}{" "}
          Selection does not leave this page.
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
    fontSize: 15,
    color: colors.fg,
    flexShrink: 1,
  },
  cardTitleSoon: {
    color: colors.caption,
  },
  cardStatus: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    textAlign: "right",
    flexShrink: 0,
  },
  cardStatusSoon: {
    color: colors.hint,
  },
  feeCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 6,
    marginBottom: 16,
  },
  feeTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 13,
    color: colors.fg,
    marginBottom: 6,
  },
  feeLine: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    lineHeight: 18,
  },
  primary: {
    backgroundColor: colors.fg,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 4,
  },
  primaryLabel: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 15,
    color: "#000",
  },
  footnote: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    lineHeight: 18,
    marginTop: 16,
  },
});
