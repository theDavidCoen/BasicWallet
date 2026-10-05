/**
 * Step 4 (last) — Start execute on stored draft package → background job → hub.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import {
  serializeExitPackage,
  type ExitPackage,
} from "@arkade-os/sdk";
import { ExitStepHeader, EXIT_STEP } from "../components/ExitStepHeader";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { getNetworkConfig } from "../config/network";
import { requireExitAuth, canRevealExitSecrets } from "../exit/gates";
import { createFeeOnchainWallet, pollFeeBalance } from "../exit/feeWallet";
import { loadExitPackage } from "../exit/packageStore";
import { startExitJob } from "../exit/jobRunner";
import { useWallet } from "../wallet/WalletProvider";
import { useI18n } from "../i18n";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

export function UnilateralExitExecuteScreen() {
  const navigation = useNavigation<RootNav>();
  const { t } = useI18n();
  const route = useRoute<RouteProp<RootStackParamList, "UnilateralExitExecute">>();
  const esploraOverride = route.params?.esploraUrl?.trim() || "";
  const network = getNetworkConfig();
  const { selectedWallet } = useWallet();
  const walletId = selectedWallet?.kind === "arkade" ? selectedWallet.id : null;

  const [pkg, setPkg] = useState<ExitPackage | null>(null);
  const [feeBalance, setFeeBalance] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!walletId || !canRevealExitSecrets()) {
        if (!cancelled) {
          setPkg(null);
          setLoading(false);
        }
        return;
      }
      const auth = await requireExitAuth(t("exit.confirmOpenExecute"));
      if (!auth.ok) {
        if (!cancelled) {
          setLoading(false);
          Alert.alert(t("exit.cancelled"), auth.reason, [
            { text: t("exit.ok"), onPress: () => navigation.goBack() },
          ]);
        }
        return;
      }
      const loaded = await loadExitPackage(network.id, walletId);
      if (cancelled) return;
      setPkg(loaded);
      if (!loaded) {
        setLoading(false);
        return;
      }
      try {
        const fee = await createFeeOnchainWallet(
          walletId,
          esploraOverride || undefined,
        );
        const bal = await pollFeeBalance(fee);
        if (!cancelled) setFeeBalance(bal);
      } catch (e) {
        console.warn("[basic] fee balance", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletId, network.id, navigation, esploraOverride]);

  const needed = pkg?.totals.fundingRequiredSats ?? 0;
  const funded = feeBalance !== null && feeBalance >= needed;

  const onExport = useCallback(async () => {
    if (!pkg) return;
    const auth = await requireExitAuth(t("exit.confirmExport"));
    if (!auth.ok) {
      Alert.alert(t("exit.cancelled"), auth.reason);
      return;
    }
    const json = serializeExitPackage(pkg);
    await Share.share({ message: json });
  }, [pkg]);

  const onExecute = useCallback(async () => {
    if (!walletId || !pkg) return;
    if (!funded) {
      Alert.alert(
        t("exit.fundFeesFirstTitle"),
        t("exit.fundFeesFirstBody"),
        [
          {
            text: t("exit.backToFund"),
            onPress: () => navigation.navigate("UnilateralExitFund"),
          },
          { text: t("exit.ok"), style: "cancel" },
        ],
      );
      return;
    }
    const auth = await requireExitAuth(t("exit.confirmExecute"));
    if (!auth.ok) {
      Alert.alert(t("exit.cancelled"), auth.reason);
      return;
    }
    setStarting(true);
    try {
      await startExitJob({
        networkId: network.id,
        walletId,
        pkg,
        esploraUrl: esploraOverride || undefined,
      });
      navigation.replace("UnilateralExitHub");
    } catch (e) {
      Alert.alert(
        t("exit.couldNotStartExit"),
        e instanceof Error ? e.message : t("common.unknownError"),
      );
      setStarting(false);
    }
  }, [walletId, pkg, funded, esploraOverride, navigation, network.id]);

  if (loading) {
    return (
      <ScreenChrome logoScale={0.77}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.fg} />
        </View>
      </ScreenChrome>
    );
  }

  if (!walletId || !pkg) {
    return (
      <ScreenChrome logoScale={0.77}>
        <ExitStepHeader step={EXIT_STEP.execute} title={t("exit.executeTitle")} />
        <Text style={ui.caption}>{t("exit.noPackageSteps")}</Text>
        <Pressable
          style={ui.primaryBtn}
          onPress={() => navigation.navigate("ExitRecoveryAddress", { from: "exit" })}
        >
          <Text style={ui.primaryBtnText}>{t("exit.startFromRecovery")}</Text>
        </Pressable>
      </ScreenChrome>
    );
  }

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        <ExitStepHeader
          step={EXIT_STEP.execute}
          title={t("exit.executeTitle")}
          caption={t("exit.executeCaption")}
        />

        <View style={ui.cardMuted}>
          <Text style={styles.meta}>
            {t("exit.sweepTo", { addr: pkg.sweepAddress.slice(0, 18) })}
          </Text>
          <Text style={styles.meta}>
            {t("exit.recoverApproxShort", {
              sats: pkg.totals.recoveredSats.toLocaleString("en-US"),
            })}
          </Text>
          <Text style={styles.meta}>
            {t("exit.feeBalanceExecute", {
              balance: feeBalance === null ? "…" : `${feeBalance.toLocaleString("en-US")} sats`,
              needed: needed.toLocaleString("en-US"),
              state: funded ? t("exit.feeReady") : t("exit.feeShortfall"),
            })}
          </Text>
        </View>

        {!funded ? (
          <Text style={styles.warn}>
            {t("exit.underfundedWarn")}
          </Text>
        ) : null}

        <Pressable
          style={[ui.primaryBtn, (!funded || starting) && { opacity: 0.5 }]}
          disabled={!funded || starting}
          onPress={() => void onExecute()}
        >
          {starting ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={ui.primaryBtnText}>{t("exit.startExecute")}</Text>
          )}
        </Pressable>

        <Pressable
          style={ui.secondaryBtn}
          onPress={() => navigation.navigate("UnilateralExitFund")}
          disabled={starting}
        >
          <Text style={ui.secondaryBtnText}>{t("exit.backToFundFees")}</Text>
        </Pressable>

        <Pressable style={ui.secondaryBtn} onPress={() => void onExport()} disabled={starting}>
          <Text style={ui.secondaryBtnText}>{t("exit.exportPackage")}</Text>
        </Pressable>
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  meta: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.fg,
    lineHeight: 20,
    marginTop: 4,
  },
  warn: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    lineHeight: 18,
    marginTop: 12,
    marginBottom: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
  },
});
