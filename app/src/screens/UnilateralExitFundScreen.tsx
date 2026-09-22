/**
 * Step 3 — fund HD fee address, then continue to step 4 (Start execute page).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
import { getNetworkConfig } from "../config/network";
import { requireExitAuth, canRevealExitSecrets } from "../exit/gates";
import { createFeeOnchainWallet, pollFeeBalance } from "../exit/feeWallet";
import { loadExitPackage, readExitPackageMeta } from "../exit/packageStore";
import type { ExitPackageMeta } from "../exit/packageStore";
import { useWallet } from "../wallet/WalletProvider";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

export function UnilateralExitFundScreen() {
  const navigation = useNavigation<RootNav>();
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
      const auth = await requireExitAuth("Confirm open exit package");
      if (!auth.ok) {
        setLoading(false);
        Alert.alert("Cancelled", auth.reason, [
          { text: "OK", onPress: () => navigation.goBack() },
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
          `Stored package recovers ~${loaded.totals.recoveredSats.toLocaleString("en-US")} sats, ` +
            `but prepare reported ~${expectedRecovered.toLocaleString("en-US")}. ` +
            `A background auto-prepare may have overwritten it — go back and prepare again.`,
        );
      } else {
        setMismatch(null);
      }
    } else if (loaded && expectedFunding != null) {
      const d = Math.abs(loaded.totals.fundingRequiredSats - expectedFunding);
      setMismatch(
        d > 1_000
          ? `Fee need on disk ~${loaded.totals.fundingRequiredSats.toLocaleString("en-US")} vs prepare ~${expectedFunding.toLocaleString("en-US")}.`
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
    Alert.alert("Copied", "Fee address copied");
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
        <ExitStepHeader step={EXIT_STEP.fundFees} title="FUND FEE ADDRESS" />
        <Text style={ui.caption}>No stored package. Complete step 2 first.</Text>
        <Pressable
          style={ui.primaryBtn}
          onPress={() => navigation.navigate("UnilateralExitPrepare")}
        >
          <Text style={ui.primaryBtnText}>Go to prepare</Text>
        </Pressable>
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
          title="FUND FEE ADDRESS"
          caption="This address is derived from your Arkade seed — it is yours. Send onchain sats here so Basic can pay miner fees when executing."
        />

        <Text style={styles.metaCenter}>
          Sweep → {pkg.sweepAddress.slice(0, 18)}… · recover ~
          {pkg.totals.recoveredSats.toLocaleString("en-US")} sats
          {meta?.source ? ` · ${meta.source}` : ""}
        </Text>

        {mismatch ? <Text style={styles.err}>{mismatch}</Text> : null}

        <View style={ui.cardMuted}>
          <Text style={styles.label}>Your fee address</Text>
          <Text style={styles.mono} selectable>
            {feeAddress ?? "…"}
          </Text>
          <Text style={[styles.meta, { marginTop: 12 }]}>
            Balance:{" "}
            {feeBalance === null ? "…" : `${feeBalance.toLocaleString("en-US")} sats`}
            {" · need "}
            {needed.toLocaleString("en-US")}
            {funded ? " · ready" : " · waiting for funds"}
          </Text>
          <Pressable style={ui.secondaryBtn} onPress={() => void onCopyFee()}>
            <Text style={ui.secondaryBtnText}>Copy fee address</Text>
          </Pressable>
        </View>

        <Text style={styles.warn}>
          Fund from an external wallet. When the balance covers the need, continue to Start
          execute (step 4).
        </Text>

        <Text style={styles.label}>Esplora API (optional override)</Text>
        <TextInput
          value={esploraOverride}
          onChangeText={setEsploraOverride}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={network.esploraUrl}
          placeholderTextColor={colors.hint}
          style={styles.input}
        />

        {mismatch ? (
          <Pressable
            style={ui.secondaryBtn}
            onPress={() => navigation.navigate("UnilateralExitPrepare")}
          >
            <Text style={ui.secondaryBtnText}>Re-prepare package</Text>
          </Pressable>
        ) : null}

        <Pressable
          style={[ui.primaryBtn, (!funded || !!mismatch) && { opacity: 0.5 }]}
          disabled={!funded || !!mismatch}
          onPress={() =>
            navigation.navigate("UnilateralExitExecute", {
              esploraUrl: esploraOverride.trim() || undefined,
            })
          }
        >
          <Text style={ui.primaryBtnText}>
            {mismatch
              ? "Fix package first"
              : funded
                ? "Continue · start execute"
                : "Waiting for fee funds…"}
          </Text>
        </Pressable>
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
  input: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.fg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
});
