/**
 * Home LTR side sheet — POS keypad → simplified receive (same as Receive overlay).
 * Lightning wallets: same POS keypad → bolt11 invoice (no Arkade BIP21).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import { getNetworkConfig } from "../config/network";
import { useFiatMode } from "../fiat/FiatModeProvider";
import { depixAssetIdForNetwork } from "../fiat/depixAssets";
import { useWallet } from "../wallet/WalletProvider";
import { encodeReceiveBip21Asset } from "../wallet/bip21Asset";
import { encodeReceiveBip21 } from "../wallet/bip21Receive";
import { colors } from "../theme/colors";
import { ReceivePosPanel } from "./ReceivePosPanel";
import {
  encodePosBip21WithOptionalLn,
  watchArkadeLnReceive,
} from "../lightning/arkadeLnSwap";
import { useSheets } from "../navigation/SheetHost";
import { syncLightningHistory, upsertLightningPayments } from "../account/lightningActivity";
import {
  lndhubCreateInvoice,
  lndhubInvoiceStatus,
  type LndHubInvoice,
} from "../lightning/lndhub";
import { loadLndHubCredentials } from "../lightning/lndhubCredentials";
import { loadLndRestCredentials } from "../lightning/lndCredentials";
import {
  lndCreateInvoice,
  lndInvoiceStatus,
  type LndRestInvoice,
} from "../lightning/lndRest";
import { useI18n } from "../i18n";

export function HomePosSheetContent({
  onClose,
  active,
}: {
  onClose: () => void;
  active: boolean;
}) {
  const { t } = useI18n();
  const {
    arkAddress,
    boardingAddress,
    boardingError,
    ensureBoardingAddress,
    selectedWallet,
    walletInteractive,
    balanceStatus,
    wallet,
    bumpActivity,
    refresh,
  } = useWallet();
  const { fiatMode } = useFiatMode();
  const { openFundsReceived } = useSheets();
  const network = getNetworkConfig();
  const arkLnStopRef = useRef<(() => void) | null>(null);

  const isLightning = selectedWallet?.kind === "lightning";
  const [lnMemo, setLnMemo] = useState("");
  const [lnInvoice, setLnInvoice] = useState<LndHubInvoice | LndRestInvoice | null>(
    null,
  );
  const [lnSettled, setLnSettled] = useState(false);
  const settleStopRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    if (isLightning) return;
    if (!selectedWallet || selectedWallet.kind !== "arkade") return;
    if (boardingAddress) return;
    void ensureBoardingAddress().catch(() => {
      /* boardingError set on provider */
    });
  }, [active, boardingAddress, ensureBoardingAddress, isLightning, selectedWallet]);

  useEffect(() => {
    if (active) return;
    arkLnStopRef.current?.();
    arkLnStopRef.current = null;
    settleStopRef.current = true;
    setLnInvoice(null);
    setLnSettled(false);
  }, [active]);

  useEffect(() => {
    return () => {
      arkLnStopRef.current?.();
      arkLnStopRef.current = null;
      settleStopRef.current = true;
    };
  }, []);

  // Poll LN invoice settle while Home POS shows a bolt11 (cancellable).
  useEffect(() => {
    if (!isLightning || !active || !lnInvoice || lnSettled) return;
    settleStopRef.current = false;
    const walletId = selectedWallet?.id;
    if (!walletId) return;

    let cancelled = false;
    const tick = async () => {
      if (cancelled || settleStopRef.current) return;
      try {
        const hub = await loadLndHubCredentials(walletId);
        const rest = hub ? null : await loadLndRestCredentials(walletId);
        if (!hub && !rest) return;
        const status = hub
          ? await lndhubInvoiceStatus(hub, lnInvoice.paymentHash)
          : await lndInvoiceStatus(
              {
                restUrl: rest!.restUrl,
                macaroonHex: rest!.macaroonHex,
                certThumbprint: rest!.certThumbprint,
                allowInsecure: rest!.allowInsecure,
                source: rest!.source,
              },
              lnInvoice.paymentHash,
            );
        if (cancelled || settleStopRef.current) return;
        if (status.paid) {
          setLnSettled(true);
          const paymentHash = lnInvoice.paymentHash.toLowerCase();
          upsertLightningPayments(network.id, walletId, [
            {
              id: `ln-in-${paymentHash}`,
              amountSats: lnInvoice.amountSats,
              direction: "in",
              createdAt: Date.now(),
              settled: true,
              memo: lnInvoice.memo,
              paymentHash,
              preimage: status.preimage,
            },
          ]);
          bumpActivity();
          await refresh();
          try {
            await syncLightningHistory(network.id, walletId);
            bumpActivity();
          } catch {
            /* optional */
          }
          const amount = lnInvoice.amountSats;
          onClose();
          requestAnimationFrame(() => {
            openFundsReceived({ amount, kind: "lightning" });
          });
        }
      } catch (e) {
        console.warn("[basic] home pos ln invoice poll", e);
      }
    };

    void tick();
    const id = setInterval(() => {
      void tick();
    }, 3_000);
    return () => {
      cancelled = true;
      settleStopRef.current = true;
      clearInterval(id);
    };
  }, [
    isLightning,
    active,
    lnInvoice,
    lnSettled,
    selectedWallet?.id,
    network.id,
    bumpActivity,
    refresh,
    onClose,
    openFundsReceived,
  ]);

  const bip21Uri = useMemo(
    () => encodeReceiveBip21(boardingAddress, arkAddress, null),
    [boardingAddress, arkAddress],
  );

  const buildPosBip21 = useCallback(
    async (amountSats: number) => {
      arkLnStopRef.current?.();
      arkLnStopRef.current = null;
      const { uri, minted } = await encodePosBip21WithOptionalLn({
        boarding: boardingAddress,
        ark: arkAddress,
        amountSats,
        wallet,
        networkId: network.id,
        walletId: selectedWallet?.id,
      });
      if (minted && wallet && selectedWallet?.id) {
        arkLnStopRef.current = watchArkadeLnReceive({
          wallet,
          networkId: network.id,
          walletId: selectedWallet.id,
          swapId: minted.swapId,
          onPaid: () => {
            bumpActivity();
            openFundsReceived({ amount: minted.amountSats, kind: "lightning" });
          },
          onFailed: (outcome) => {
            console.warn("[basic] arkade ln receive ended", outcome);
          },
        });
      }
      return uri;
    },
    [
      boardingAddress,
      arkAddress,
      wallet,
      network.id,
      selectedWallet?.id,
      bumpActivity,
      openFundsReceived,
    ],
  );

  const buildPosBrlUri = useCallback(
    (brlDisplay: number) => {
      if (!arkAddress || !(brlDisplay > 0)) return null;
      try {
        return encodeReceiveBip21Asset(
          arkAddress,
          depixAssetIdForNetwork(network.id),
          brlDisplay,
        );
      } catch {
        return null;
      }
    },
    [arkAddress, network.id],
  );

  const createLnInvoiceUri = useCallback(
    async (amountSats: number): Promise<string | null> => {
      if (!(amountSats > 0)) {
        Alert.alert("Invalid amount", "Enter a positive amount in sats.");
        return null;
      }
      const walletId = selectedWallet?.id;
      if (!walletId) {
        Alert.alert("No Lightning wallet", "Connect a node first.");
        return null;
      }
      try {
        const hub = await loadLndHubCredentials(walletId);
        const rest = hub ? null : await loadLndRestCredentials(walletId);
        if (!hub && !rest) {
          throw new Error("Lightning node not connected for this wallet");
        }
        const inv = hub
          ? await lndhubCreateInvoice(hub, {
              amountSats,
              memo: lnMemo.trim() || undefined,
            })
          : await lndCreateInvoice(
              {
                restUrl: rest!.restUrl,
                macaroonHex: rest!.macaroonHex,
                certThumbprint: rest!.certThumbprint,
                allowInsecure: rest!.allowInsecure,
                source: rest!.source,
              },
              {
                amountSats,
                memo: lnMemo.trim() || undefined,
              },
            );
        setLnInvoice(inv);
        setLnSettled(false);
        return inv.paymentRequest;
      } catch (e) {
        Alert.alert(
          "Could not create invoice",
          e instanceof Error ? e.message : "Unknown error",
        );
        return null;
      }
    },
    [lnMemo, selectedWallet?.id],
  );

  const onClearLnInvoice = useCallback(() => {
    settleStopRef.current = true;
    setLnInvoice(null);
    setLnSettled(false);
  }, []);

  // Same readiness as Home's "syncing…" (balanceStatus), not openRestoreDone —
  // live balance can land and clear Home sync before HD restore finishes.
  // Request stays disabled in the panel until bip21Uri exists (Arkade).
  // Lightning POS is ready when balance is ready (no boarding BIP21).
  const posReady = isLightning
    ? walletInteractive && balanceStatus !== "loading"
    : walletInteractive && balanceStatus !== "loading";

  if (isLightning) {
    const lnHint = lnInvoice
      ? lnSettled
        ? t("receive.paid")
        : t("receive.waitingPayment")
      : null;
    return (
      <View style={styles.fill}>
        <ReceivePosPanel
          bip21Uri={null}
          lightningMode
          memo={lnMemo}
          onMemoChange={setLnMemo}
          onClose={onClose}
          onRequestUri={createLnInvoiceUri}
          onEditAmount={onClearLnInvoice}
          receiveHint={lnHint}
          active={active && posReady}
        />
        {!posReady ? (
          <View style={styles.loadingOverlay} pointerEvents="auto">
            <ActivityIndicator color={colors.fg} size="large" />
            <Text style={styles.loadingText}>Preparing POS…</Text>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      {boardingError && !bip21Uri ? (
        <Text style={styles.banner}>{boardingError}</Text>
      ) : null}
      <ReceivePosPanel
        bip21Uri={bip21Uri}
        onClose={onClose}
        onRequestUri={buildPosBip21}
        onRequestBrlUri={fiatMode ? buildPosBrlUri : undefined}
        fiatMode={fiatMode}
        active={active && posReady}
      />
      {!posReady ? (
        <View style={styles.loadingOverlay} pointerEvents="auto">
          <ActivityIndicator color={colors.fg} size="large" />
          <Text style={styles.loadingText}>Preparing POS…</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  banner: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    textAlign: "center",
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 20,
  },
  loadingText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    marginTop: 16,
    textAlign: "center",
  },
});
