/**
 * Lightweight Home-looking chrome under Spotlight D.
 * No gestures, rates polls, Soft* SVG, or sheet hooks — only cached balance paint.
 */
import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ScreenChrome, WalletAvatar } from "./ScreenChrome";
import { useI18n } from "../i18n";
import { useWallet } from "../wallet/WalletProvider";
import { formatSatsLabel } from "../wallet/formatSats";
import { colors } from "../theme/colors";

export const HomeTourUnderlay = memo(function HomeTourUnderlay() {
  const { t } = useI18n();
  const {
    balanceSats,
    balanceStatus,
    balanceHidden,
    avatarLabel,
  } = useWallet();

  const bal = formatSatsLabel(
    balanceSats,
    balanceHidden,
    balanceStatus === "loading" ? "…" : "0 sats",
  );

  return (
    <View style={styles.full} pointerEvents="none" collapsable={false}>
      <ScreenChrome
        logoScale={1}
        avatar={<WalletAvatar label={avatarLabel} />}
        headerRight={
          <View style={styles.fiatModeBtn}>
            <Text style={styles.fiatModeBtnLabel}>R$</Text>
          </View>
        }
      >
        <View style={styles.flex}>
          <View style={styles.center}>
            <Text style={styles.balance}>{bal}</Text>
            <Text style={styles.secondary} numberOfLines={1}>
              {" "}
            </Text>
          </View>

          <View style={styles.actions}>
            <View style={styles.actionBtn}>
              <Text style={styles.actionLabel}>{t("home.receive")}</Text>
            </View>
            <View style={[styles.actionBtn, styles.actionBtnPrimary]}>
              <Text style={[styles.actionLabel, styles.actionLabelPrimary]}>
                {t("home.send")}
              </Text>
            </View>
          </View>

          <View style={styles.chatPay}>
            <Text style={styles.chatPayTitle}>{t("home.chatAndPay")}</Text>
            <Text style={styles.chatPayHint} numberOfLines={2}>
              {t("home.chatAndPayHint")}
            </Text>
          </View>

          <View style={styles.histHit}>
            <View style={styles.histHandle} />
          </View>
          <View style={styles.rateFooterSpacer} />
        </View>
      </ScreenChrome>
    </View>
  );
});

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  fiatModeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.fg,
    alignItems: "center",
    justifyContent: "center",
  },
  fiatModeBtnLabel: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 12,
    color: colors.fg,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  balance: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 36,
    color: colors.fg,
    textAlign: "center",
  },
  secondary: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
    marginTop: 8,
    minHeight: 20,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  actionBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.fg,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  actionBtnPrimary: {
    backgroundColor: colors.fg,
  },
  actionLabel: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
  },
  actionLabelPrimary: {
    color: colors.onPrimary,
  },
  chatPay: {
    marginHorizontal: 24,
    marginBottom: 20,
    paddingVertical: 12,
  },
  chatPayTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
    marginBottom: 4,
  },
  chatPayHint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
  },
  histHit: {
    alignItems: "center",
    paddingBottom: 8,
  },
  histHandle: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  rateFooterSpacer: {
    height: 28,
  },
});
