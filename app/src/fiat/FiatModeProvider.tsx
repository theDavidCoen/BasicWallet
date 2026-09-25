/**
 * Fiat Mode (DePix / BRL) — per selected Arkade wallet.
 * Enter/exit swaps, Home chrome state, converting overlay.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Alert } from "react-native";
import type { IWallet } from "@arkade-os/sdk";
import { getNetworkConfig } from "../config/network";
import { useWallet } from "../wallet/WalletProvider";
import {
  DEPIX_FEE_BPS,
  DEPIX_MIN_BASE_SATS,
  brlToSatsEstimate,
  depixAssetIdForNetwork,
  depixAtomicToDisplay,
  fetchBtcBrlSpot,
  isDefaultishWalletLabel,
  isFiatModeSwapAvailable,
  stripFiatModeLabelSuffix,
  withFiatModeLabelSuffix,
} from "./depixAssets";
import { setFiatModeActiveGate } from "./fiatModeGate";
import {
  cancelDepixSwap,
  disposeDepixSwapClient,
  runDepixExchange,
  type DepixSwapProgress,
} from "./depixSwapClient";
import {
  readFiatModeState,
  writeFiatModeState,
  type FiatModeJobKind,
  type FiatModeState,
} from "./fiatModeStore";

export type FiatModeStatus = "off" | "on" | "converting";

type FiatModeContextValue = {
  fiatMode: boolean;
  status: FiatModeStatus;
  converting: boolean;
  convertingMessage: string;
  /** Spendable DePix in display units (BRL), or null if unknown. */
  depixDisplay: number | null;
  /** ≈ sats estimate from BRL using last known spot (optional). */
  satsEstimate: number | null;
  feeBps: number;
  minEnterSats: number;
  /**
   * Home enter/exit UI lives in SheetHost (`openFiatModeEnter` / `openFiatModeExit`).
   * Settings uses confirmEnter / confirmExit on-page.
   */
  confirmEnter: () => void;
  confirmExit: () => void;
  cancelConverting: () => void;
  /** Refresh DePix balance from live wallet.getBalance().assets. */
  refreshDepixBalance: () => Promise<void>;
  /** After inbound sats while in fiat mode — swap to DePix (non-blocking job). */
  maybeAutoSwapInboundSats: (sats: number) => void;
  /** Convert DePix → BTC then return; used by Send for sats destinations. */
  convertDepixToSatsForPay: (satsNeeded: number) => Promise<void>;
};

const FiatModeContext = createContext<FiatModeContextValue | null>(null);

function readDepixAtomicFromBalance(raw: unknown, assetId: string): bigint {
  if (!raw || typeof raw !== "object") return 0n;
  const o = raw as Record<string, unknown>;
  const lists = [o.availableAssets, o.assets].filter(Array.isArray) as unknown[][];
  const want = assetId.toLowerCase();
  for (const list of lists) {
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const id = String(row.assetId ?? row.id ?? "").toLowerCase();
      if (id !== want) continue;
      const amt = row.amount;
      if (typeof amt === "bigint") return amt;
      if (typeof amt === "number" && Number.isFinite(amt)) return BigInt(Math.floor(amt));
      if (typeof amt === "string" && /^\d+$/.test(amt)) return BigInt(amt);
    }
  }
  return 0n;
}

export function FiatModeProvider({ children }: { children: ReactNode }) {
  const {
    wallet,
    selectedWallet,
    balanceSats,
    renameWallet,
    refresh,
    beginOutboundSend,
    endOutboundSend,
    notifyFundsReceived,
  } = useWallet();

  const [state, setState] = useState<FiatModeState | null>(null);
  const [converting, setConverting] = useState(false);
  const [convertingMessage, setConvertingMessage] = useState("");
  const [depixDisplay, setDepixDisplay] = useState<number | null>(null);
  const [btcBrl, setBtcBrl] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeSwapIdRef = useRef<string | null>(null);
  const walletIdRef = useRef<string | null>(null);
  const lastSatsRef = useRef<number | null>(null);
  const lastDepixRef = useRef<number | null>(null);

  const networkId = getNetworkConfig().id;
  const walletId = selectedWallet?.kind === "arkade" ? selectedWallet.id : null;

  useEffect(() => {
    walletIdRef.current = walletId;
    if (!walletId) {
      setState(null);
      setDepixDisplay(null);
      disposeDepixSwapClient();
      return;
    }
    let cancelled = false;
    void (async () => {
      const s = await readFiatModeState(networkId, walletId);
      if (!cancelled) setState(s);
    })();
    return () => {
      cancelled = true;
    };
  }, [networkId, walletId]);

  const refreshDepixBalance = useCallback(async () => {
    if (!wallet || !walletId) {
      setDepixDisplay(null);
      return;
    }
    try {
      const raw = await wallet.getBalance();
      const atomic = readDepixAtomicFromBalance(raw, depixAssetIdForNetwork(networkId));
      setDepixDisplay(depixAtomicToDisplay(atomic));
    } catch (e) {
      console.warn("[basic] depix balance read failed", e);
    }
  }, [wallet, walletId, networkId]);

  useEffect(() => {
    if (!state?.fiatMode || !wallet) return;
    void refreshDepixBalance();
  }, [state?.fiatMode, wallet, refreshDepixBalance, balanceSats]);

  // Spot BTCBRL for Home secondary sats-estimate of DePix (not leftover carrier dust).
  useEffect(() => {
    if (!state?.fiatMode) {
      setBtcBrl(null);
      return;
    }
    let cancelled = false;
    const pull = async () => {
      const spot = await fetchBtcBrlSpot();
      if (!cancelled && spot != null) setBtcBrl(spot);
    };
    void pull();
    const timer = setInterval(() => void pull(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [state?.fiatMode, depixDisplay]);

  const patchState = useCallback(
    async (patch: Partial<FiatModeState>) => {
      if (!walletId) return;
      const next = await writeFiatModeState(networkId, walletId, patch);
      if (walletIdRef.current === walletId) setState(next);
    },
    [networkId, walletId],
  );

  const runJob = useCallback(
    async (
      kind: FiatModeJobKind,
      direction: "btc-to-depix" | "depix-to-btc",
      amount: bigint,
    ) => {
      if (!wallet || !walletId || !kind) return;
      if (converting) {
        Alert.alert("Busy", "A conversion is already in progress.");
        return;
      }
      const ac = new AbortController();
      abortRef.current = ac;
      setConverting(true);
      setConvertingMessage(kind === "enter" ? "Converting to BRL…" : "Converting to sats…");
      await patchState({ pendingJob: kind });
      beginOutboundSend();
      try {
        const result = await runDepixExchange({
          wallet: wallet as unknown as IWallet,
          networkId,
          walletId,
          direction,
          amount,
          signal: ac.signal,
          onProgress: (p: DepixSwapProgress) => {
            if (p.swapId) activeSwapIdRef.current = p.swapId;
            setConvertingMessage(p.message);
          },
        });
        activeSwapIdRef.current = result.swapId;
        if (result.outcome === "filled") {
          if (kind === "enter") {
            await patchState({
              fiatMode: true,
              pendingJob: null,
              lastSwapId: result.swapId,
            });
            if (selectedWallet && isDefaultishWalletLabel(selectedWallet.label)) {
              try {
                await renameWallet(
                  walletId,
                  withFiatModeLabelSuffix(stripFiatModeLabelSuffix(selectedWallet.label)),
                );
                await patchState({ labelTouched: true });
              } catch (e) {
                console.warn("[basic] fiat label suffix failed", e);
              }
            }
          } else if (kind === "exit") {
            await patchState({
              fiatMode: false,
              pendingJob: null,
              lastSwapId: result.swapId,
            });
          } else {
            await patchState({ pendingJob: null, lastSwapId: result.swapId });
          }
          await refresh();
          await refreshDepixBalance();
        } else {
          await patchState({ pendingJob: null });
          Alert.alert("Conversion cancelled", "Your previous mode was kept.");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[basic] fiat swap failed", e);
        await patchState({ pendingJob: null });
        Alert.alert("Conversion failed", msg);
      } finally {
        endOutboundSend();
        setConverting(false);
        setConvertingMessage("");
        abortRef.current = null;
        activeSwapIdRef.current = null;
      }
    },
    [
      wallet,
      walletId,
      converting,
      patchState,
      beginOutboundSend,
      endOutboundSend,
      networkId,
      selectedWallet,
      renameWallet,
      refresh,
      refreshDepixBalance,
    ],
  );

  const confirmEnter = useCallback(() => {
    if (!walletId || selectedWallet?.kind !== "arkade") {
      Alert.alert("Fiat Mode", "Select an Arkade wallet first.");
      return;
    }
    if (state?.fiatMode || converting) return;
    if (!isFiatModeSwapAvailable(networkId)) {
      Alert.alert(
        "Fiat Mode unavailable",
        "BRL conversion is not available on Mutinynet yet. Switch to Bitcoin mainnet in Settings to use Fiat Mode.",
      );
      return;
    }
    const sats = balanceSats ?? 0;
    if (sats < DEPIX_MIN_BASE_SATS) {
      Alert.alert(
        "Not enough sats",
        `Need at least ${DEPIX_MIN_BASE_SATS.toLocaleString("en-US")} sats to enter Fiat Mode.`,
      );
      return;
    }
    void runJob("enter", "btc-to-depix", BigInt(sats));
  }, [walletId, selectedWallet, state?.fiatMode, converting, balanceSats, runJob, networkId]);

  const confirmExit = useCallback(() => {
    if (!walletId || !state?.fiatMode || converting) return;
    const display = depixDisplay ?? 0;
    if (!(display > 0)) {
      void patchState({ fiatMode: false, pendingJob: null });
      return;
    }
    const atomic = BigInt(Math.round(display * 1e8));
    void runJob("exit", "depix-to-btc", atomic);
  }, [walletId, state?.fiatMode, converting, depixDisplay, runJob, patchState]);

  const cancelConverting = useCallback(() => {
    abortRef.current?.abort();
    const sid = activeSwapIdRef.current;
    if (sid && wallet && walletId) {
      void cancelDepixSwap({
        wallet: wallet as unknown as IWallet,
        networkId,
        walletId,
        swapId: sid,
      }).catch((e) => console.warn("[basic] cancelDepixSwap", e));
    }
  }, [wallet, walletId, networkId]);

  const maybeAutoSwapInboundSats = useCallback(
    (sats: number) => {
      if (!state?.fiatMode || converting) return;
      if (!(sats >= DEPIX_MIN_BASE_SATS)) return;
      void runJob("auto-inbound", "btc-to-depix", BigInt(Math.floor(sats)));
    },
    [state?.fiatMode, converting, runJob],
  );

  // Inbound sats while in Fiat Mode → auto-swap to DePix.
  useEffect(() => {
    if (!state?.fiatMode || converting) {
      lastSatsRef.current = balanceSats;
      return;
    }
    if (balanceSats == null) return;
    const prev = lastSatsRef.current;
    lastSatsRef.current = balanceSats;
    if (prev == null) return;
    const delta = balanceSats - prev;
    if (delta >= DEPIX_MIN_BASE_SATS) {
      maybeAutoSwapInboundSats(delta);
    }
  }, [balanceSats, state?.fiatMode, converting, maybeAutoSwapInboundSats]);

  const convertDepixToSatsForPay = useCallback(
    async (satsNeeded: number) => {
      if (!(satsNeeded > 0)) return;
      // Quote via exchange give=DePix amounting enough; for v1 use whole available DePix
      // when estimate is uncertain — caller should check insufficiency first.
      const display = depixDisplay ?? 0;
      if (!(display > 0)) throw new Error("No BRL balance to convert");
      const atomic = BigInt(Math.round(display * 1e8));
      await runJob("pay-convert", "depix-to-btc", atomic);
      void satsNeeded;
    },
    [depixDisplay, runJob],
  );

  const fiatMode = Boolean(state?.fiatMode);
  const status: FiatModeStatus = converting
    ? "converting"
    : fiatMode
      ? "on"
      : "off";

  useEffect(() => {
    setFiatModeActiveGate(fiatMode);
    return () => setFiatModeActiveGate(false);
  }, [fiatMode]);

  // DePix balance up while in Fiat Mode → BRL Funds Received (not sats dust).
  useEffect(() => {
    if (!fiatMode || converting) {
      if (!fiatMode) lastDepixRef.current = null;
      return;
    }
    if (depixDisplay == null) return;
    const prev = lastDepixRef.current;
    lastDepixRef.current = depixDisplay;
    if (prev == null) return;
    const delta = depixDisplay - prev;
    if (delta >= 0.01) {
      notifyFundsReceived(delta, "brl");
    }
  }, [fiatMode, converting, depixDisplay, notifyFundsReceived]);

  const satsEstimate = useMemo(() => {
    if (!fiatMode || depixDisplay == null || btcBrl == null) return null;
    return brlToSatsEstimate(depixDisplay, btcBrl);
  }, [fiatMode, depixDisplay, btcBrl]);

  const value = useMemo<FiatModeContextValue>(
    () => ({
      fiatMode,
      status,
      converting,
      convertingMessage,
      depixDisplay: fiatMode ? depixDisplay : null,
      satsEstimate: fiatMode ? satsEstimate : null,
      feeBps: DEPIX_FEE_BPS,
      minEnterSats: DEPIX_MIN_BASE_SATS,
      confirmEnter,
      confirmExit,
      cancelConverting,
      refreshDepixBalance,
      maybeAutoSwapInboundSats,
      convertDepixToSatsForPay,
    }),
    [
      fiatMode,
      status,
      converting,
      convertingMessage,
      depixDisplay,
      satsEstimate,
      confirmEnter,
      confirmExit,
      cancelConverting,
      refreshDepixBalance,
      maybeAutoSwapInboundSats,
      convertDepixToSatsForPay,
    ],
  );

  return <FiatModeContext.Provider value={value}>{children}</FiatModeContext.Provider>;
}

export function useFiatMode(): FiatModeContextValue {
  const ctx = useContext(FiatModeContext);
  if (!ctx) {
    throw new Error("useFiatMode must be used within FiatModeProvider");
  }
  return ctx;
}

/** Optional hook that returns null outside provider (for Settings stubs). */
export function useFiatModeOptional(): FiatModeContextValue | null {
  return useContext(FiatModeContext);
}
