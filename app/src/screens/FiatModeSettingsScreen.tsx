/**
 * Settings → Fiat Mode: stablecoin cards (BRL active; others Soon).
 */

import { Pressable, StyleSheet, Text, View } from "react-native";
import { ScreenChrome } from "../components/ScreenChrome";
import { useFiatMode } from "../fiat/FiatModeProvider";
import { formatBrlDisplay } from "../fiat/depixAssets";
import { useWallet } from "../wallet/WalletProvider";
import { colors } from "../theme/colors";

type StableCardProps = {
  title: string;
  status: string;
  active?: boolean;
  onPress?: () => void;
  actionLabel?: string;
  soon?: boolean;
};

function StableCard({
  title,
  status,
  active,
  onPress,
  actionLabel,
  soon,
}: StableCardProps) {
  const disabled = soon || !onPress;
  return (
    <View style={[styles.card, soon ? styles.cardSoon : null, active ? styles.cardActive : null]}>
      <View style={styles.cardRow}>
        <Text style={[styles.cardTitle, soon ? styles.cardTitleSoon : null]}>{title}</Text>
        <Text style={[styles.cardStatus, soon ? styles.cardStatusSoon : null]}>{status}</Text>
      </View>
      {!soon && actionLabel && onPress ? (
        <Pressable
          style={styles.cardAction}
          onPress={onPress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text style={styles.cardActionLabel}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

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
  const feePct = (feeBps / 100).toFixed(1);
  const minSats = minEnterSats.toLocaleString("en-US");

  const brlStatus =
    status === "converting"
      ? `Converting…${convertingMessage ? ` ${convertingMessage}` : ""}`
      : fiatMode
        ? `On${depixDisplay != null ? ` · ${formatBrlDisplay(depixDisplay)}` : ""}`
        : "Off";

  const brlAction =
    !arkade || converting ? undefined : fiatMode ? "Exit" : "Enter";

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
      <Text style={[styles.caption, styles.captionLast]}>
        Turning a stable on or off has a conversion cost (about {feePct}%,
        minimum {minSats} sats). Pick a card below.
      </Text>

      <StableCard
        title="BRL (DePix)"
        status={brlStatus}
        active={fiatMode || converting}
        onPress={
          brlAction
            ? fiatMode
              ? requestExit
              : requestEnter
            : undefined
        }
        actionLabel={brlAction}
      />

      <StableCard title="USDT" status="Soon" soon />

      <StableCard title="Other stablecoin" status="Soon" soon />

      {!arkade ? (
        <Text style={styles.footnote}>
          Fiat Mode needs an Arkade wallet selected on Home.
        </Text>
      ) : (
        <Text style={styles.footnote}>
          Cards will let you choose which stable to use. For now only BRL is
          active.
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
  cardActive: {
    borderColor: colors.fg,
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
  cardAction: {
    marginTop: 10,
    alignSelf: "stretch",
    backgroundColor: colors.fg,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  cardActionLabel: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 13,
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
