/**
 * Step 2 — review exit package (auto-prepare is the source of truth).
 * Sweep address comes from step 1 only.
 * Ready = saved package covers every current VTXO (exact count + sat total).
 */

import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { ExitQuote } from "@arkade-os/sdk";
import { ExitStepHeader, EXIT_STEP } from "../components/ExitStepHeader";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { getNetworkConfig } from "../config/network";
import { requireExitAuth } from "../exit/gates";
import { bumpExitPrepareEpoch, scheduleAutoPrepareSoon } from "../exit/autoPrepare";
import { readRecoveryAddress } from "../exit/recoveryAddress";
import {
  estimateUnilateralExit,
  prepareUnilateralExit,
  summarizeLocalVtxos,
  validateExternalSweepAddress,
} from "../exit/runExit";
import {
  exitAutoFingerprint,
  exitPackageIsCurrent,
  clearExitPackage,
  hasExitPackage,
  readExitPackageMeta,
  type ExitPackageMeta,
} from "../exit/packageStore";
import { getOpenWallet } from "../wallet/hdWallet";
import { useWallet } from "../wallet/WalletProvider";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

function midEllipsis(s: string, left = 12, right = 8): string {
  if (s.length <= left + right + 1) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

export function UnilateralExitPrepareScreen() {
  const navigation = useNavigation<RootNav>();
  const network = getNetworkConfig();
  const { selectedWallet } = useWallet();
  const [sweep, setSweep] = useState("");
  const [quote, setQuote] = useState<ExitQuote | null>(null);
  const [stored, setStored] = useState<ExitPackageMeta | null>(null);
  const [packageReady, setPackageReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [phase, setPhase] = useState<"idle" | "estimating" | "preparing">("idle");

  const walletId = selectedWallet?.kind === "arkade" ? selectedWallet.id : null;

  const refreshStatus = useCallback(
    async (recovery: string) => {
      if (!walletId) {
        setStored(null);
        setPackageReady(false);
        return;
      }
      const w = getOpenWallet();
      const sum = w ? await summarizeLocalVtxos(w) : { count: 0, totalSats: 0 };
      const has = await hasExitPackage(network.id, walletId);
      const meta = has ? await readExitPackageMeta(network.id, walletId) : null;
      const ready =
        !!meta &&
        !!recovery.trim() &&
        exitPackageIsCurrent(meta, recovery, sum.count, sum.totalSats);
      // Drop legacy / blocking packages so auto-prepare rebuilds a usable one.
      if (has && meta && !ready) {
        await clearExitPackage(network.id, walletId).catch(() => undefined);
      }
      setStored(ready ? meta : null);
      setPackageReady(ready);
      if (!ready && recovery.trim() && sum.totalSats > 0) {
        scheduleAutoPrepareSoon("step2-needs-package");
      }
    },
    [walletId, network.id],
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoadingStatus(true);
      setQuote(null);
      void (async () => {
        const rec = (await readRecoveryAddress(network.id)) ?? "";
        if (cancelled) return;
        setSweep(rec);
        await refreshStatus(rec);
        if (!cancelled) setLoadingStatus(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [network.id, refreshStatus]),
  );

  const goFund = useCallback(
    (recovered: number, funding: number) => {
      navigation.replace("UnilateralExitFund", {
        expectedRecoveredSats: recovered,
        expectedFundingSats: funding,
      });
    },
    [navigation],
  );

  const onContinueExisting = useCallback(() => {
    if (!stored) return;
    goFund(stored.recoveredSats, stored.fundingRequiredSats);
  }, [stored, goFund]);

  const onEstimate = useCallback(async () => {
    if (!walletId) return;
    if (!sweep.trim()) {
      Alert.alert("Recovery address", "Set a recovery address in step 1 first.");
      return;
    }
    const err = await validateExternalSweepAddress(sweep, network.id, walletId);
    if (err) {
      Alert.alert("Address", err);
      return;
    }
    setBusy(true);
    setPhase("estimating");
    setQuote(null);
    try {
      const { quote: q } = await estimateUnilateralExit(walletId, sweep);
      setQuote(q);
    } catch (e) {
      Alert.alert(
        "Estimate failed",
        e instanceof Error ? e.message : "Could not quote exit (indexer may be down).",
      );
    } finally {
      setBusy(false);
      setPhase("idle");
    }
  }, [walletId, sweep, network.id]);

  const onPrepare = useCallback(async () => {
    if (!walletId || !quote) return;
    const err = await validateExternalSweepAddress(sweep, network.id, walletId);
    if (err) {
      Alert.alert("Address", err);
      return;
    }
    const auth = await requireExitAuth("Confirm prepare unilateral exit package");
    if (!auth.ok) {
      Alert.alert("Cancelled", auth.reason);
      return;
    }
    setBusy(true);
    setPhase("preparing");
    try {
      const epoch = bumpExitPrepareEpoch("manual-prepare");
      const w = getOpenWallet();
      const sum = w ? await summarizeLocalVtxos(w) : { count: 0, totalSats: 0 };
      const fp = exitAutoFingerprint(sweep, sum.count, sum.totalSats);
      const pkg = await prepareUnilateralExit(network.id, walletId, sweep, undefined, {
        source: "manual",
        autoFingerprint: fp,
        prepareEpoch: epoch,
      });
      await refreshStatus(sweep);
      goFund(pkg.totals.recoveredSats, pkg.totals.fundingRequiredSats);
    } catch (e) {
      Alert.alert(
        "Prepare failed",
        e instanceof Error ? e.message : "Could not build exit package.",
      );
    } finally {
      setBusy(false);
      setPhase("idle");
    }
  }, [walletId, quote, sweep, network.id, goFund, refreshStatus]);

  if (!walletId) {
    return (
      <ScreenChrome logoScale={0.77}>
        <ExitStepHeader step={EXIT_STEP.prepare} title="PREPARE PACKAGE" />
        <Text style={ui.caption}>Select an Arkade wallet first.</Text>
      </ScreenChrome>
    );
  }

  if (loadingStatus) {
    return (
      <ScreenChrome logoScale={0.77}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.fg} />
        </View>
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
          step={EXIT_STEP.prepare}
          title="EXIT PACKAGE"
          caption={
            !sweep.trim()
              ? "Set a recovery address in step 1 first."
              : packageReady
                ? "Auto-prepare saved a package for your current balance. Continue to fund fees."
                : "Auto-prepare is building or updating the package. Wait a moment, or estimate manually."
          }
        />

        {sweep.trim() ? (
          <Text style={[ui.hint, { marginTop: 8 }]}>
            Recovery (step 1): {midEllipsis(sweep.trim())}
          </Text>
        ) : (
          <Pressable
            style={ui.secondaryBtn}
            onPress={() =>
              navigation.navigate("ExitRecoveryAddress", { from: "exit" })
            }
          >
            <Text style={ui.secondaryBtnText}>Set recovery address</Text>
          </Pressable>
        )}

        {packageReady && stored ? (
          <View style={ui.cardMuted}>
            <Text style={styles.meta}>
              Package ready
              {stored.source === "auto"
                ? " (auto)"
                : stored.source === "manual"
                  ? " (manual)"
                  : ""}
            </Text>
            <Text style={styles.meta}>
              Recover ~{stored.recoveredSats.toLocaleString("en-US")} sats
              {stored.includedSats != null
                ? ` from ${stored.includedSats.toLocaleString("en-US")} sats included`
                : ""}
            </Text>
            {stored.coveredSats != null &&
            stored.includedSats != null &&
            stored.coveredSats > stored.includedSats ? (
              <Text style={[styles.meta, { color: colors.hint }]}>
                {(stored.coveredSats - stored.includedSats).toLocaleString("en-US")}{" "}
                sats in skipped VTXOs (not in this exit)
              </Text>
            ) : null}
            <Text style={styles.meta}>
              Fee fund needed ~{stored.fundingRequiredSats.toLocaleString("en-US")} sats
              {stored.txCount ? ` · ${stored.txCount} tx(s)` : ""}
            </Text>
            <Text style={[styles.meta, { color: colors.hint, marginTop: 6 }]}>
              Only the latest package is kept. Auto-prepare replaces it when your
              balance changes.
            </Text>
          </View>
        ) : null}

        {packageReady ? (
          <>
            <Pressable style={ui.primaryBtn} onPress={onContinueExisting}>
              <Text style={ui.primaryBtnText}>Continue · fund fees</Text>
            </Pressable>
            <Pressable
              style={ui.secondaryBtn}
              disabled={busy || !sweep.trim()}
              onPress={() => void onEstimate()}
            >
              {phase === "estimating" ? (
                <ActivityIndicator color={colors.fg} />
              ) : (
                <Text style={ui.secondaryBtnText}>Rebuild · estimate first</Text>
              )}
            </Pressable>
          </>
        ) : (
          <Pressable
            style={[ui.secondaryBtn, (busy || !sweep.trim()) && { opacity: 0.6 }]}
            disabled={busy || !sweep.trim()}
            onPress={() => void onEstimate()}
          >
            {phase === "estimating" ? (
              <ActivityIndicator color={colors.fg} />
            ) : (
              <Text style={ui.secondaryBtnText}>Estimate</Text>
            )}
          </Pressable>
        )}

        {quote ? (
          <View style={ui.cardMuted}>
            <Text style={styles.meta}>
              Recover ~{quote.totals.recoveredSats.toLocaleString("en-US")} sats
            </Text>
            <Text style={styles.meta}>
              Fees ~{quote.totals.totalFeeSats.toLocaleString("en-US")} sats ·{" "}
              {quote.totals.txCount} tx(s)
            </Text>
            <Text style={styles.meta}>
              Fee fund needed ~{quote.totals.fundingRequiredSats.toLocaleString("en-US")}{" "}
              sats (step 3)
            </Text>
            {quote.validUntil ? (
              <Text style={styles.meta}>
                Valid until {new Date(quote.validUntil * 1000).toLocaleString()}
              </Text>
            ) : null}
            <Text style={[styles.meta, { marginTop: 8, color: colors.hint }]}>
              VTXOs: {quote.vtxos.filter((v) => !v.skipped).length} included
              {quote.vtxos.some((v) => v.skipped)
                ? ` · ${quote.vtxos.filter((v) => v.skipped).length} skipped`
                : ""}
            </Text>
          </View>
        ) : null}

        {quote ? (
          <Pressable
            style={[ui.primaryBtn, busy && { opacity: 0.5 }]}
            disabled={busy}
            onPress={() => void onPrepare()}
          >
            {phase === "preparing" ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={ui.primaryBtnText}>
                {packageReady ? "Replace package · continue" : "Prepare package · continue"}
              </Text>
            )}
          </Pressable>
        ) : null}

        <Text style={[ui.hint, { marginTop: 10 }]}>
          {packageReady
            ? "Recover amount is after sweep fees; skipped uneconomic VTXOs stay listed in the package."
            : "Prepare does not spend fee sats. You fund the fee address only in step 3."}
        </Text>
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
  },
});
