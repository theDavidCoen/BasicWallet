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
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

export function UnilateralExitExecuteScreen() {
  const navigation = useNavigation<RootNav>();
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
      const auth = await requireExitAuth("Confirm open exit execute");
      if (!auth.ok) {
        if (!cancelled) {
          setLoading(false);
          Alert.alert("Cancelled", auth.reason, [
            { text: "OK", onPress: () => navigation.goBack() },
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
    const auth = await requireExitAuth("Confirm export exit package");
    if (!auth.ok) {
      Alert.alert("Cancelled", auth.reason);
      return;
    }
    const json = serializeExitPackage(pkg);
    await Share.share({ message: json });
  }, [pkg]);

  const onExecute = useCallback(async () => {
    if (!walletId || !pkg) return;
    if (!funded) {
      Alert.alert(
        "Fund fees first",
        "Go back to step 3 and fund your fee address before Start execute.",
        [
          {
            text: "Back to fund",
            onPress: () => navigation.navigate("UnilateralExitFund"),
          },
          { text: "OK", style: "cancel" },
        ],
      );
      return;
    }
    const auth = await requireExitAuth("Confirm execute unilateral exit");
    if (!auth.ok) {
      Alert.alert("Cancelled", auth.reason);
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
        "Could not start exit",
        e instanceof Error ? e.message : "Unknown error",
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
        <ExitStepHeader step={EXIT_STEP.execute} title="START EXECUTE" />
        <Text style={ui.caption}>No stored package. Complete steps 1–3 first.</Text>
        <Pressable
          style={ui.primaryBtn}
          onPress={() => navigation.navigate("ExitRecoveryAddress", { from: "exit" })}
        >
          <Text style={ui.primaryBtnText}>Start from recovery</Text>
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
          title="START EXECUTE"
          caption="Starts the stored package onchain in the background. You can leave the exit screens; progress continues until Stop or completion."
        />

        <View style={ui.cardMuted}>
          <Text style={styles.meta}>
            Sweep → {pkg.sweepAddress.slice(0, 18)}…
          </Text>
          <Text style={styles.meta}>
            Recover ~{pkg.totals.recoveredSats.toLocaleString("en-US")} sats
          </Text>
          <Text style={styles.meta}>
            Fee balance:{" "}
            {feeBalance === null ? "…" : `${feeBalance.toLocaleString("en-US")} sats`}
            {" · need "}
            {needed.toLocaleString("en-US")}
            {funded ? " · ready" : " · shortfall"}
          </Text>
        </View>

        {!funded ? (
          <Text style={styles.warn}>
            Fee address is underfunded. Go back to step 3 and send sats before starting.
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
            <Text style={ui.primaryBtnText}>Start execute</Text>
          )}
        </Pressable>

        <Pressable
          style={ui.secondaryBtn}
          onPress={() => navigation.navigate("UnilateralExitFund")}
          disabled={starting}
        >
          <Text style={ui.secondaryBtnText}>Back to fund fees</Text>
        </Pressable>

        <Pressable style={ui.secondaryBtn} onPress={() => void onExport()} disabled={starting}>
          <Text style={ui.secondaryBtnText}>Export package (advanced)</Text>
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
