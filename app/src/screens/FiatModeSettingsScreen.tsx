/**
 * Settings → Fiat Mode: stablecoin cards (select then confirm on this page).
 * Mainnet: BRL (DePix). Mutinynet: USDT → USD.
 */

import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
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
import { AdaptiveText, useI18n } from "../i18n";
import type { RootNav } from "../navigation/types";
import { requireUserPresence } from "../security/userPresence";
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
  const navigation = useNavigation<RootNav>();
  const { t } = useI18n();
  const { selectedWallet } = useWallet();
  const network = getNetworkConfig();
  const swapOk = isFiatModeSwapAvailable(network.id);
  const stable = fiatStableForNetwork(network.id);
  const activeId: StableId = stable.kind === "usd" ? "usd" : "brl";
  const {
    fiatMode,
    status,
    converting,
    depixDisplay,
    confirmEnter,
    confirmExit,
    feeBps,
    minEnterSats,
  } = useFiatMode();

  const arkade = selectedWallet?.kind === "arkade";
  const [selected, setSelected] = useState<StableId | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (fiatMode) setSelected(activeId);
  }, [fiatMode, activeId]);

  const feePct = (feeBps / 100).toFixed(1);
  const minSats = minEnterSats.toLocaleString("en-US");

  const activeStatus =
    status === "converting"
      ? t("fiat.statusConverting")
      : fiatMode
        ? depixDisplay != null
          ? t("fiat.statusOnWithBalance", {
              balance: formatBrlDisplay(depixDisplay, { networkId: network.id }),
            })
          : t("fiat.statusOn")
        : !swapOk
          ? t("fiat.statusUnavailable")
          : t("fiat.statusOff");

  const canConfirm =
    arkade && selected === activeId && !converting && !busy && (fiatMode || swapOk);
  const confirmLabel = fiatMode
    ? t("fiat.exitFiatMode")
    : t("fiat.enterFiatMode");

  const isMutiny = network.id === "mutinynet";

  async function onConfirm() {
    if (!canConfirm || busy) return;
    setBusy(true);
    try {
      if (fiatMode) {
        const auth = await requireUserPresence(t("fiat.confirmExitPresence"));
        if (!auth.ok) {
          return;
        }
        const ok = await confirmExit();
        if (ok) navigation.navigate("Home");
      } else {
        const auth = await requireUserPresence(t("fiat.confirmEnterPresence"));
        if (!auth.ok) {
          return;
        }
        const ok = await confirmEnter();
        if (ok) navigation.navigate("Home");
      }
    } finally {
      setBusy(false);
    }
  }

  // While converting, hide cards under the overlay so no empty layer shows.
  if (converting) {
    return (
      <ScreenChrome logoScale={0.77}>
        <AdaptiveText style={styles.title} baseFontSize={18}>
          {t("fiat.title")}
        </AdaptiveText>
        <Text style={styles.caption}>{t("fiat.convertingWait")}</Text>
      </ScreenChrome>
    );
  }

  return (
    <ScreenChrome logoScale={0.77}>
      <AdaptiveText style={styles.title} baseFontSize={18}>
        {t("fiat.title")}
      </AdaptiveText>
      <Text style={styles.caption}>{t("fiat.captionIntro")}</Text>
      <Text style={styles.caption}>
        {isMutiny ? t("fiat.captionMutiny") : t("fiat.captionMainnet")}{" "}
        {t("fiat.captionLeave")}
      </Text>
      <Text style={[styles.caption, styles.captionLast]}>
        {t("fiat.captionSelect", { feePct, minSats })}
      </Text>

      {isMutiny ? (
        <>
          <StableCard
            title={t("fiat.cardUsdtUsd")}
            status={activeStatus}
            selected={selected === "usd"}
            onSelect={() => setSelected("usd")}
          />
          <StableCard
            title={t("fiat.cardBrlDepix")}
            status={t("fiat.statusNaMutiny")}
            soon
          />
          <StableCard
            title={t("fiat.cardOtherStable")}
            status={t("fiat.statusSoon")}
            soon
          />
        </>
      ) : (
        <>
          <StableCard
            title={t("fiat.cardBrlDepix")}
            status={activeStatus}
            selected={selected === "brl"}
            onSelect={() => setSelected("brl")}
          />
          <StableCard
            title={t("fiat.cardUsdt")}
            status={t("fiat.statusSoon")}
            soon
          />
          <StableCard
            title={t("fiat.cardOtherStable")}
            status={t("fiat.statusSoon")}
            soon
          />
        </>
      )}

      {selected === activeId && swapOk ? (
        <View style={styles.feeCard}>
          <Text style={styles.feeTitle}>{t("fiat.feeTitle")}</Text>
          <Text style={styles.feeLine}>
            {t("fiat.feeLinePct", {
              feePct: (fiatFeeBps(network.id) / 100).toFixed(1),
            })}
          </Text>
          <Text style={styles.feeLine}>
            {t("fiat.feeLineMin", {
              minSats: fiatMinBaseSats(network.id).toLocaleString("en-US"),
            })}
          </Text>
        </View>
      ) : null}

      {canConfirm ? (
        <Pressable
          style={styles.primary}
          onPress={() => void onConfirm()}
          accessibilityRole="button"
          accessibilityLabel={confirmLabel}
        >
          <AdaptiveText style={styles.primaryLabel} baseFontSize={15}>
            {confirmLabel}
          </AdaptiveText>
        </Pressable>
      ) : null}

      {!arkade ? (
        <Text style={styles.footnote}>{t("fiat.footnoteNeedsArkade")}</Text>
      ) : (
        <Text style={styles.footnote}>
          {isMutiny ? t("fiat.footnoteMutiny") : t("fiat.footnoteMainnet")}
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
