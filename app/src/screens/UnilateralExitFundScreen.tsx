/**
 * Step 3 — fund HD fee address, then continue to step 4 (Start execute page).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { ExitPackage } from "@arkade-os/sdk";
import { ExitStepHeader, EXIT_STEP } from "../components/ExitStepHeader";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { Button, TextField } from "../components/ui";
import { getNetworkConfig } from "../config/network";
import { requireExitAuth, canRevealExitSecrets } from "../exit/gates";
import { createFeeOnchainWallet, pollFeeBalance } from "../exit/feeWallet";
import { loadExitPackage, readExitPackageMeta } from "../exit/packageStore";
import type { ExitPackageMeta } from "../exit/packageStore";
import { useWallet } from "../wallet/WalletProvider";
import { useI18n } from "../i18n";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

export function UnilateralExitFundScreen() {
  const navigation = useNavigation<RootNav>();
  const { t } = useI18n();
  const route = useRoute<RouteProp<RootStackParamList, "UnilateralExitFund">>();
  const expectedRecovered = route.params?.expectedRecoveredSats;
  const expectedFunding = route.params?.expectedFundingSats;
  const network = getNetworkConfig();
  const { selectedWallet } = useWallet();
  const walletId = selectedWallet?.kind === "arkade" ? selectedWallet.id : null;

  const [pkg, setPkg] = useState<ExitPackage | null>(null);
  const [meta, setMeta] = useState<ExitPackageMeta | null>(null);
  const [feeAddress, setFeeAddress] = useState<string | null>(null);
  const [feeBalance, setFeeBalance] = useState<number | null>(null);
  const [esploraOverride, setEsploraOverride] = useState("");
  const [loading, setLoading] = useState(true);
  const [mismatch, setMismatch] = useState<string | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const unlocked = useRef(false);

  const reload = useCallback(async () => {
    if (!walletId || !canRevealExitSecrets()) {
      setPkg(null);
      setMeta(null);
      setLoading(false);
      return;
    }
    if (!unlocked.current) {
      const auth = await requireExitAuth(t("exit.confirmOpenPackage"));
      if (!auth.ok) {
        setLoading(false);
        Alert.alert(t("exit.cancelled"), auth.reason, [
          { text: t("exit.ok"), onPress: () => navigation.goBack() },
        ]);
        return;
      }
      unlocked.current = true;
    }
    const loaded = await loadExitPackage(network.id, walletId);
    const m = await readExitPackageMeta(network.id, walletId);
    setPkg(loaded);
    setMeta(m);

    if (loaded && expectedRecovered != null) {
      const d = Math.abs(loaded.totals.recoveredSats - expectedRecovered);
      if (d > 1_000) {
        setMismatch(
          t("exit.mismatchRecovered", {
            stored: loaded.totals.recoveredSats.toLocaleString("en-US"),
            expected: expectedRecovered.toLocaleString("en-US"),
          }),
        );
      } else {
        setMismatch(null);
      }
    } else if (loaded && expectedFunding != null) {
      const d = Math.abs(loaded.totals.fundingRequiredSats - expectedFunding);
      setMismatch(
        d > 1_000
          ? t("exit.mismatchFunding", {
              stored: loaded.totals.fundingRequiredSats.toLocaleString("en-US"),
              expected: expectedFunding.toLocaleString("en-US"),
            })
          : null,
      );
    } else {
      setMismatch(null);
    }

    if (!loaded) {
      setLoading(false);
      return;
    }
    try {
      const fee = await createFeeOnchainWallet(walletId);
      setFeeAddress(fee.address);
      setFeeBalance(await pollFeeBalance(fee));
    } catch (e) {
      console.warn("[basic] fee wallet", e);
    } finally {
      setLoading(false);
    }
  }, [walletId, network.id, navigation, expectedRecovered, expectedFunding]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void reload();
      return () => {
        pollAbortRef.current?.abort();
      };
    }, [reload]),
  );

  useEffect(() => {
    if (!walletId || !feeAddress) return;
    pollAbortRef.current?.abort();
    const ac = new AbortController();
    pollAbortRef.current = ac;
    const tick = async () => {
      if (ac.signal.aborted) return;
      try {
        const fee = await createFeeOnchainWallet(
          walletId,
          esploraOverride.trim() || undefined,
        );
        const bal = await pollFeeBalance(fee, ac.signal);
        if (!ac.signal.aborted) setFeeBalance(bal);
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 12_000);
    return () => {
      ac.abort();
      clearInterval(id);
    };
  }, [walletId, feeAddress, esploraOverride]);

  const needed = pkg?.totals.fundingRequiredSats ?? 0;
  const funded = feeBalance !== null && feeBalance >= needed;

  const onCopyFee = useCallback(async () => {
    if (!feeAddress) return;
    await Clipboard.setStringAsync(feeAddress);
    Alert.alert(t("exit.copiedTitle"), t("exit.feeAddressCopied"));
  }, [feeAddress]);

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
        <ExitStepHeader step={EXIT_STEP.fundFees} title={t("exit.fundTitle")} />
        <Text style={ui.caption}>{t("exit.noPackageStep2")}</Text>
        <Button onPress={() => navigation.navigate("UnilateralExitPrepare")}>
              {t("exit.goToPrepare")}
            </Button>
      </ScreenChrome>
    );
  }

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ExitStepHeader
          step={EXIT_STEP.fundFees}
          title={t("exit.fundTitle")}
          caption={t("exit.fundCaption")}
        />

        <Text style={styles.metaCenter}>
          {t("exit.fundMeta", {
            addr: pkg.sweepAddress.slice(0, 18),
            sats: pkg.totals.recoveredSats.toLocaleString("en-US"),
            source: meta?.source ? ` · ${meta.source}` : "",
          })}
        </Text>

        {mismatch ? <Text style={styles.err}>{mismatch}</Text> : null}

        <View style={ui.cardMuted}>
          <Text style={styles.label}>{t("exit.yourFeeAddress")}</Text>
          <Text style={styles.mono} selectable>
            {feeAddress ?? "…"}
          </Text>
          <Text style={[styles.meta, { marginTop: 12 }]}>
            {t("exit.feeBalanceLine", {
              balance: feeBalance === null ? "…" : `${feeBalance.toLocaleString("en-US")} sats`,
              needed: needed.toLocaleString("en-US"),
              state: funded ? t("exit.feeReady") : t("exit.feeWaiting"),
            })}
          </Text>
          <Button variant="secondary" onPress={() => void onCopyFee()}>
              {t("exit.copyFeeAddress")}
            </Button>
        </View>

        <Text style={styles.warn}>
          {t("exit.fundWarn")}
        </Text>

        <Text style={styles.label}>{t("exit.esploraLabel")}</Text>
        <TextField
          value={esploraOverride}
          onChangeText={setEsploraOverride}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={network.esploraUrl}
          style={{ fontSize: 13, paddingVertical: 12, marginBottom: 8 }}
        />

        {mismatch ? (
          <Button variant="secondary" onPress={() => navigation.navigate("UnilateralExitPrepare")}>
              {t("exit.repreparePackage")}
            </Button>
        ) : null}

        <Button
          disabled={!funded || !!mismatch}
          onPress={() =>
            navigation.navigate("UnilateralExitExecute", {
              esploraUrl: esploraOverride.trim() || undefined,
            })
          }
        >
          {mismatch
            ? t("exit.fixPackageFirst")
            : funded
              ? t("exit.continueStartExecute")
              : t("exit.waitingFeeFunds")}
        </Button>
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  metaCenter: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    textAlign: "center",
    marginBottom: 16,
    lineHeight: 18,
  },
  err: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: "#E07070",
    lineHeight: 18,
    marginBottom: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E07070",
    borderRadius: 10,
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
  label: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    marginBottom: 6,
  },
  mono: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.fg,
    lineHeight: 18,
  },
  meta: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.fg,
    lineHeight: 20,
  },
});
