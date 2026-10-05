/**
 * Settings → Bitcoin Maxi Mode.
 * v1: always ON (non-interactive card). Auto-converts inbound alt-assets to sats
 * when Fiat Mode is off.
 */

import { StyleSheet, Text, View } from "react-native";
import { ScreenChrome } from "../components/ScreenChrome";
import { getNetworkConfig } from "../config/network";
import { useFiatMode } from "../fiat/FiatModeProvider";
import { fiatFeeBps } from "../fiat/depixAssets";
import { AdaptiveText, useI18n } from "../i18n";
import { colors } from "../theme/colors";

export function BitcoinMaxiSettingsScreen() {
  const { t } = useI18n();
  const network = getNetworkConfig();
  const { bitcoinMaxiMode } = useFiatMode();
  const feePct = (fiatFeeBps(network.id) / 100).toFixed(1);
  const on = bitcoinMaxiMode !== false;
  const status = on ? t("fiat.statusOn") : t("fiat.statusOff");

  return (
    <ScreenChrome logoScale={0.77}>
      <AdaptiveText style={styles.title} baseFontSize={20}>
        {t("fiat.maxiTitle")}
      </AdaptiveText>
      <Text style={styles.caption}>{t("fiat.maxiCaption1")}</Text>
      <Text style={styles.caption}>
        {t("fiat.maxiCaption2", { feePct })}
      </Text>
      <Text style={[styles.caption, styles.captionLast]}>
        {t("fiat.maxiCaption3")}
      </Text>

      <View
        style={styles.card}
        accessibilityRole="text"
        accessibilityLabel={t("fiat.maxiA11y", { status })}
      >
        <View style={styles.cardRow}>
          <AdaptiveText style={styles.cardTitle} baseFontSize={15}>
            {t("fiat.maxiCardTitle")}
          </AdaptiveText>
          <Text style={styles.cardStatus}>{status}</Text>
        </View>
      </View>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 20,
    color: colors.fg,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 16,
  },
  caption: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 19,
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  captionLast: {
    marginBottom: 24,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.fg,
    borderRadius: 12,
    backgroundColor: colors.card,
    paddingVertical: 16,
    paddingHorizontal: 16,
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
  cardStatus: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
  },
});
