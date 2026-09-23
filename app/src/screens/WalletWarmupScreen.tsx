/**
 * Pre-Home gate: first open vs returning. Dismisses when wallet is interactive
 * and restore finished, or after a soft timeout so the shell stays navigable.
 */

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { BasicLogo } from "../components/BasicLogo";
import { useWallet } from "../wallet/WalletProvider";
import { markWarmupSeen, readWarmupSeen } from "../wallet/warmupSeen";
import { colors } from "../theme/colors";

const WARMUP_TIMEOUT_MS = 10_000;

export { markWarmupSeen, WARMUP_SEEN_KEY } from "../wallet/warmupSeen";

export function WalletWarmupScreen() {
  const {
    walletInteractive,
    openRestoreDone,
    selectedWallet,
    markSessionLive,
  } = useWallet();
  /** null = still reading flag — avoid flashing SETTING UP for returning users. */
  const [returning, setReturning] = useState<boolean | null>(null);

  const finishWarmup = useCallback(() => {
    void markWarmupSeen();
    markSessionLive();
  }, [markSessionLive]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const seen = await readWarmupSeen();
      if (!cancelled) setReturning(seen);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const soft = setTimeout(() => {
      finishWarmup();
    }, WARMUP_TIMEOUT_MS);
    return () => clearTimeout(soft);
  }, [finishWarmup]);

  useEffect(() => {
    const ln = selectedWallet?.kind === "lightning";
    if (ln) {
      finishWarmup();
      return;
    }
    if (!walletInteractive || !openRestoreDone) return;
    finishWarmup();
  }, [walletInteractive, openRestoreDone, selectedWallet?.kind, finishWarmup]);

  // Wait for flag before painting title — prevents SETTING UP flash on return.
  if (returning === null) {
    return (
      <View style={styles.root}>
        <BasicLogo scale={1.2} />
        <ActivityIndicator color={colors.fg} style={styles.spin} />
      </View>
    );
  }

  const title = returning ? "WELCOME BACK" : "SETTING UP";
  const caption = returning
    ? "Syncing your wallet…"
    : "Configuring your wallet.\nThis may take a moment.";

  return (
    <View style={styles.root}>
      <BasicLogo scale={1.2} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.caption}>{caption}</Text>
      <ActivityIndicator color={colors.fg} style={styles.spin} />
      <Text style={styles.hint}>Please wait</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 20,
    color: colors.fg,
    textAlign: "center",
    marginTop: 48,
  },
  caption: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 20,
    marginTop: 12,
  },
  spin: { marginTop: 32 },
  hint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    textAlign: "center",
    marginTop: 16,
  },
});
