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
import { colors } from "../theme/colors";

export function BitcoinMaxiSettingsScreen() {
  const network = getNetworkConfig();
  const { bitcoinMaxiMode } = useFiatMode();
  const feePct = (fiatFeeBps(network.id) / 100).toFixed(1);
  const on = bitcoinMaxiMode !== false;

  return (
    <ScreenChrome logoScale={0.77}>
      <Text style={styles.title}>BITCOIN MAXI MODE</Text>
      <Text style={styles.caption}>
        When Bitcoin Maxi Mode is on, other assets that arrive on this wallet&apos;s
        Ark address are converted to bitcoin (sats) automatically. Your home
        balance stays in sats instead of collecting alt balances.
      </Text>
      <Text style={styles.caption}>
        This runs quietly in the background, like Fiat Mode&apos;s inbound
        conversion, but in the opposite direction. A small solver fee applies
        (about {feePct}% on this network), the same family of fee as Fiat Mode
        swaps.
      </Text>
      <Text style={[styles.caption, styles.captionLast]}>
        Fiat Mode still wins when it is active: inbound value follows Fiat Mode
        rules instead. Turning Maxi Mode off is not available yet.
      </Text>

      <View
        style={styles.card}
        accessibilityRole="text"
        accessibilityLabel={`Bitcoin Maxi Mode, ${on ? "On" : "Off"}`}
      >
        <View style={styles.cardRow}>
          <Text style={styles.cardTitle}>Bitcoin Maxi Mode</Text>
          <Text style={styles.cardStatus}>{on ? "On" : "Off"}</Text>
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
