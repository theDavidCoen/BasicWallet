/**
 * Settings → Connected node: status for the *selected* wallet.
 * Lightning → LNDHub or LND REST (BTCPay) probe. Arkade → operator + explorer.
 * Connecting a new Lightning node is only via Add Wallet → Connect Lightning Node.
 */

import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { getNetworkConfig } from "../config/network";
import { probeLndHub } from "../lightning/lndhub";
import { loadLndHubCredentials } from "../lightning/lndhubCredentials";
import { loadLndRestCredentials } from "../lightning/lndCredentials";
import { lndRestHostLabel, probeLndRest } from "../lightning/lndRest";
import { useI18n } from "../i18n";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";
import { useWallet } from "../wallet/WalletProvider";

type LnStatus = {
  state: "loading" | "ok" | "error" | "missing";
  alias?: string;
  host?: string;
  role?: string;
  provider?: string;
  balanceSats?: number;
  error?: string;
  walletLabel?: string;
  tag?: string;
};

export function ConnectedNodeScreen() {
  const navigation = useNavigation<RootNav>();
  const { t } = useI18n();
  const { selectedWallet } = useWallet();
  const network = getNetworkConfig();
  const [ln, setLn] = useState<LnStatus>({ state: "loading" });

  const isLightning = selectedWallet?.kind === "lightning";

  useFocusEffect(
    useCallback(() => {
      if (!isLightning || !selectedWallet?.id) {
        setLn({ state: "missing" });
        return;
      }
      const walletId = selectedWallet.id;
      const walletLabel = selectedWallet.label;
      const tag = selectedWallet.tag?.trim() || "Lightning";
      let cancelled = false;
      setLn({ state: "loading", walletLabel, tag });
      void (async () => {
        try {
          const hub = await loadLndHubCredentials(walletId);
          if (hub) {
            const probed = await probeLndHub(hub);
            if (!cancelled) {
              setLn({
                state: "ok",
                alias: probed.alias || hub.alias || hub.hostLabel,
                host: hub.hostLabel,
                role: hub.role,
                provider: "LNDHub",
                balanceSats: probed.balance.availableSats,
                walletLabel,
                tag,
              });
            }
            return;
          }

          const rest = await loadLndRestCredentials(walletId);
          if (!rest) {
            if (!cancelled) {
              setLn({
                state: "missing",
                walletLabel,
                tag,
                error: t("node.noCreds"),
              });
            }
            return;
          }

          const probed = await probeLndRest({
            restUrl: rest.restUrl,
            macaroonHex: rest.macaroonHex,
            certThumbprint: rest.certThumbprint,
            allowInsecure: rest.allowInsecure,
            source: rest.source,
          });
          if (!cancelled) {
            setLn({
              state: "ok",
              alias: probed.info.alias || rest.alias || walletLabel,
              host: lndRestHostLabel(rest.restUrl),
              provider: tag === "BTCPay" ? "BTCPay · LND REST" : "LND REST",
              balanceSats: probed.balance.localSats,
              walletLabel,
              tag,
            });
          }
        } catch (e) {
          if (!cancelled) {
            setLn({
              state: "error",
              walletLabel,
              tag,
              error: e instanceof Error ? e.message : t("node.connectionFailed"),
            });
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [isLightning, selectedWallet?.id, selectedWallet?.label, selectedWallet?.tag, t]),
  );

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={ui.title}>{t("node.title")}</Text>
        <Text style={ui.caption}>
          {isLightning ? t("node.captionLn") : t("node.captionArkade")}
        </Text>

        {isLightning ? (
          <LightningPanel
            ln={ln}
            onRemove={() => {
              if (!selectedWallet?.id) return;
              navigation.navigate("RemoveLightningWallet", {
                walletId: selectedWallet.id,
              });
            }}
          />
        ) : (
          <ArkadePanel
            networkLabel={network.label}
            networkId={network.id}
            arkServerUrl={network.arkServerUrl}
            esploraUrl={network.esploraUrl}
            walletLabel={selectedWallet?.label ?? t("common.personal")}
          />
        )}
      </ScrollView>
    </ScreenChrome>
  );
}

function LightningPanel({
  ln,
  onRemove,
}: {
  ln: LnStatus;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  if (ln.state === "loading") {
    return (
      <View style={ui.card}>
        <ActivityIndicator color={colors.fg} />
        <Text style={[styles.meta, { marginTop: 12 }]}>{t("node.checking")}</Text>
      </View>
    );
  }

  const statusLine =
    ln.state === "ok"
      ? t("node.statusOkLn")
      : ln.state === "error"
        ? t("node.statusErrLn")
        : t("node.statusMissingLn");

  return (
    <>
      <View style={ui.card}>
        <Text style={styles.status}>{statusLine}</Text>
        {ln.walletLabel ? (
          <Text style={styles.alias}>{ln.walletLabel}</Text>
        ) : null}
        {ln.tag ? <Text style={styles.meta}>{ln.tag}</Text> : null}
        {ln.alias ? (
          <Text style={[styles.alias, { marginTop: 12 }]}>{ln.alias}</Text>
        ) : null}
        {ln.host ? <Text style={styles.meta}>{t("node.host", { host: ln.host })}</Text> : null}
        {ln.provider ? (
          <Text style={styles.meta}>{t("node.provider", { provider: ln.provider })}</Text>
        ) : null}
        {ln.role ? (
          <Text style={styles.meta}>
            {ln.role === "admin" ? t("node.keyAdmin") : t("node.keyInvoice")}
          </Text>
        ) : null}
        {ln.state === "ok" && ln.balanceSats != null ? (
          <>
            <Text style={styles.bal}>
              {ln.balanceSats.toLocaleString("en-US")} sats
            </Text>
            <Text style={styles.caption}>{t("node.availableBalance")}</Text>
          </>
        ) : null}
        {ln.error ? <Text style={styles.err}>{ln.error}</Text> : null}
      </View>

      <Text style={[ui.hint, { marginTop: 20 }]}>{t("node.hintLn")}</Text>

      {ln.state !== "missing" || ln.walletLabel ? (
        <Pressable style={[ui.secondaryBtn, { marginTop: 24 }]} onPress={onRemove}>
          <Text style={ui.secondaryBtnText}>{t("node.remove")}</Text>
        </Pressable>
      ) : null}
    </>
  );
}

function ArkadePanel({
  networkLabel,
  networkId,
  arkServerUrl,
  esploraUrl,
  walletLabel,
}: {
  networkLabel: string;
  networkId: string;
  arkServerUrl: string;
  esploraUrl: string;
  walletLabel: string;
}) {
  const { t } = useI18n();
  return (
    <>
      <View style={ui.card}>
        <Text style={styles.status}>{t("node.statusOkArkade")}</Text>
        <Text style={styles.alias}>{walletLabel}</Text>
        <Text style={styles.meta}>{t("node.network", { label: networkLabel })}</Text>
        <Text style={styles.meta}>{t("node.id", { id: networkId })}</Text>

        <Text style={[styles.section, { marginTop: 20 }]}>{t("node.operator")}</Text>
        <Text style={styles.url} selectable>
          {arkServerUrl}
        </Text>

        <Text style={[styles.section, { marginTop: 16 }]}>{t("node.explorer")}</Text>
        <Text style={styles.url} selectable>
          {esploraUrl}
        </Text>
      </View>

      <Text style={[ui.hint, { marginTop: 20 }]}>{t("node.hintArkade")}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  status: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 16,
    color: colors.fg,
    marginBottom: 8,
  },
  alias: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
    marginBottom: 4,
  },
  meta: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    marginTop: 4,
  },
  section: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 12,
    color: colors.fg,
    marginBottom: 6,
  },
  url: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    lineHeight: 18,
  },
  bal: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 28,
    color: colors.fg,
    marginTop: 16,
  },
  caption: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    marginTop: 6,
  },
  err: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: "#FF6B6B",
    marginTop: 12,
    lineHeight: 16,
  },
});
