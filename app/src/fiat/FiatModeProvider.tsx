/**
 * Fiat Mode (DePix / BRL) — per selected Arkade wallet.
 * Enter/exit swaps, Home chrome state, converting overlay.
 *
 * Stay on HD (`walletMode: "hd"`). A prior α10 experiment switched to
 * `static` during Fiat Mode and broke asset sends
 * ("Descriptor signing requested but no DescriptorProvider").
 * Enter/exit swap fills suppress BRL/sats receive toasts via fiatModeGate;
 * real inbound payments still notify.
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
import { DEFAULT_MIN_VTXO_SATS } from "../wallet/arkMultiSend";
import { getOpenWalletMode } from "../wallet/hdWallet";
import { useWallet } from "../wallet/WalletProvider";
import {
  brlToSatsEstimate,
  depixAssetIdForNetwork,
  depixAtomicToDisplay,
  depixDisplayToAtomic,
  fetchFiatSpot,
  fiatFeeBps,
  fiatMinBaseSats,
  fiatStableForNetwork,
  isFiatModeSwapAvailable,
  stripFiatModeLabelSuffix,
} from "./depixAssets";
import {
  quietFiatEnterNotices,
  quietFiatExitNotices,
  registerFiatDepixOptimistic,
  setFiatModeActiveGate,
} from "./fiatModeGate";
import {
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
  /**
   * After Exit conversion: expected sats not yet reflected in live Home balance.
   * Cleared when balanceSats catches up (or timeout).
   */
  pendingExitSats: number | null;
  feeBps: number;
  minEnterSats: number;
  /**
   * Home enter/exit UI lives in SheetHost (`openFiatModeEnter` / `openFiatModeExit`).
   * Settings uses confirmEnter / confirmExit on-page.
   * Resolves true when conversion filled (or exit with zero balance).
   */
  confirmEnter: () => Promise<boolean>;
  confirmExit: () => Promise<boolean>;
  cancelConverting: () => void;
  /** Refresh DePix balance from live wallet.getBalance().assets. */
  refreshDepixBalance: () => Promise<void>;
  /** Optimistic DePix spend so Home does not flash 0 while ASP settles. */
  applyLocalDepixSpend: (displayAmount: number) => void;
  /** Optimistic DePix receive so Home updates with the Funds Received notice. */
  applyLocalDepixReceive: (displayAmount: number) => void;
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
    reopenWithWalletMode,
  } = useWallet();

  const [state, setState] = useState<FiatModeState | null>(null);
  const [converting, setConverting] = useState(false);
  const [convertingMessage, setConvertingMessage] = useState("");
  const [depixDisplay, setDepixDisplay] = useState<number | null>(null);
  const [btcBrl, setBtcBrl] = useState<number | null>(null);
  const [pendingExitSats, setPendingExitSats] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeSwapIdRef = useRef<string | null>(null);
  const walletIdRef = useRef<string | null>(null);
  const lastSatsRef = useRef<number | null>(null);
  const lastDepixRef = useRef<number | null>(null);
  /** Floor while a local spend/receive is settling — ignore transient empty/overshoot polls. */
  const optimisticDepixRef = useRef<number | null>(null);
  const optimisticDepixUntilRef = useRef(0);
  /** Sats expected on Home after Exit fill (pre-exit sats + swap proceeds). */
  const pendingExitTargetRef = useRef<number | null>(null);
  const pendingExitClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const clearOptimisticDepix = useCallback(() => {
    optimisticDepixRef.current = null;
    optimisticDepixUntilRef.current = 0;
  }, []);

  const applyLocalDepixSpend = useCallback((displayAmount: number) => {
    const spend = Number(displayAmount);
    if (!(spend > 0)) return;
    setDepixDisplay((prev) => {
      const base = prev ?? 0;
      const next = Math.max(0, Math.round((base - spend) * 100) / 100);
      optimisticDepixRef.current = next;
      optimisticDepixUntilRef.current = Date.now() + 20_000;
      lastDepixRef.current = next;
      console.warn("[basic] applyLocalDepixSpend", { spend, next });
      return next;
    });
  }, []);

  const applyLocalDepixReceive = useCallback((displayAmount: number) => {
    const add = Number(displayAmount);
    if (!(add > 0)) return;
    setDepixDisplay((prev) => {
      const base = prev ?? 0;
      const next = Math.round((base + add) * 100) / 100;
      optimisticDepixRef.current = next;
      optimisticDepixUntilRef.current = Date.now() + 20_000;
      lastDepixRef.current = next;
      console.warn("[basic] applyLocalDepixReceive", { add, next });
      return next;
    });
  }, []);

  const refreshDepixBalance = useCallback(async () => {
    if (!wallet || !walletId) {
      setDepixDisplay(null);
      clearOptimisticDepix();
      return;
    }
    try {
      const raw = await wallet.getBalance();
      const atomic = readDepixAtomicFromBalance(raw, depixAssetIdForNetwork(networkId));
      const live = depixAtomicToDisplay(atomic, networkId);
      const opt = optimisticDepixRef.current;
      const hold =
        opt != null && Date.now() < optimisticDepixUntilRef.current;
      if (hold && opt != null) {
        // Transient empty after asset send — keep optimistic floor.
        if (live + 1e-8 < opt && live < 0.01 && opt >= 0.01) {
          console.warn("[basic] depix poll ignore empty live", { live, opt });
          return;
        }
        // Transient overshoot (double-count / unsettled vtxos) — keep optimistic.
        if (live > opt + 0.05) {
          console.warn("[basic] depix poll ignore overshoot", { live, opt });
          return;
        }
        // Live caught up to optimistic (±0.02) — adopt and clear hold.
        if (Math.abs(live - opt) <= 0.02) {
          clearOptimisticDepix();
          setDepixDisplay(live);
          return;
        }
        // Live slightly below optimistic (fee dust) — adopt when close.
        if (live >= opt - 0.05 && live <= opt) {
          clearOptimisticDepix();
          setDepixDisplay(live);
          return;
        }
        // Still settling — keep showing optimistic.
        return;
      }
      clearOptimisticDepix();
      setDepixDisplay(live);
    } catch (e) {
      console.warn("[basic] depix balance read failed", e);
    }
  }, [wallet, walletId, networkId, clearOptimisticDepix]);

  useEffect(() => {
    if (!state?.fiatMode || !wallet) return;
    void refreshDepixBalance();
    // Pure asset receives may not change balanceSats (amount: 0 carrier).
    // Poll the designated stable so BRL/USD Funds Received can fire.
    const timer = setInterval(() => void refreshDepixBalance(), 4_000);
    return () => clearInterval(timer);
  }, [state?.fiatMode, wallet, refreshDepixBalance, balanceSats]);

  // Spot BTC/fiat for Home secondary sats-estimate of the stable (not leftover carrier dust).
  useEffect(() => {
    if (!state?.fiatMode) {
      setBtcBrl(null);
      return;
    }
    let cancelled = false;
    const pull = async () => {
      const spot = await fetchFiatSpot(networkId);
      if (!cancelled && spot != null) setBtcBrl(spot);
    };
    void pull();
    const timer = setInterval(() => void pull(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [state?.fiatMode, depixDisplay, networkId]);

  const patchState = useCallback(
    async (patch: Partial<FiatModeState>) => {
      if (!walletId) return;
      const next = await writeFiatModeState(networkId, walletId, patch);
      if (walletIdRef.current === walletId) setState(next);
    },
    [networkId, walletId],
  );

  // Strip legacy " - FIAT MODE" label suffixes once (badge is separate UI now).
  useEffect(() => {
    if (!walletId || !selectedWallet) return;
    const label = selectedWallet.label ?? "";
    const cleaned = stripFiatModeLabelSuffix(label);
    if (cleaned !== label) {
      void renameWallet(walletId, cleaned).catch((e) =>
        console.warn("[basic] strip fiat label failed", e),
      );
    }
  }, [walletId, selectedWallet?.label, renameWallet, selectedWallet]);

  // α10 recovery: static mode broke DescriptorProvider signing — force HD.
  useEffect(() => {
    if (!walletId) return;
    if (getOpenWalletMode() !== "static") return;
    console.warn("[basic] fiat mode: recovering HD from static engine");
    void reopenWithWalletMode("hd");
  }, [walletId, reopenWithWalletMode]);

  const runJob = useCallback(
    async (
      kind: FiatModeJobKind,
      direction: "btc-to-depix" | "depix-to-btc",
      amount: bigint,
    ): Promise<boolean> => {
      if (!wallet || !walletId || !kind) return false;
      if (converting) {
        Alert.alert("Busy", "A conversion is already in progress.");
        return false;
      }
      const ac = new AbortController();
      abortRef.current = ac;
      setConverting(true);
      setConvertingMessage(
        kind === "enter"
          ? `Converting to ${fiatStableForNetwork(networkId).displayCode}…`
          : "Converting to sats…",
      );
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
            // No BRL Funds Received for the enter swap itself.
            quietFiatEnterNotices(60_000);
            clearOptimisticDepix();
            await patchState({
              fiatMode: true,
              pendingJob: null,
              lastSwapId: result.swapId,
            });
          } else if (kind === "exit") {
            // No sats Funds Received for the exit swap itself (incl. 330 dust).
            quietFiatExitNotices(90_000);
            const preExitSats = balanceSats ?? 0;
            const exitBrl = depixDisplay ?? 0;
            const spot = btcBrl;
            const estimatedRaw =
              exitBrl > 0 && spot != null && spot > 0
                ? brlToSatsEstimate(exitBrl, spot)
                : null;
            const estimatedProceeds = estimatedRaw ?? 0;
            // Show pending until live Home balance catches up (avoid 990→4606 flash confusion).
            const target = Math.max(preExitSats, estimatedProceeds);
            if (target > preExitSats + 10) {
              pendingExitTargetRef.current = target;
              setPendingExitSats(Math.max(0, target - preExitSats));
              if (pendingExitClearTimerRef.current) {
                clearTimeout(pendingExitClearTimerRef.current);
              }
              pendingExitClearTimerRef.current = setTimeout(() => {
                pendingExitTargetRef.current = null;
                setPendingExitSats(null);
              }, 90_000);
            }
            clearOptimisticDepix();
            setDepixDisplay(null);
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
          // Baseline DePix after enter so the first poll is not a "receive".
          if (kind === "enter") {
            lastDepixRef.current = null;
          }
          return true;
        }
        await patchState({ pendingJob: null });
        Alert.alert("Conversion incomplete", "Your previous mode was kept.");
        return false;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[basic] fiat swap failed", e);
        await patchState({ pendingJob: null });
        Alert.alert("Conversion failed", msg);
        return false;
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
      refresh,
      refreshDepixBalance,
      clearOptimisticDepix,
      balanceSats,
      depixDisplay,
      btcBrl,
    ],
  );

  const confirmEnter = useCallback(async (): Promise<boolean> => {
    if (!walletId || selectedWallet?.kind !== "arkade") {
      Alert.alert("Fiat Mode", "Select an Arkade wallet first.");
      return false;
    }
    if (state?.fiatMode || converting) return false;
    if (!isFiatModeSwapAvailable(networkId)) {
      Alert.alert(
        "Fiat Mode unavailable",
        "No stable swap card is pinned for this network.",
      );
      return false;
    }
    const minBase = fiatMinBaseSats(networkId);
    const sats = balanceSats ?? 0;
    if (sats < minBase) {
      Alert.alert(
        "Not enough sats",
        `Need at least ${minBase.toLocaleString("en-US")} sats to enter Fiat Mode.`,
      );
      return false;
    }
    // Reserve dust so partial asset sends can fund the change output
    // (SDK needs ≈dust carrier on the payment + ≈dust on asset change).
    const reserve = DEFAULT_MIN_VTXO_SATS;
    const swapSats =
      sats - reserve >= minBase ? sats - reserve : sats;
    return runJob("enter", "btc-to-depix", BigInt(swapSats));
  }, [
    walletId,
    selectedWallet,
    state?.fiatMode,
    converting,
    balanceSats,
    runJob,
    networkId,
  ]);

  const confirmExit = useCallback(async (): Promise<boolean> => {
    if (!walletId || !state?.fiatMode || converting) return false;
    const display = depixDisplay ?? 0;
    if (!(display > 0)) {
      await patchState({ fiatMode: false, pendingJob: null });
      return true;
    }
    const atomic = depixDisplayToAtomic(display, networkId);
    return runJob("exit", "depix-to-btc", atomic);
  }, [walletId, state?.fiatMode, converting, depixDisplay, runJob, patchState, networkId]);

  const cancelConverting = useCallback(() => {
    // Cancel UI removed — keep no-op for API stability.
  }, []);

  const maybeAutoSwapInboundSats = useCallback(
    (sats: number) => {
      if (!state?.fiatMode || converting) return;
      const minBase = fiatMinBaseSats(networkId);
      if (!(sats >= minBase)) return;
      // Keep a dust reserve for later asset change when auto-swapping.
      const reserve = DEFAULT_MIN_VTXO_SATS;
      const swap = sats - reserve >= minBase ? sats - reserve : sats;
      void runJob("auto-inbound", "btc-to-depix", BigInt(Math.floor(swap)));
    },
    [state?.fiatMode, converting, runJob, networkId],
  );

  // Inbound sats while in Fiat Mode → auto-swap to designated stable.
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
    if (delta >= fiatMinBaseSats(networkId)) {
      maybeAutoSwapInboundSats(delta);
    }
  }, [balanceSats, state?.fiatMode, converting, maybeAutoSwapInboundSats, networkId]);

  const convertDepixToSatsForPay = useCallback(
    async (satsNeeded: number) => {
      if (!(satsNeeded > 0)) return;
      const display = depixDisplay ?? 0;
      if (!(display > 0)) {
        throw new Error(
          `No ${fiatStableForNetwork(networkId).displayCode} balance to convert`,
        );
      }
      const { depixDisplayToAtomic: toAtomic } = await import("./depixAssets");
      const atomic = toAtomic(display, networkId);
      await runJob("pay-convert", "depix-to-btc", atomic);
      void satsNeeded;
    },
    [depixDisplay, runJob, networkId],
  );

  // Clear "+ x sats pending" once live balance catches the exit target.
  useEffect(() => {
    const target = pendingExitTargetRef.current;
    if (target == null || balanceSats == null) return;
    if (balanceSats >= target - 2) {
      pendingExitTargetRef.current = null;
      setPendingExitSats(null);
      if (pendingExitClearTimerRef.current) {
        clearTimeout(pendingExitClearTimerRef.current);
        pendingExitClearTimerRef.current = null;
      }
      return;
    }
    // Still settling — refresh pending delta so the hint tracks.
    const pending = Math.max(0, target - balanceSats);
    setPendingExitSats(pending > 10 ? pending : null);
  }, [balanceSats]);

  useEffect(() => {
    return () => {
      if (pendingExitClearTimerRef.current) {
        clearTimeout(pendingExitClearTimerRef.current);
      }
    };
  }, []);

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

  useEffect(() => {
    registerFiatDepixOptimistic({
      spend: applyLocalDepixSpend,
      receive: applyLocalDepixReceive,
    });
    return () => registerFiatDepixOptimistic(null);
  }, [applyLocalDepixSpend, applyLocalDepixReceive]);

  // Track DePix balance for Home; do NOT toast from poll deltas.
  // BRL Funds Received comes only from notifyIncomingFunds (has vtxo txid).
  // Enter/exit swap fills are quieted via fiatModeGate.
  useEffect(() => {
    if (!fiatMode || converting) {
      if (!fiatMode) lastDepixRef.current = null;
      return;
    }
    if (depixDisplay == null) return;
    // Baseline only — never emit from here (avoids double notice + enter toast).
    if (lastDepixRef.current == null) {
      lastDepixRef.current = depixDisplay;
    } else {
      lastDepixRef.current = depixDisplay;
    }
  }, [fiatMode, converting, depixDisplay]);

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
      pendingExitSats: fiatMode ? null : pendingExitSats,
      feeBps: fiatFeeBps(networkId),
      minEnterSats: fiatMinBaseSats(networkId),
      confirmEnter,
      confirmExit,
      cancelConverting,
      refreshDepixBalance,
      applyLocalDepixSpend,
      applyLocalDepixReceive,
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
      pendingExitSats,
      confirmEnter,
      confirmExit,
      cancelConverting,
      refreshDepixBalance,
      applyLocalDepixSpend,
      applyLocalDepixReceive,
      maybeAutoSwapInboundSats,
      convertDepixToSatsForPay,
      networkId,
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
