/**
 * Wallet context — multi-wallet registry + selected Arkade engine.
 * Arkade behavior aligned with arkade.money; activity DB rematerializes on Activity open/pull.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { InteractionManager } from "react-native";
import { Ramps } from "@arkade-os/sdk";
import { materializeFromArkadeWallet, recordOptimisticArkadeReceive } from "../account/activityStore";
import { backfillMissingFiat } from "../account/fiatRate";
import {
  avatarLetter,
  ensurePersonalWallet,
  getSelectedWalletId,
  getWallet,
  insertWallet,
  listWallets,
  removeWallet,
  setSelectedWalletId,
  updateWalletLabel,
  type WalletRecord,
} from "../account/walletRegistry";
import { getNetworkConfig } from "../config/network";
import { DEFAULT_MIN_VTXO_SATS } from "./arkMultiSend";
import { isFiatModeActiveGate } from "../fiat/fiatModeGate";
import {
  depixAssetIdForNetwork,
  depixAtomicToDisplay,
  sumDesignatedAssetAtomic,
} from "../fiat/depixAssets";
import { queueEncryptedBackupSync } from "../nostr/backupSync";
import { storeNostrKeyPair } from "../nostr/identityStore";
import {
  fetchAndApplyLabelDirectory,
  publishLabelDirectory,
  queuePublishLabelDirectory,
} from "../nostr/labelDirectory";
import { queueContactsDirectoryBootSync, syncContactsDirectoryAfterPasskey } from "../contacts/contactsNostrSync";
import { mnemonicFromEntropy } from "../onboarding/mnemonicFromEntropy";
import { combineCsprngWithMotion } from "../onboarding/motionEntropy";
import { isPresencePromptInFlight } from "../security/presencePrompt";
import { friendlyNetworkError } from "../util/friendlyNetworkError";
import {
  allocatePasskeyChild,
  archivePasskeyChildByIndex,
  listActivePasskeyChildren,
  passkeyIndexFromMeta,
  readPasskeyChildIndexMap,
  renamePasskeyChildByIndex,
  restorePasskeyChildByIndex,
  writePasskeyChildIndexMap,
  type PasskeyChildEntry,
} from "../onboarding/passkeyChildIndexMap";
import {
  mnemonicFromPasskeyChildIndex,
  mnemonicFromPersonalRoot,
  normalizeWalletLabel,
  nostrPairFromPasskeyRoot,
  passkeyChildWalletIdByIndex,
  PERSONAL_WALLET_LABEL,
} from "../onboarding/passkeyChildWallets";
import { getExistingPrfEntropy } from "../onboarding/passkeyPrf";
import {
  deleteMnemonic,
  hasLegacyMnemonic,
  hasMnemonic,
  migrateLegacyMnemonicIfNeeded,
} from "../security/mnemonicStore";
import { markWarmupSeen, clearWarmupSeen } from "./warmupSeen";
import { balanceFromSdk, type BalanceBreakdown } from "./balance";
import { loadLndRestCredentials, clearLndRestIfWallet } from "../lightning/lndCredentials";
import { lndChannelBalance } from "../lightning/lndRest";
import type { LndRestConfig } from "../lightning/btcpayConfig";
import { loadLndHubCredentials, clearLndHubIfWallet } from "../lightning/lndhubCredentials";
import { lndhubGetBalance } from "../lightning/lndhub";
import { syncLightningHistory } from "../account/lightningActivity";
import { scheduleAutoPrepare } from "../exit/autoPrepare";
import { writeCachedArkAddress } from "./addressCache";
import {
  readCachedBalance,
  readLastAckBalance,
  writeCachedBalance,
  writeLastAckBalance,
  writeLastNotifiedActivityAt,
  writeZeroCachedBalance,
} from "./balanceCache";
import { getAccountDb } from "../account/accountDb";
import {
  clearOpenWallet,
  getOpenWallet,
  getOpenWalletMode,
  openHdWalletFromKeystore,
  runWalletRestore,
  consumeRestorePending,
  seedMnemonicOnly,
  type BasicWallet,
} from "./hdWallet";
import { setMnemonicSource, type MnemonicSource } from "./mnemonicMeta";

export type FundsNotice = {
  amount: number;
  kind: "boarding" | "arkade" | "lightning" | "brl";
  at: number;
};

export type BalanceStatus = "idle" | "loading" | "ready" | "error";
export type SessionPhase = "booting" | "warming" | "live";

type WalletContextValue = {
  ready: boolean;
  hasWallet: boolean;
  /**
   * booting: inventory not done.
   * warming: has wallet, Keystore/restore still settling (pre-Home gate).
   * live: Home shell may navigate freely.
   */
  sessionPhase: SessionPhase;
  /** Keystore open — UI may navigate; balance/addresses may still load. */
  walletInteractive: boolean;
  /** HD restore finished (or soft-failed); warmup may dismiss. */
  openRestoreDone: boolean;
  /** Call when pre-Home warmup finishes (or times out). */
  markSessionLive: () => void;
  wallets: WalletRecord[];
  selectedWallet: WalletRecord | null;
  wallet: BasicWallet | null;
  arkAddress: string | null;
  boardingAddress: string | null;
  boardingError: string | null;
  balanceSats: number | null;
  balance: BalanceBreakdown | null;
  balanceStatus: BalanceStatus;
  /** Session privacy mask for wallet balance (Home tap / Receive / Send). */
  balanceHidden: boolean;
  toggleBalanceHidden: () => void;
  activityEpoch: number;
  bumpActivity: () => void;
  fundsNotice: FundsNotice | null;
  clearFundsNotice: () => void;
  /** Emit Funds Received overlay (used by Fiat Mode for BRL fills). */
  notifyFundsReceived: (
    amount: number,
    kind: FundsNotice["kind"],
  ) => "shown" | "busy" | "blocked";
  /**
   * While Receive POS sheet is open, pause background balance polls so the
   * keypad stays responsive (boosted getBalance timeouts were starving taps).
   * Live payments still arrive via notifyIncomingFunds.
   */
  setPosUiHold: (on: boolean) => void;
  /**
   * While >0 (optional QR await), poll balance more often.
   * Prefer setPosUiHold while the keypad is open instead of boosting.
   */
  setIncomingWatchBoost: (on: boolean) => void;
  /**
   * Suppress FundsReceived after a local outbound (and for ~60s of catch-up).
   * Does not pause ASP balance polls — use begin/endOutboundSend for that.
   */
  noteLocalSend: () => void;
  /**
   * Pause background getBalance / reload traffic so wallet.send() is not
   * starved (official Arkade wallet has no parallel balance pollers during send).
   * Pair with endOutboundSend in finally.
   */
  beginOutboundSend: () => void;
  endOutboundSend: () => void;
  /** Optimistic UI after a successful outbound send (before live getBalance catches up). */
  applyLocalSpend: (amountSats: number) => void;
  refresh: () => Promise<void>;
  /** Cheap getBalance only — no activity materialize (Receive boarding poll). */
  refreshBalanceOnly: () => Promise<void>;
  /** Rematerialize activity_idx only (no balance). Safe for Activity pull-to-refresh. */
  refreshActivity: () => Promise<void>;
  ensureBoardingAddress: () => Promise<string>;
  rotateReceiveAddress: () => Promise<string>;
  rotateBoardingAddress: () => Promise<string>;
  settleBoarding: () => Promise<string>;
  provisionFromMnemonic: (mnemonic: string, source: MnemonicSource) => Promise<void>;
  /** Rematerialize Personal + active passkey children from PRF root entropy. */
  provisionFromPasskeyEntropy: (rootEntropy32: Uint8Array) => Promise<void>;
  /**
   * Suppress FundsReceived while HD restore / first balance settle after import.
   * Call before selectWallet / open after seed or Nostr package restore.
   */
  beginQuietImportSync: () => void;
  createExtraArkadeWallet: (
    label: string,
    opts?: { mode?: "passkey" | "csprng"; motionDigest32?: Uint8Array },
  ) => Promise<WalletRecord>;
  renameWallet: (walletId: string, label: string) => Promise<void>;
  removeWalletById: (walletId: string) => Promise<void>;
  /** Re-activate an archived passkey child by index (Settings → Archived wallets). */
  restoreArchivedPasskeyWallet: (index: number) => Promise<WalletRecord>;
  selectWallet: (walletId: string) => Promise<void>;
  refreshWalletList: () => void;
  bootstrapExisting: () => Promise<void>;
  /** After factoryResetWipeDevice — clear in-memory wallet state. */
  applyFactoryReset: () => Promise<void>;
  /**
   * Fiat Mode: single static receive address while on; restore HD on Exit.
   * Disposes and reopens the selected Arkade engine (same mnemonic / storage).
   */
  reopenWithWalletMode: (mode: "hd" | "static") => Promise<void>;
  avatarLabel: string;
};

const WalletContext = createContext<WalletContextValue | null>(null);

const RELOAD_DEBOUNCE_MS = 1_000;
/** After SDK notifyIncomingFunds — shorter so POS receives feel live. */
const RELOAD_URGENT_MS = 150;
/** Official SW VTXO/UTXO debounce — indexer catch-up before balance+activity reload. */
const RELOAD_EVENT_MS = 1_000;
/** Background balance poll when notifyIncomingFunds is unavailable. */
const BALANCE_POLL_MS = 4_000;
/** Idle poll when notify is subscribed (Expo safety net; official has no interval). */
const BALANCE_POLL_FALLBACK_MS = 30_000;
/** While Receive POS / QR is open — keep under ~0.5s so notices feel live. */
const BALANCE_POLL_BOOST_MS = 1000;

type InnerWallet = {
  getNewBoardingAddress?: () => Promise<string>;
};

/** ExpoWallet keeps the real SDK Wallet on `.wallet` — boarding rotate lives there. */
function sdkInner(w: BasicWallet): InnerWallet & BasicWallet {
  const anyW = w as BasicWallet & { wallet?: InnerWallet & BasicWallet };
  return (anyW.wallet ?? anyW) as InnerWallet & BasicWallet;
}

async function callGetNewBoardingAddress(w: BasicWallet): Promise<string | null> {
  const inner = sdkInner(w);
  if (typeof inner.getNewBoardingAddress !== "function") return null;
  try {
    return await withTimeout(inner.getNewBoardingAddress(), 12_000, "getNewBoardingAddress");
  } catch (e) {
    console.warn("[basic] getNewBoardingAddress failed", e);
    return null;
  }
}

/** Yield to UI; fall back after `ms` so cold-start sync still runs if idle. */
function afterInteractionsOrTimeout(ms: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const task = InteractionManager.runAfterInteractions(finish);
    setTimeout(() => {
      try {
        (task as { cancel?: () => void }).cancel?.();
      } catch {
        /* ignore */
      }
      finish();
    }, ms);
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function refreshBalanceFromSpendable(
  w: BasicWallet,
  prev?: BalanceBreakdown | null,
  timeoutMs = 3_000,
): Promise<BalanceBreakdown | null> {
  const anyW = w as BasicWallet & {
    getSpendableVtxos?: () => Promise<Array<{ value?: number }>>;
  };
  if (typeof anyW.getSpendableVtxos !== "function") return null;
  try {
    const spendable = await withTimeout(
      anyW.getSpendableVtxos(),
      timeoutMs,
      "getSpendableVtxos",
    );
    let available = 0;
    for (const v of spendable) available += Number(v.value ?? 0);
    const boarding = prev?.boarding ?? 0;
    return { total: available + boarding, available, boarding };
  } catch (e) {
    console.warn("[basic] spendable vtxos fast path failed", e);
    return null;
  }
}

async function refreshBalance(
  w: BasicWallet,
  prev?: BalanceBreakdown | null,
  opts?: { timeoutMs?: number; preferSpendable?: boolean },
): Promise<BalanceBreakdown> {
  const prevAvail = prev?.available ?? 0;
  const prevTotal = prev?.total ?? 0;
  const prevBoarding = prev?.boarding ?? 0;
  const timeoutMs = opts?.timeoutMs ?? 12_000;
  const boosted = !!opts?.preferSpendable;

  const isIncrease = (b: BalanceBreakdown) =>
    b.available > prevAvail || b.total > prevTotal || b.boarding > prevBoarding;

  if (boosted) {
    // POS: race spendable + getBalance in parallel. Sequential 1.5s+3s+3s
    // timeouts stacked under balanceInFlight and delayed notices by minutes.
    const spendableP = refreshBalanceFromSpendable(w, prev, 1_200);
    const balanceP = (async (): Promise<BalanceBreakdown | null> => {
      try {
        const raw = await withTimeout(w.getBalance(), Math.min(2_000, timeoutMs), "getBalance");
        return balanceFromSdk(raw, prev);
      } catch (e) {
        console.warn("[basic] getBalance failed (boost)", e);
        return null;
      }
    })();

    const increaseHit = await new Promise<BalanceBreakdown | null>((resolve) => {
      let settled = 0;
      let done = false;
      const finish = (b: BalanceBreakdown | null) => {
        if (done) return;
        settled += 1;
        if (b && isIncrease(b)) {
          done = true;
          resolve(b);
          return;
        }
        if (settled >= 2) {
          done = true;
          resolve(null);
        }
      };
      void spendableP.then(finish, () => finish(null));
      void balanceP.then(finish, () => finish(null));
    });
    if (increaseHit) {
      console.warn("[basic] boost balance increase", {
        total: increaseHit.total,
        available: increaseHit.available,
        prevTotal,
      });
      return increaseHit;
    }

    const [fast, fromBal] = await Promise.all([spendableP, balanceP]);
    if (fromBal) return fromBal;
    if (fast) return fast;
    if (prev) {
      console.warn("[basic] boost refresh failed; keeping previous", prev.total);
      return prev;
    }
    throw new Error("boost refresh failed");
  }

  try {
    const raw = await withTimeout(w.getBalance(), timeoutMs, "getBalance");
    const next = balanceFromSdk(raw, prev);
    const o = raw && typeof raw === "object" ? (raw as unknown as Record<string, unknown>) : null;
    if (
      o &&
      typeof o.total === "number" &&
      next.available > 0 &&
      o.total >= next.available * 2 - 2 &&
      next.boarding === 0
    ) {
      console.warn("[basic] balance sdk.total looks doubled; using available", {
        sdkTotal: o.total,
        available: o.available,
        settled: o.settled,
        preconfirmed: o.preconfirmed,
        hero: next.total,
      });
    }
    return next;
  } catch (e) {
    console.warn("[basic] getBalance failed, trying spendable vtxos", e);
    const fast = await refreshBalanceFromSpendable(w, prev, Math.min(3_000, timeoutMs));
    if (fast) return fast;
    // Never invent a zero snapshot — that poisons lastAck and the next live
    // pull looks like a full-wallet FundsReceived (seen after send timeouts).
    if (prev) {
      console.warn("[basic] getBalance failed; keeping previous", prev.total);
      return prev;
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
}

async function fetchLightningBalance(walletId: string): Promise<BalanceBreakdown> {
  const hub = await loadLndHubCredentials(walletId);
  if (hub) {
    const bal = await withTimeout(lndhubGetBalance(hub), 15_000, "lndhubBalance");
    const sats = bal.availableSats;
    return { total: sats, available: sats, boarding: 0 };
  }

  const creds = await loadLndRestCredentials(walletId);
  if (!creds) {
    throw new Error("Lightning node not connected");
  }
  const cfg: LndRestConfig = {
    restUrl: creds.restUrl,
    macaroonHex: creds.macaroonHex,
    certThumbprint: creds.certThumbprint,
    allowInsecure: creds.allowInsecure,
    source: creds.source,
  };
  const bal = await withTimeout(lndChannelBalance(cfg), 15_000, "lndChannelBalance");
  const sats = bal.localSats;
  return { total: sats, available: sats, boarding: 0 };
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [hasWallet, setHasWallet] = useState(false);
  /** Pre-Home warmup finished (or timed out / onboarding). */
  const [sessionLive, setSessionLive] = useState(false);
  /** Mirror of openRestoreDoneRef for React consumers (warmup gate). */
  const [openRestoreDone, setOpenRestoreDone] = useState(false);
  const [wallets, setWallets] = useState<WalletRecord[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<WalletRecord | null>(null);
  const [wallet, setWallet] = useState<BasicWallet | null>(null);
  const [arkAddress, setArkAddress] = useState<string | null>(null);
  const [boardingAddress, setBoardingAddress] = useState<string | null>(null);
  const [boardingError, setBoardingError] = useState<string | null>(null);
  const [balance, setBalance] = useState<BalanceBreakdown | null>(null);
  const [balanceStatus, setBalanceStatus] = useState<BalanceStatus>("idle");
  const [balanceHidden, setBalanceHidden] = useState(false);
  const toggleBalanceHidden = useCallback(() => {
    setBalanceHidden((v) => !v);
  }, []);
  const [activityEpoch, setActivityEpoch] = useState(0);
  const [fundsNotice, setFundsNotice] = useState<FundsNotice | null>(null);
  const suppressIncomingUntilRef = useRef(0);
  /** Total before local spend — used to detect stale pre-spend indexer reads. */
  const preSendTotalRef = useRef<number | null>(null);
  /** >0 while an outbound send holds the ASP — skip balance poll / reload. */
  const aspPollPausedRef = useRef(0);
  /** True during passkey/seed/Nostr rematerialize until post-restore balance is acked. */
  const quietImportSyncRef = useRef(false);
  /** True from openWallet until first post-open live balance is adopted. */
  const openSyncQuietRef = useRef(false);
  /** Set when restore+reload finished; together with quiet, gates first-live adopt. */
  const openRestoreDoneRef = useRef(false);
  const openSyncQuietGenRef = useRef(0);
  const openingRef = useRef(false);
  /** Single-flight Keystore open — ensureBoardingAddress awaits this instead of opening again. */
  const openInFlightRef = useRef<Promise<void> | null>(null);
  const openRetryCountRef = useRef(0);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Nested boosts from POS / Receive QR — poll balance more often while > 0. */
  const incomingWatchBoostRef = useRef(0);
  /** >0 while POS sheet open — skip balance polls (keypad must stay responsive). */
  const posUiHoldRef = useRef(0);
  const [incomingWatchBoostEpoch, setIncomingWatchBoostEpoch] = useState(0);
  /** True while notifyIncomingFunds returned an unsub — idle poll can be slow. */
  const [notifySubscribed, setNotifySubscribed] = useState(false);
  /** Serialize balance pulls — stacked getBalance timeouts were delaying notices. */
  const balanceInFlightRef = useRef(false);
  const balancePullAgainRef = useRef(false);
  const balanceBaselineReadyRef = useRef(false);
  /** Last balance the user has acknowledged for the selected wallet (catch-up). */
  const lastAckRef = useRef<BalanceBreakdown | null>(null);
  /** Extra balance polls after open so indexer catch-up can land. */
  const catchUpPollTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const noticeCooldownRef = useRef(0);
  const prevBoardingRef = useRef(0);
  const prevBalanceRef = useRef<BalanceBreakdown | null>(null);
  const boardingAddressRef = useRef<string | null>(null);
  /** Side ark address from "New receive address" until display catches up. */
  const forcedArkAddressRef = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const reloadWalletRef = useRef<(w: BasicWallet, walletId: string) => Promise<void>>(
    async () => {},
  );
  const refreshActivityRef = useRef<() => Promise<void>>(async () => {});

  const refreshWalletList = useCallback(() => {
    const networkId = getNetworkConfig().id;
    void (async () => {
      for (const w of listWallets(networkId)) {
        if (w.kind !== "arkade") continue;
        if (await hasMnemonic(w.id)) continue;
        removeWallet(networkId, w.id);
      }
      const all = listWallets(networkId);
      setWallets(all);
      const sel = selectedIdRef.current;
      if (sel && !all.some((w) => w.id === sel)) {
        const next =
          all.find((w) => w.kind === "arkade" && (w.tag === "main" || w.label === "Personal")) ??
          all.find((w) => w.kind === "arkade") ??
          all[0];
        if (next) {
          selectedIdRef.current = next.id;
          setSelectedWallet(next);
          setSelectedWalletId(networkId, next.id);
        } else {
          selectedIdRef.current = null;
          setSelectedWallet(null);
        }
      }
    })();
  }, []);

  const clearFundsNotice = useCallback(() => setFundsNotice(null), []);

  const markSessionLive = useCallback(() => {
    setSessionLive(true);
  }, []);

  const pullBalanceNowRef = useRef<() => void>(() => {});

  const setPosUiHold = useCallback((on: boolean) => {
    const next = on ? 1 : 0;
    if (posUiHoldRef.current === next) return;
    const prev = posUiHoldRef.current;
    posUiHoldRef.current = next;
    // Refs only — do not setState (re-renders starve the keypad).
    console.warn("[basic] posUiHold", { prev, next, on });
    if (next === 0) {
      pullBalanceNowRef.current();
    }
  }, []);

  const setIncomingWatchBoost = useCallback((on: boolean) => {
    const prev = incomingWatchBoostRef.current;
    const next = Math.max(0, prev + (on ? 1 : -1));
    if (next === prev) return;
    incomingWatchBoostRef.current = next;
    setIncomingWatchBoostEpoch((n) => n + 1);
    console.warn("[basic] incomingWatchBoost", { prev, next, on });
    if (on && next > 0 && posUiHoldRef.current === 0) {
      pullBalanceNowRef.current();
    }
  }, []);

  const noteLocalSend = useCallback(() => {
    if (preSendTotalRef.current == null && prevBalanceRef.current) {
      preSendTotalRef.current = prevBalanceRef.current.total;
    }
    suppressIncomingUntilRef.current = Date.now() + 60_000;
    setFundsNotice(null);
  }, []);

  const beginOutboundSend = useCallback(() => {
    noteLocalSend();
    aspPollPausedRef.current += 1;
    clearTimeout(reloadTimerRef.current);
    console.warn("[basic] aspPolls pause", { depth: aspPollPausedRef.current });
  }, [noteLocalSend]);

  const endOutboundSend = useCallback(() => {
    aspPollPausedRef.current = Math.max(0, aspPollPausedRef.current - 1);
    console.warn("[basic] aspPolls resume", { depth: aspPollPausedRef.current });
    // One catch-up pull after send so Home is not stuck on optimistic balance.
    if (aspPollPausedRef.current === 0) {
      pullBalanceNowRef.current();
    }
  }, []);

  const applyLocalSpend = useCallback((amountSats: number) => {
    const spend = Math.max(0, Math.floor(amountSats));
    if (!(spend > 0)) return;
    const networkId = getNetworkConfig().id;
    const walletId = selectedIdRef.current;
    setBalance((prev) => {
      if (!prev) return prev;
      if (preSendTotalRef.current == null) {
        preSendTotalRef.current = prev.total;
      }
      const available = Math.max(0, prev.available - spend);
      const next = {
        available,
        boarding: prev.boarding,
        total: available + prev.boarding,
      };
      prevBalanceRef.current = next;
      prevBoardingRef.current = next.boarding;
      lastAckRef.current = next;
      if (walletId) {
        void writeCachedBalance(networkId, walletId, next);
        void writeLastAckBalance(networkId, walletId, next);
      }
      console.warn("[basic] applyLocalSpend", {
        spend,
        total: next.total,
        preSend: preSendTotalRef.current,
      });
      return next;
    });
    setBalanceStatus("ready");
  }, []);

  const bumpActivity = useCallback(() => {
    setActivityEpoch((n) => n + 1);
  }, []);

  const syncReceiveAddresses = useCallback(async (w: BasicWallet) => {
    try {
      const addr = await withTimeout(w.getAddress(), 8_000, "getAddress");
      const forced = forcedArkAddressRef.current;
      let display: string;
      if (forced && forced !== addr) {
        setArkAddress(forced);
        display = forced;
      } else {
        forcedArkAddressRef.current = null;
        setArkAddress(addr);
        display = addr;
      }
      const wid = selectedIdRef.current;
      if (wid && display) {
        void writeCachedArkAddress(getNetworkConfig().id, wid, display);
      }
    } catch {
      /* keep previous */
    }
    try {
      const boarding = await withTimeout(w.getBoardingAddress(), 8_000, "getBoardingAddress");
      setBoardingAddress(boarding);
      boardingAddressRef.current = boarding;
      setBoardingError(null);
    } catch (e) {
      setBoardingError(friendlyNetworkError(e, "Could not load boarding address"));
    }
  }, []);

  /**
   * HD rotate-on-board: after boarding balance clears (client settle or ASP batch),
   * refresh display addresses. If boarding address did not advance (external batch),
   * force getNewBoardingAddress once.
   */
  const ensureBoardingRotatedAfterClear = useCallback(
    async (w: BasicWallet, prevBoardingSats: number, nextBoardingSats: number) => {
      if (!(prevBoardingSats > 0 && nextBoardingSats === 0)) {
        // POS/QR boost polls every ~500ms — skip address sync so keypad stays responsive.
        if (incomingWatchBoostRef.current > 0) return;
        await syncReceiveAddresses(w);
        return;
      }
      const before = boardingAddressRef.current;
      await syncReceiveAddresses(w);
      const after = boardingAddressRef.current;
      if (before && after && before === after) {
        const rotated = await callGetNewBoardingAddress(w);
        if (rotated) {
          setBoardingAddress(rotated);
          boardingAddressRef.current = rotated;
          setBoardingError(null);
        } else {
          await syncReceiveAddresses(w);
        }
      }
    },
    [syncReceiveAddresses],
  );

  const emitFundsNotice = useCallback((
    amount: number,
    kind: FundsNotice["kind"],
    opts?: { bypassSendSuppress?: boolean },
  ): "shown" | "busy" | "blocked" => {
    if (amount <= 0) return "busy";
    // Fiat Mode: DePix arrives on a 330-sat carrier VTXO — never toast that dust
    // as a sats receive (BRL notice is emitted from FiatModeProvider).
    if (
      kind === "arkade" &&
      isFiatModeActiveGate() &&
      amount <= DEFAULT_MIN_VTXO_SATS
    ) {
      console.warn("[basic] fundsNotice suppressed (fiat dust carrier)", amount);
      return "busy";
    }
    // Only while bio/PIN sheet is open — not AppLock grace (that ate POS notices).
    if (isPresencePromptInFlight()) {
      console.warn("[basic] fundsNotice suppressed (presence)", kind, amount);
      return "blocked";
    }
    // Post-send suppress blocks poll catch-up false positives — not SDK push receives.
    if (
      !opts?.bypassSendSuppress &&
      Date.now() < suppressIncomingUntilRef.current
    ) {
      return "busy";
    }
    if (Date.now() < noticeCooldownRef.current) return "busy";
    noticeCooldownRef.current = Date.now() + 4_000;
    console.warn("[basic] fundsNotice", kind, amount);
    setFundsNotice({ amount, kind, at: Date.now() });
    clearCatchUpPolls();
    return "shown";
  }, []);

  /** Public entry for Fiat Mode BRL receive toasts (and other callers). */
  const notifyFundsReceived = useCallback(
    (amount: number, kind: FundsNotice["kind"]) => emitFundsNotice(amount, kind),
    [emitFundsNotice],
  );

  /** Advance ack so persistBalance does not re-fire the same receive as FundsReceived. */
  const acknowledgeIncomingAmount = useCallback((amount: number) => {
    const add = Math.max(0, Math.floor(amount));
    if (!(add > 0)) return;
    const prev = lastAckRef.current ?? prevBalanceRef.current ?? {
      available: 0,
      boarding: 0,
      total: 0,
    };
    const next = {
      available: prev.available + add,
      boarding: prev.boarding,
      total: prev.total + add,
    };
    lastAckRef.current = next;
    // Notify is authoritative — do not keep post-send optimistic 0 while live ≈ preSend.
    preSendTotalRef.current = null;
    const walletId = selectedIdRef.current;
    if (walletId) {
      void writeLastAckBalance(getNetworkConfig().id, walletId, next);
    }
    console.warn("[basic] ack after notifyIncoming", {
      add,
      ackTotal: next.total,
    });
  }, []);

  /** Mirror applyLocalSpend for SDK push — Home updates with the notice, not after getBalance. */
  const applyLocalReceive = useCallback((amountSats: number) => {
    const add = Math.max(0, Math.floor(amountSats));
    if (!(add > 0)) return;
    const networkId = getNetworkConfig().id;
    const walletId = selectedIdRef.current;
    preSendTotalRef.current = null;
    setBalance((prev) => {
      const base = prev ?? { available: 0, boarding: 0, total: 0 };
      const next = {
        available: base.available + add,
        boarding: base.boarding,
        total: base.total + add,
      };
      prevBalanceRef.current = next;
      prevBoardingRef.current = next.boarding;
      if (walletId) {
        void writeCachedBalance(networkId, walletId, next);
      }
      console.warn("[basic] applyLocalReceive", { add, total: next.total });
      return next;
    });
    setBalanceStatus("ready");
  }, []);

  const beginQuietImportSync = useCallback(() => {
    quietImportSyncRef.current = true;
    balanceBaselineReadyRef.current = false;
    lastAckRef.current = null;
    prevBalanceRef.current = null;
    setFundsNotice(null);
    console.warn("[basic] quietImportSync on");
  }, []);

  const persistBalance = useCallback(
    async (walletId: string, bal: BalanceBreakdown) => {
      // Stale reload after switch: never poison that wallet's display cache / ack.
      if (selectedIdRef.current !== walletId) {
        return;
      }
      const networkId = getNetworkConfig().id;
      const suppressed = Date.now() < suppressIncomingUntilRef.current;
      const quiet = quietImportSyncRef.current || openSyncQuietRef.current;
      const ack = lastAckRef.current;

      // Same live numbers → skip setState / DB. POS keypad stays responsive under poll.
      // Still mark ready so Home leaves "syncing…" after a quiet open / POS hold skip.
      const displayed = prevBalanceRef.current;
      if (
        !quiet &&
        displayed &&
        displayed.total === bal.total &&
        displayed.available === bal.available &&
        displayed.boarding === bal.boarding &&
        ack &&
        ack.total === bal.total &&
        ack.available === bal.available &&
        ack.boarding === bal.boarding
      ) {
        setBalanceStatus("ready");
        return;
      }

      if (quiet) {
        // Open / import / rematerialize: adopt live balance as baseline, never FundsReceived
        // — except when opening a wallet that received while it was not selected
        // (cross-wallet send / background receive). Then fall through so catch-up notifies.
        if (bal.total === 0 && (ack?.total ?? 0) > 0) {
          console.warn("[basic] persistBalance quiet ignore empty live", {
            ackTotal: ack?.total,
          });
          setBalanceStatus("ready");
          return;
        }

        const catchUpSats =
          ack && bal.total > ack.total + 1 ? bal.total - ack.total : 0;
        const catchUpWhileAway =
          catchUpSats > 0 &&
          openSyncQuietRef.current &&
          !quietImportSyncRef.current;

        if (catchUpWhileAway) {
          openSyncQuietRef.current = false;
          console.warn("[basic] openSyncQuiet off (catch-up while away)", {
            catchUpSats,
            live: bal.total,
            ackTotal: ack?.total ?? null,
          });
          // Keep lastAck at the stored baseline; fall through to emit FundsReceived.
        } else {
          lastAckRef.current = bal;
          void writeLastAckBalance(networkId, walletId, bal);
          prevBoardingRef.current = bal.boarding;
          prevBalanceRef.current = bal;
          balanceBaselineReadyRef.current = true;
          setBalance(bal);
          setBalanceStatus("ready");
          await writeCachedBalance(networkId, walletId, bal);
          if (quietImportSyncRef.current && bal.total > 0) {
            quietImportSyncRef.current = false;
            console.warn("[basic] quietImportSync off (balance settled)", bal.total);
          }
          // End open quiet only after restore finished, or earlier if we already
          // have a positive live balance (cache miss → full wallet).
          if (openSyncQuietRef.current && (bal.total > 0 || openRestoreDoneRef.current)) {
            openSyncQuietRef.current = false;
            console.warn("[basic] openSyncQuiet off (first live)", {
              total: bal.total,
              restoreDone: openRestoreDoneRef.current,
            });
          }
          return;
        }
      }

      // Failed/empty live must not zero a positive ack — next real pull would
      // emit FundsReceived for the entire wallet (log: ack 2497 → 0 → notice 3832).
      if (bal.total === 0 && ack && ack.total > 0) {
        console.warn("[basic] persistBalance ignore empty live", {
          ackTotal: ack.total,
          suppressed,
        });
        setBalanceStatus("ready");
        return;
      }

      if (balanceBaselineReadyRef.current && ack) {
        const boardingDelta = bal.boarding - ack.boarding;
        const totalDelta = bal.total - ack.total;
        console.warn("[basic] persistBalance", {
          walletId: walletId.slice(0, 8),
          total: bal.total,
          ackTotal: ack.total,
          totalDelta,
          boardingDelta,
          suppressed,
        });
        if (!suppressed) {
          // Skip "baseline" jumps: UI already shows ~this balance (cache) but ack
          // was still 0 / stale — never treat full wallet as a fresh receive.
          const displayed = prevBalanceRef.current;
          const looksLikeBaselineSync =
            totalDelta > 0 &&
            bal.total > 0 &&
            totalDelta >= bal.total * 0.9 &&
            !!displayed &&
            displayed.total > 0 &&
            Math.abs(displayed.total - bal.total) <= Math.max(2, bal.total * 0.02);

          // ack still 0 after open/rematerialize while live balance is the whole
          // wallet that was *already* on screen (cache). Do NOT use this for a
          // real first receive into an empty wallet (displayed 0 → 50k).
          // Cold-start 0→full is covered by openSyncQuietRef instead.
          const looksLikeFullWalletCatchUp =
            totalDelta > 0 &&
            ack.total === 0 &&
            bal.total > 0 &&
            totalDelta >= bal.total * 0.9 &&
            !!displayed &&
            displayed.total > 0;

          if (looksLikeBaselineSync || looksLikeFullWalletCatchUp) {
            console.warn("[basic] persistBalance baseline sync (no notice)", {
              totalDelta,
              displayed: displayed?.total,
              live: bal.total,
              ackTotal: ack.total,
              fullCatchUp: looksLikeFullWalletCatchUp,
            });
          } else if (
            // Live total already matches what Home shows — ack was stale/0.
            // Common after Fiat Mode enter (330 carrier dust) and quiet-open races.
            !!displayed &&
            totalDelta > 0 &&
            Math.abs(displayed.total - bal.total) <= 2 &&
            Math.abs((displayed.available ?? 0) - bal.available) <= 2
          ) {
            console.warn("[basic] persistBalance skip notice (already on screen)", {
              totalDelta,
              displayed: displayed.total,
              live: bal.total,
              ackTotal: ack.total,
            });
          } else if (
            // Dust-only bump that equals min VTXO carrier (DePix leftover) while
            // UI already shows a near-zero sats balance — never toast as receive.
            totalDelta > 0 &&
            totalDelta <= DEFAULT_MIN_VTXO_SATS &&
            bal.total <= DEFAULT_MIN_VTXO_SATS &&
            !!displayed &&
            displayed.total <= DEFAULT_MIN_VTXO_SATS
          ) {
            console.warn("[basic] persistBalance skip dust delta", {
              totalDelta,
              live: bal.total,
              displayed: displayed.total,
            });
          } else if (boardingDelta > 0) {
            // Drop any UI-pinned ark receive so BIP21/Arkade pick up HD rotation.
            forcedArkAddressRef.current = null;
            if (emitFundsNotice(boardingDelta, "boarding") === "blocked") {
              // Presence ate the notice — keep ack so we retry next pull.
              setBalance(bal);
              setBalanceStatus("ready");
              await writeCachedBalance(networkId, walletId, bal);
              prevBoardingRef.current = bal.boarding;
              prevBalanceRef.current = bal;
              return;
            }
          } else if (totalDelta > 0) {
            // SDK ReceiveRotator advances on vtxo_received; clear pin so sync
            // (loadBalance → ensureBoardingRotatedAfterClear) shows the next addr.
            forcedArkAddressRef.current = null;
            if (emitFundsNotice(totalDelta, "arkade") === "blocked") {
              setBalance(bal);
              setBalanceStatus("ready");
              await writeCachedBalance(networkId, walletId, bal);
              prevBoardingRef.current = bal.boarding;
              prevBalanceRef.current = bal;
              return;
            }
          }
        }
      }

      // Never raise ack while send-suppress is active — that ate catch-up notices.
      if (!suppressed || !ack || bal.total <= ack.total) {
        lastAckRef.current = bal;
        void writeLastAckBalance(networkId, walletId, bal);
      }

      // After local send, indexer may still report the pre-spend total — do not
      // wipe the optimistic deduction. Exception: notify already advanced ack to
      // this live total (send-max then receive same amount → live === preSend).
      if (
        suppressed &&
        preSendTotalRef.current != null &&
        bal.total >= preSendTotalRef.current - 1
      ) {
        const ackMatchesLive =
          !!ack && Math.abs(bal.total - ack.total) <= 1 && bal.total > (displayed?.total ?? 0) + 1;
        if (!ackMatchesLive) {
          console.warn("[basic] persistBalance keep optimistic spend", {
            live: bal.total,
            preSend: preSendTotalRef.current,
            displayed: displayed?.total,
          });
          setBalanceStatus("ready");
          return;
        }
        console.warn("[basic] persistBalance adopt after notify ack", {
          live: bal.total,
          ackTotal: ack?.total,
          preSend: preSendTotalRef.current,
        });
      }

      if (!suppressed) {
        preSendTotalRef.current = null;
      } else if (preSendTotalRef.current != null) {
        preSendTotalRef.current = null;
      }

      prevBoardingRef.current = bal.boarding;
      prevBalanceRef.current = bal;
      balanceBaselineReadyRef.current = true;

      setBalance(bal);
      setBalanceStatus("ready");
      await writeCachedBalance(networkId, walletId, bal);
    },
    [emitFundsNotice],
  );

  function clearCatchUpPolls() {
    for (const t of catchUpPollTimersRef.current) clearTimeout(t);
    catchUpPollTimersRef.current = [];
  }

  function scheduleCatchUpPolls(w: BasicWallet, walletId: string) {
    clearCatchUpPolls();
    for (const delayMs of [1_500, 4_000, 10_000]) {
      const t = setTimeout(() => {
        if (selectedIdRef.current !== walletId) return;
        void loadBalance(w, walletId);
      }, delayMs);
      catchUpPollTimersRef.current.push(t);
    }
  }

  async function prepareWalletBaseline(
    networkId: ReturnType<typeof getNetworkConfig>["id"],
    walletId: string,
    cached: BalanceBreakdown,
  ) {
    const storedAck = await readLastAckBalance(networkId, walletId);
    // Zero ack + non-zero display cache: funds were already on screen (legacy
    // writeZero / first-run). Acknowledge cache so we never spam full-balance notice.
    let ack = storedAck ?? cached;
    if (ack.total === 0 && cached.total > 0) {
      ack = cached;
    }
    lastAckRef.current = ack;
    void writeLastAckBalance(networkId, walletId, ack);
    console.warn("[basic] prepareBaseline", {
      walletId: walletId.slice(0, 8),
      ackTotal: ack.total,
      cachedTotal: cached.total,
      hadStoredAck: !!storedAck,
    });
    prevBalanceRef.current = cached;
    prevBoardingRef.current = cached.boarding;
    balanceBaselineReadyRef.current = true;
  }

  const loadBalance = useCallback(
    async (w: BasicWallet, walletId: string) => {
      if (aspPollPausedRef.current > 0) {
        return null;
      }
      // POS keypad open — never start network balance work under the finger.
      if (posUiHoldRef.current > 0) {
        return null;
      }
      if (balanceInFlightRef.current) {
        balancePullAgainRef.current = true;
        return null;
      }
      balanceInFlightRef.current = true;
      setBalanceStatus((s) => (s === "ready" ? "ready" : "loading"));
      try {
        const prevBoarding = prevBoardingRef.current;
        const boosted = incomingWatchBoostRef.current > 0;
        const bal = await refreshBalance(w, prevBalanceRef.current, {
          // POS: race spendable + getBalance (see refreshBalance boosted path).
          preferSpendable: boosted,
          timeoutMs: boosted ? 2_000 : 12_000,
        });
        if (selectedIdRef.current !== walletId) return null;
        if (aspPollPausedRef.current > 0) return null;
        // POS opened mid-flight: still adopt the result so we don't stick on "syncing…".
        // Skip boarding rotate under the keypad (ensureBoardingRotatedAfterClear is heavier).
        if (posUiHoldRef.current > 0) {
          await persistBalance(walletId, bal);
          return bal;
        }
        await persistBalance(walletId, bal);
        await ensureBoardingRotatedAfterClear(w, prevBoarding, bal.boarding);
        return bal;
      } catch (e) {
        console.warn("[basic] loadBalance failed", e);
        setBalanceStatus("error");
        setBalance((prev) => prev ?? { total: 0, available: 0, boarding: 0 });
        return null;
      } finally {
        balanceInFlightRef.current = false;
        if (
          balancePullAgainRef.current &&
          aspPollPausedRef.current === 0 &&
          posUiHoldRef.current === 0
        ) {
          balancePullAgainRef.current = false;
          const id = selectedIdRef.current;
          if (id && walletId === id) {
            void loadBalance(w, walletId);
          }
        } else {
          balancePullAgainRef.current = false;
        }
      }
    },
    [persistBalance, ensureBoardingRotatedAfterClear],
  );

  pullBalanceNowRef.current = () => {
    if (aspPollPausedRef.current > 0) return;
    if (posUiHoldRef.current > 0) return;
    const w = wallet;
    const walletId = selectedIdRef.current;
    if (!w || !walletId || selectedWallet?.kind !== "arkade") return;
    void loadBalance(w, walletId);
  };

  /** Balance-only refresh. Activity rematerializes via refreshActivity / event reload. */
  const reloadWallet = useCallback(
    async (w: BasicWallet, walletId: string) => {
      if (selectedIdRef.current !== walletId) return;
      if (posUiHoldRef.current > 0) return;
      await loadBalance(w, walletId);
    },
    [loadBalance],
  );
  reloadWalletRef.current = reloadWallet;

  const scheduleReload = useCallback(
    (w: BasicWallet, walletId: string, opts?: { urgent?: boolean; event?: boolean }) => {
      if (aspPollPausedRef.current > 0) return;
      if (posUiHoldRef.current > 0) return;
      clearTimeout(reloadTimerRef.current);
      const ms = opts?.event
        ? RELOAD_EVENT_MS
        : opts?.urgent
          ? RELOAD_URGENT_MS
          : RELOAD_DEBOUNCE_MS;
      const isEvent = !!opts?.event;
      reloadTimerRef.current = setTimeout(() => {
        if (aspPollPausedRef.current > 0) return;
        if (posUiHoldRef.current > 0) return;
        // POS keypad / boost: balance only — never rematerialize under the finger.
        if (!isEvent && incomingWatchBoostRef.current > 0) {
          void loadBalance(w, walletId);
          return;
        }
        if (isEvent) {
          void (async () => {
            await loadBalance(w, walletId);
            if (selectedIdRef.current !== walletId) return;
            if (posUiHoldRef.current > 0) return;
            await refreshActivityRef.current();
          })();
          return;
        }
        void reloadWalletRef.current(w, walletId);
      }, ms);
    },
    [loadBalance],
  );

  const openWalletAndSync = useCallback(
    async (walletId: string) => {
      if (openingRef.current) return;
      openingRef.current = true;
      setBalanceStatus("loading");
      // Suppress FundsReceived until first live balance after restore settles.
      openSyncQuietRef.current = true;
      openRestoreDoneRef.current = false;
      setOpenRestoreDone(false);
      const quietGen = ++openSyncQuietGenRef.current;
      setTimeout(() => {
        if (openSyncQuietGenRef.current !== quietGen) return;
        if (!openSyncQuietRef.current) return;
        // Last resort: arm notices but treat the next full-wallet jump as baseline.
        openRestoreDoneRef.current = true;
        setOpenRestoreDone(true);
        console.warn("[basic] openSyncQuiet still on (timeout) — waiting first live");
      }, 45_000);
      // Keep cache baseline so catch-up can detect receives while away.
      // Only clear baseline when we have nothing to compare against.
      if (!prevBalanceRef.current) {
        balanceBaselineReadyRef.current = false;
      }

      const networkId = getNetworkConfig().id;
      // Show best-known balance immediately so Home is not stuck on 0 / loading
      // while Wallet.create + HD restore hit the network.
      try {
        const cached =
          (await readCachedBalance(networkId, walletId)) ?? {
            total: 0,
            available: 0,
            boarding: 0,
          };
        const storedAck = await readLastAckBalance(networkId, walletId);
        let baseline = cached;
        if (storedAck && storedAck.total > 0) {
          if (cached.total === 0) {
            // Cache miss / wiped — prefer ack so unlock does not flash 0.
            baseline = storedAck;
          } else if (
            cached.total >
            storedAck.total + Math.max(2, storedAck.total * 0.02)
          ) {
            // Inflated cache from raced writes — prefer ack.
            baseline = storedAck;
          }
        }
        if (!prevBalanceRef.current) {
          setBalance(baseline);
          await prepareWalletBaseline(networkId, walletId, baseline);
        }
      } catch {
        setBalance({ total: 0, available: 0, boarding: 0 });
      }

      const run = (async () => {
        try {
          const w = await openHdWalletFromKeystore(walletId, { runRestore: false });
          if (selectedIdRef.current !== walletId) {
            openingRef.current = false;
            return;
          }
          openRetryCountRef.current = 0;
          setWallet(w);
          setHasWallet(true);
          selectedIdRef.current = walletId;
          // Addresses + balance off the open critical path. Gap restore only when
          // this open follows create/import (pendingRestore), not every cold start.
          openingRef.current = false;
          void (async () => {
            if (selectedIdRef.current !== walletId) return;
            void syncReceiveAddresses(w);
            try {
              await afterInteractionsOrTimeout(800);
              if (selectedIdRef.current !== walletId) return;
              if (consumeRestorePending(walletId)) {
                await runWalletRestore(walletId, w);
                if (selectedIdRef.current !== walletId) return;
              }
              await reloadWallet(w, walletId);
              if (selectedIdRef.current !== walletId) return;
              if (quietImportSyncRef.current) {
                const bal = prevBalanceRef.current;
                if (bal && bal.total > 0) {
                  quietImportSyncRef.current = false;
                  console.warn("[basic] quietImportSync off (post-open)");
                } else {
                  // Empty or indexer lag: one more pull, then clear quiet so a later
                  // real receive (0 → N) can still notify.
                  await new Promise((r) => setTimeout(r, 2_500));
                  if (selectedIdRef.current !== walletId) return;
                  await reloadWallet(w, walletId);
                  quietImportSyncRef.current = false;
                  console.warn("[basic] quietImportSync off (post-retry)");
                }
              }
            } finally {
              openRestoreDoneRef.current = true;
              setOpenRestoreDone(true);
              // If a live balance already landed under quiet, clear now; otherwise
              // the next persistBalance (poll/reload) will clear after adopting.
              if (openSyncQuietRef.current && (lastAckRef.current?.total ?? 0) > 0) {
                openSyncQuietRef.current = false;
                console.warn("[basic] openSyncQuiet off (open settle done)", {
                  ackTotal: lastAckRef.current?.total ?? null,
                });
                // Cache/ack already on screen — leave syncing even if live reload was
                // skipped (POS hold) or persist early-returned.
                if (prevBalanceRef.current) setBalanceStatus("ready");
              } else {
                console.warn("[basic] open settle done, quiet awaits first live", {
                  ackTotal: lastAckRef.current?.total ?? null,
                });
              }
            }
            if (selectedIdRef.current !== walletId) return;
            scheduleCatchUpPolls(w, walletId);
            try {
              const mgr = await withTimeout(
                (
                  w as BasicWallet & {
                    getVtxoManager: () => Promise<{ renewVtxos: () => Promise<unknown> }>;
                  }
                ).getVtxoManager(),
                8_000,
                "getVtxoManager",
              );
              void mgr.renewVtxos().catch((e) => {
                const msg = e instanceof Error ? e.message : String(e);
                if (!/No VTXOs available to renew/i.test(msg)) {
                  console.warn("[basic] renewVtxos", e);
                }
              });
            } catch {
              /* optional */
            }
          })();
        } catch (e) {
          console.warn("[basic] openWalletAndSync failed", e);
          openSyncQuietRef.current = false;
          openRestoreDoneRef.current = true;
          setOpenRestoreDone(true);
          if (selectedIdRef.current === walletId) setBalanceStatus("error");
          openingRef.current = false;
        }
      })();

      openInFlightRef.current = run.finally(() => {
        if (openInFlightRef.current === run) openInFlightRef.current = null;
      });
      await openInFlightRef.current;
    },
    [reloadWallet, syncReceiveAddresses],
  );

  const selectWallet = useCallback(
    async (walletId: string) => {
      const networkId = getNetworkConfig().id;
      const record = listWallets(networkId).find((w) => w.id === walletId);
      if (!record) throw new Error("Wallet not found");

      const prevId = selectedIdRef.current;
      const prevBal = prevBalanceRef.current;
      if (prevId && prevId !== walletId) {
        if (prevBal) {
          void writeLastAckBalance(networkId, prevId, prevBal);
        }
        try {
          const maxRow = getAccountDb(networkId).getFirstSync<{ m: number | null }>(
            `SELECT MAX(created_at) AS m FROM activity_idx WHERE wallet_id = ? AND amount_sats > 0`,
            [prevId],
          );
          const at =
            typeof maxRow?.m === "number" && maxRow.m > 0 ? maxRow.m : Date.now();
          void writeLastNotifiedActivityAt(networkId, prevId, at);
          console.warn("[basic] leave activityAck", prevId.slice(0, 8), at);
        } catch {
          void writeLastNotifiedActivityAt(networkId, prevId, Date.now());
        }
      }

      openingRef.current = false;
      // Send-suppress is per active wallet session — never block catch-up on switch.
      suppressIncomingUntilRef.current = 0;
      preSendTotalRef.current = null;
      aspPollPausedRef.current = 0;
      aspPollPausedRef.current = 0;
      setSelectedWalletId(networkId, walletId);
      setSelectedWallet(record);
      selectedIdRef.current = walletId;
      // Keep switcher in sync after restore / create paths that insert outside setWallets.
      setWallets(listWallets(networkId));
      setHasWallet(true);
      setArkAddress(null);
      setBoardingAddress(null);
      boardingAddressRef.current = null;
      forcedArkAddressRef.current = null;
      setBoardingError(null);
      setBalance(null);
      setFundsNotice(null);
      balanceBaselineReadyRef.current = false;
      lastAckRef.current = null;
      clearCatchUpPolls();
      clearOpenWallet();
      setWallet(null);

      if (record.kind === "arkade") {
        const cached = await readCachedBalance(networkId, walletId);
        const baseline = cached ?? { total: 0, available: 0, boarding: 0 };
        setBalance(baseline);
        await prepareWalletBaseline(networkId, walletId, baseline);
        setBalanceStatus("loading");
        // Fire-and-forget open so switcher UI returns quickly.
        void openWalletAndSync(walletId);
      } else if (record.kind === "lightning") {
        setBalanceStatus("loading");
        setActivityEpoch((n) => n + 1);
        void (async () => {
          try {
            const bal = await fetchLightningBalance(walletId);
            if (selectedIdRef.current !== walletId) return;
            setBalance(bal);
            setBalanceStatus("ready");
            void writeCachedBalance(networkId, walletId, bal);
            try {
              await syncLightningHistory(networkId, walletId);
              if (selectedIdRef.current === walletId) {
                setActivityEpoch((n) => n + 1);
              }
            } catch (e) {
              console.warn("[basic] lightning history sync failed", e);
            }
          } catch (e) {
            console.warn("[basic] lightning balance failed", e);
            if (selectedIdRef.current !== walletId) return;
            setBalance({ total: 0, available: 0, boarding: 0 });
            setBalanceStatus("error");
          }
        })();
      } else {
        // Multisig: no engine yet.
        setBalanceStatus("idle");
        setActivityEpoch((n) => n + 1);
      }
    },
    [openWalletAndSync],
  );

  const ensureBoardingAddress = useCallback(async () => {
    const walletId = selectedIdRef.current;
    if (!walletId) {
      throw new Error("No selected wallet");
    }
    let w = getOpenWallet() ?? wallet;
    if (!w) {
      // Prefer the in-flight openWalletAndSync instead of a second Keystore open.
      if (openInFlightRef.current) {
        await openInFlightRef.current;
        w = getOpenWallet() ?? wallet;
      }
      if (!w) {
        w = await openHdWalletFromKeystore(walletId);
        setWallet(w);
        setHasWallet(true);
      }
    }
    try {
      const boarding = await withTimeout(w.getBoardingAddress(), 8_000, "getBoardingAddress");
      if (!boarding) throw new Error("Empty boarding address");
      setBoardingAddress(boarding);
      boardingAddressRef.current = boarding;
      setBoardingError(null);
      setWallet(w);
      return boarding;
    } catch (e) {
      const msg = friendlyNetworkError(e, "Could not load boarding address");
      setBoardingError(msg);
      throw new Error(msg);
    }
  }, [wallet]);

  const settleBoarding = useCallback(async () => {
    const walletId = selectedIdRef.current;
    if (!walletId) throw new Error("No selected wallet");
    let w = getOpenWallet() ?? wallet;
    if (!w) {
      w = await openHdWalletFromKeystore(walletId);
      setWallet(w);
      setHasWallet(true);
    }
    const anyW = w as BasicWallet & {
      arkProvider?: { getInfo: () => Promise<{ fees: Parameters<Ramps["onboard"]>[0] }> };
    };
    if (!anyW.arkProvider?.getInfo) {
      throw new Error("Ark provider unavailable");
    }
    const info = await withTimeout(anyW.arkProvider.getInfo(), 12_000, "getInfo");
    const txid = await withTimeout(new Ramps(w).onboard(info.fees), 120_000, "Ramps.onboard");
    await reloadWallet(w, walletId);
    return String(txid);
  }, [wallet, reloadWallet]);

  const refresh = useCallback(async () => {
    const walletId = selectedIdRef.current;
    if (!walletId) return;

    if (selectedWallet?.kind === "lightning") {
      setBalanceStatus("loading");
      try {
        const bal = await fetchLightningBalance(walletId);
        if (selectedIdRef.current !== walletId) return;
        setBalance(bal);
        setBalanceStatus("ready");
        void writeCachedBalance(getNetworkConfig().id, walletId, bal);
        try {
          const n = await syncLightningHistory(getNetworkConfig().id, walletId);
          if (n > 0) setActivityEpoch((e) => e + 1);
        } catch (e) {
          console.warn("[basic] lightning history sync failed", e);
        }
      } catch (e) {
        console.warn("[basic] lightning refresh failed", e);
        if (selectedIdRef.current !== walletId) return;
        setBalanceStatus("error");
      }
      return;
    }

    if (selectedWallet?.kind !== "arkade") return;
    let w = getOpenWallet() ?? wallet;
    if (!w) {
      if (openingRef.current) return;
      openRetryCountRef.current = 0;
      await openWalletAndSync(walletId);
      w = getOpenWallet();
      if (!w) return;
    }
    setWallet(w);
    await reloadWallet(w, walletId);
  }, [wallet, selectedWallet, reloadWallet, openWalletAndSync]);

  /** getBalance only — Receive boarding poll must not rematerialize activity. */
  const refreshBalanceOnly = useCallback(async () => {
    const walletId = selectedIdRef.current;
    if (!walletId) return;
    if (selectedWallet?.kind === "lightning") {
      try {
        const bal = await fetchLightningBalance(walletId);
        if (selectedIdRef.current !== walletId) return;
        setBalance(bal);
        setBalanceStatus("ready");
        void writeCachedBalance(getNetworkConfig().id, walletId, bal);
      } catch (e) {
        console.warn("[basic] lightning balance-only failed", e);
      }
      return;
    }
    if (selectedWallet?.kind !== "arkade") return;
    if (openInFlightRef.current) {
      await openInFlightRef.current;
    }
    const w = getOpenWallet() ?? wallet;
    if (!w) return;
    await loadBalance(w, walletId);
  }, [wallet, selectedWallet, loadBalance]);

  /** Activity pull-to-refresh: history only — never block on getBalance. */
  const refreshActivity = useCallback(async () => {
    const walletId = selectedIdRef.current;
    if (!walletId) return;
    const networkId = getNetworkConfig().id;

    if (selectedWallet?.kind === "lightning") {
      try {
        await withTimeout(
          syncLightningHistory(networkId, walletId),
          12_000,
          "syncLightningHistory",
        );
      } catch (e) {
        console.warn("[basic] activity ln refresh failed", e);
      }
      setActivityEpoch((e) => e + 1);
      return;
    }

    if (selectedWallet?.kind !== "arkade") return;
    const w = getOpenWallet() ?? wallet;
    if (!w) return;
    try {
      await withTimeout(
        materializeFromArkadeWallet(networkId, walletId, w),
        12_000,
        "materializeFromArkadeWallet",
      );
      void backfillMissingFiat(networkId);
    } catch (e) {
      console.warn("[basic] activity rematerialize failed", e);
    }
    if (selectedIdRef.current === walletId) {
      setActivityEpoch((n) => n + 1);
    }
  }, [wallet, selectedWallet]);
  refreshActivityRef.current = refreshActivity;

  const rotateReceiveAddress = useCallback(async () => {
    const walletId = selectedIdRef.current;
    if (!walletId) throw new Error("No selected wallet");
    let w = getOpenWallet() ?? wallet;
    if (!w) {
      w = await openHdWalletFromKeystore(walletId);
      setWallet(w);
      setHasWallet(true);
    }
    // Mint a fresh HD index (side address). Display rotator advances on payment;
    // keep this address pinned in UI until getAddress catches up.
    const minted = await w.getNewAddresses({ types: ["default"], forceNew: true });
    const next = minted[0]?.address;
    if (!next) throw new Error("No address returned");
    forcedArkAddressRef.current = next;
    setArkAddress(next);
    void writeCachedArkAddress(getNetworkConfig().id, walletId, next);
    setWallet(w);
    return next;
  }, [wallet]);

  const rotateBoardingAddress = useCallback(async () => {
    const walletId = selectedIdRef.current;
    if (!walletId) throw new Error("No selected wallet");
    let w = getOpenWallet() ?? wallet;
    if (!w) {
      w = await openHdWalletFromKeystore(walletId);
      setWallet(w);
      setHasWallet(true);
    }
    const next = await callGetNewBoardingAddress(w);
    if (!next) throw new Error("Could not rotate boarding address");
    setBoardingAddress(next);
    boardingAddressRef.current = next;
    setBoardingError(null);
    setWallet(w);
    return next;
  }, [wallet]);

  const bootstrapExisting = useCallback(async () => {
    const networkId = getNetworkConfig().id;

    // Drop seedless arkade shells (e.g. ensurePersonalWallet after factory reset).
    for (const w of listWallets(networkId)) {
      if (w.kind !== "arkade") continue;
      if (await hasMnemonic(w.id)) continue;
      removeWallet(networkId, w.id);
    }

    let all = listWallets(networkId);
    if (all.length === 0 && (await hasLegacyMnemonic())) {
      const personal = ensurePersonalWallet(networkId);
      await migrateLegacyMnemonicIfNeeded(personal.id);
      all = listWallets(networkId);
    }

    if (all.length === 0) {
      setWallets([]);
      setSelectedWallet(null);
      selectedIdRef.current = null;
      setHasWallet(false);
      clearOpenWallet();
      setWallet(null);
      setArkAddress(null);
      setBoardingAddress(null);
      setBoardingError(null);
      setBalance(null);
      setBalanceStatus("idle");
      balanceBaselineReadyRef.current = false;
      setReady(true);
      return;
    }

    const personal =
      all.find((w) => w.kind === "arkade" && (w.tag === "main" || w.label === "Personal")) ??
      all[0]!;
    await migrateLegacyMnemonicIfNeeded(personal.id);
    all = listWallets(networkId);
    setWallets(all);

    const selectedId = getSelectedWalletId(networkId) ?? personal.id;
    let selected = all.find((w) => w.id === selectedId) ?? personal;
    if (selected.kind === "arkade" && !(await hasMnemonic(selected.id))) {
      for (const w of all) {
        if (w.kind === "arkade" && (await hasMnemonic(w.id))) {
          selected = w;
          break;
        }
      }
    }
    setSelectedWallet(selected);
    selectedIdRef.current = selected.id;
    setSelectedWalletId(networkId, selected.id);

    const arkadeIds = all.filter((w) => w.kind === "arkade").map((w) => w.id);
    let arkadePresent = false;
    for (const id of arkadeIds) {
      if (await hasMnemonic(id)) {
        arkadePresent = true;
        break;
      }
    }
    if (!arkadePresent) arkadePresent = await hasLegacyMnemonic();

    let lightningPresent = false;
    for (const w of all) {
      if (w.kind !== "lightning") continue;
      if (await loadLndHubCredentials(w.id)) {
        lightningPresent = true;
        break;
      }
      if (await loadLndRestCredentials(w.id)) {
        lightningPresent = true;
        break;
      }
    }

    const present = arkadePresent || lightningPresent;
    setHasWallet(present);
    // Existing wallet ⇒ returning user (Welcome back). Await so the flag is
    // durable before ready flips and WalletWarmupScreen reads it.
    if (present) await markWarmupSeen();

    if (present && selected.kind === "arkade") {
      const cached = await readCachedBalance(networkId, selected.id, {
        allowLegacyMigrate: selected.tag === "main" || selected.label === "Personal",
      });
      const baseline = cached ?? { total: 0, available: 0, boarding: 0 };
      setBalance(baseline);
      await prepareWalletBaseline(networkId, selected.id, baseline);
      setBalanceStatus("loading");
    } else if (present && selected.kind === "lightning") {
      const cached = await readCachedBalance(networkId, selected.id);
      if (cached) setBalance(cached);
      setBalanceStatus("loading");
    }
    setReady(true);

    if (!present) {
      clearOpenWallet();
      setWallet(null);
      setArkAddress(null);
      setBoardingAddress(null);
      setBoardingError(null);
      setBalance(null);
      setBalanceStatus("idle");
      balanceBaselineReadyRef.current = false;
      return;
    }

    if (selected.kind === "arkade") {
      void openWalletAndSync(selected.id);
    } else if (selected.kind === "lightning") {
      const walletId = selected.id;
      void (async () => {
        try {
          const bal = await fetchLightningBalance(walletId);
          if (selectedIdRef.current !== walletId) return;
          setBalance(bal);
          setBalanceStatus("ready");
          void writeCachedBalance(networkId, walletId, bal);
          try {
            await syncLightningHistory(networkId, walletId);
            if (selectedIdRef.current === walletId) {
              setActivityEpoch((n) => n + 1);
            }
          } catch (e) {
            console.warn("[basic] lightning history sync failed", e);
          }
        } catch (e) {
          console.warn("[basic] lightning balance failed", e);
          if (selectedIdRef.current !== walletId) return;
          setBalance({ total: 0, available: 0, boarding: 0 });
          setBalanceStatus("error");
        }
      })();
    }
  }, [openWalletAndSync]);

  const provisionFromMnemonic = useCallback(
    async (mnemonic: string, source: MnemonicSource) => {
      await setMnemonicSource(source);
      const networkId = getNetworkConfig().id;
      const personal = ensurePersonalWallet(networkId);
      beginQuietImportSync();
      await seedMnemonicOnly(personal.id, mnemonic);
      await writeZeroCachedBalance(networkId, personal.id);
      setSelectedWalletId(networkId, personal.id);
      setSelectedWallet(personal);
      selectedIdRef.current = personal.id;
      setWallets(listWallets(networkId));
      setHasWallet(true);
      setWallet(null);
      setArkAddress(null);
      setBoardingAddress(null);
      setBoardingError(null);
      const zero = { total: 0, available: 0, boarding: 0 };
      setBalance(zero);
      await prepareWalletBaseline(networkId, personal.id, zero);
      setBalanceStatus("loading");
      void openWalletAndSync(personal.id);
    },
    [beginQuietImportSync, openWalletAndSync],
  );

  const seedPasskeyChildEntry = useCallback(
    async (rootEntropy32: Uint8Array, entry: PasskeyChildEntry) => {
      const networkId = getNetworkConfig().id;
      const id = passkeyChildWalletIdByIndex(entry.index);
      const existing = getWallet(networkId, id);
      if (!existing) {
        insertWallet(networkId, {
          id,
          kind: "arkade",
          label: entry.label,
          tag: "passkey",
          meta: { derivedFrom: "passkey-index", passkeyIndex: entry.index },
        });
      } else if (existing.label !== entry.label) {
        updateWalletLabel(networkId, id, entry.label);
      }
      await seedMnemonicOnly(id, mnemonicFromPasskeyChildIndex(rootEntropy32, entry.index));
    },
    [],
  );

  const provisionFromPasskeyEntropy = useCallback(
    async (rootEntropy32: Uint8Array) => {
      await setMnemonicSource("passkey-prf");
      const networkId = getNetworkConfig().id;
      const personal = ensurePersonalWallet(networkId);
      beginQuietImportSync();

      // Deterministic Nostr identity from the same PRF root (before label / contacts fetch).
      await storeNostrKeyPair(nostrPairFromPasskeyRoot(rootEntropy32));

      // Seed Keystore only — Wallet.create / restore / balance stay off the Terms spinner.
      await seedMnemonicOnly(personal.id, mnemonicFromPersonalRoot(rootEntropy32));

      let directoryOk = false;
      try {
        const fetched = await fetchAndApplyLabelDirectory();
        directoryOk = fetched !== null;
      } catch (e) {
        console.warn("[basic] label directory fetch failed", e);
      }

      // Contacts use the same derived nsec (kind 30078). Must run after storeNostrKeyPair;
      // boot sync alone is not enough (it may have skipped before identity existed).
      try {
        await syncContactsDirectoryAfterPasskey();
      } catch (e) {
        console.warn("[basic] contacts directory after passkey", e);
      }

      let actives = await listActivePasskeyChildren();

      // Fallback when relays unreachable and local map empty: probe low indices for funds.
      if (!directoryOk && actives.length === 0) {
        const discovered: PasskeyChildEntry[] = [];
        let emptyStreak = 0;
        const maxProbe = 8;
        const gapLimit = 3;
        for (let i = 0; i < maxProbe && emptyStreak < gapLimit; i++) {
          try {
            const mnemonic = mnemonicFromPasskeyChildIndex(rootEntropy32, i);
            const probeId = `w_pk_probe_${i}`;
            await seedMnemonicOnly(probeId, mnemonic);
            const w = await openHdWalletFromKeystore(probeId);
            let total = 0;
            try {
              const b = await w.getBalance();
              total = balanceFromSdk(b).total;
            } finally {
              clearOpenWallet();
              try {
                await deleteMnemonic(probeId);
              } catch {
                /* ignore */
              }
            }
            if (total > 0) {
              emptyStreak = 0;
              discovered.push({
                index: i,
                label: `Wallet ${i + 1}`,
                status: "active",
              });
            } else {
              emptyStreak += 1;
            }
          } catch {
            emptyStreak += 1;
          }
        }
        if (discovered.length) {
          const map = await readPasskeyChildIndexMap();
          const maxIdx = discovered.reduce((m, e) => Math.max(m, e.index), -1);
          await writePasskeyChildIndexMap({
            version: 1,
            nextIndex: Math.max(map.nextIndex, maxIdx + 1),
            entries: [
              ...map.entries.filter((e) => e.status === "archived"),
              ...discovered,
            ],
          });
          actives = discovered;
        }
      }

      for (const entry of actives) {
        await seedPasskeyChildEntry(rootEntropy32, entry);
      }

      // Drop registry shells for archived indices if a prior scan resurrected them.
      const mapAfter = await readPasskeyChildIndexMap();
      for (const entry of mapAfter.entries) {
        if (entry.status !== "archived") continue;
        const id = passkeyChildWalletIdByIndex(entry.index);
        if (!getWallet(networkId, id)) continue;
        try {
          await deleteMnemonic(id);
        } catch {
          /* ignore */
        }
        removeWallet(networkId, id);
      }

      await writeZeroCachedBalance(networkId, personal.id);
      setSelectedWalletId(networkId, personal.id);
      setSelectedWallet(personal);
      selectedIdRef.current = personal.id;
      setWallets(listWallets(networkId));
      setHasWallet(true);
      setWallet(null);
      setArkAddress(null);
      setBoardingAddress(null);
      setBoardingError(null);
      const zero = { total: 0, available: 0, boarding: 0 };
      setBalance(zero);
      await prepareWalletBaseline(networkId, personal.id, zero);
      setBalanceStatus("loading");

      void openWalletAndSync(personal.id);
      queuePublishLabelDirectory("provision");
    },
    [beginQuietImportSync, openWalletAndSync, seedPasskeyChildEntry],
  );

  const createExtraArkadeWallet = useCallback(
    async (
      label: string,
      opts?: { mode?: "passkey" | "csprng"; motionDigest32?: Uint8Array },
    ) => {
      const networkId = getNetworkConfig().id;
      const mode = opts?.mode ?? "csprng";
      const name = normalizeWalletLabel(label) || "Savings";
      if (name.toLowerCase() === PERSONAL_WALLET_LABEL.toLowerCase()) {
        throw new Error("Label “Personal” is reserved for the primary wallet");
      }

      let created: WalletRecord;

      if (mode === "passkey") {
        const root = await getExistingPrfEntropy();
        const entry = await allocatePasskeyChild(name);
        const id = passkeyChildWalletIdByIndex(entry.index);
        if (getWallet(networkId, id) || (await hasMnemonic(id))) {
          throw new Error("A passkey wallet with this index already exists");
        }
        insertWallet(networkId, {
          id,
          kind: "arkade",
          label: entry.label,
          tag: "passkey",
          meta: { derivedFrom: "passkey-index", passkeyIndex: entry.index },
        });
        const mnemonic = mnemonicFromPasskeyChildIndex(root, entry.index);
        // Keystore only — Wallet.create + restore run once via selectWallet (background).
        await seedMnemonicOnly(id, mnemonic);
        await writeZeroCachedBalance(networkId, id);
        await setMnemonicSource("passkey-prf");
        // Ensure nsec matches passkey (first child create if identity was random).
        await storeNostrKeyPair(nostrPairFromPasskeyRoot(root));
        try {
          await publishLabelDirectory();
        } catch (e) {
          console.warn("[basic] label directory publish after create failed", e);
        }
        setWallets(listWallets(networkId));
        await selectWallet(id);
        created = getWallet(networkId, id)!;
      } else {
        const motion = opts?.motionDigest32;
        if (!motion || motion.length !== 32) {
          throw new Error("Motion entropy required to create a device wallet");
        }
        // CSPRNG anchors the seed; motion digest is mixed in (never replaces CSPRNG).
        const entropy = await combineCsprngWithMotion(motion);
        const record = insertWallet(networkId, {
          kind: "arkade",
          label: name,
          tag: null,
          meta: { derivedFrom: "csprng+motion" },
        });
        const mnemonic = mnemonicFromEntropy(entropy);
        await seedMnemonicOnly(record.id, mnemonic);
        await writeZeroCachedBalance(networkId, record.id);
        setWallets(listWallets(networkId));
        await selectWallet(record.id);
        created = record;
      }

      // Don't block Add Wallet UI on relay RTT — same pattern as rename/remove.
      queueEncryptedBackupSync(`create-wallet:${created.label}`);
      return created;
    },
    [selectWallet],
  );

  const renameWallet = useCallback(async (walletId: string, label: string) => {
    const networkId = getNetworkConfig().id;
    const record = getWallet(networkId, walletId);
    if (!record) throw new Error("Wallet not found");
    const name = normalizeWalletLabel(label);
    if (!name) throw new Error("Name required");
    if (
      name.toLowerCase() === PERSONAL_WALLET_LABEL.toLowerCase() &&
      record.tag !== "main" &&
      record.label.toLowerCase() !== PERSONAL_WALLET_LABEL.toLowerCase()
    ) {
      throw new Error("Label “Personal” is reserved");
    }
    updateWalletLabel(networkId, walletId, name);
    const idx = passkeyIndexFromMeta(record.meta);
    if (
      idx !== null &&
      (record.meta?.derivedFrom === "passkey-index" || record.tag === "passkey")
    ) {
      await renamePasskeyChildByIndex(idx, name);
      queuePublishLabelDirectory(`rename:${idx}`);
    }
    setWallets(listWallets(networkId));
    if (selectedIdRef.current === walletId) {
      const next = getWallet(networkId, walletId);
      if (next) setSelectedWallet(next);
    }
    queueEncryptedBackupSync(`rename-wallet:${walletId.slice(0, 8)}`);
  }, []);

  const removeWalletById = useCallback(
    async (walletId: string) => {
      const networkId = getNetworkConfig().id;
      const record = getWallet(networkId, walletId);
      if (!record) throw new Error("Wallet not found");

      const arkade = listWallets(networkId).filter((w) => w.kind === "arkade");
      if (record.kind === "arkade" && arkade.length <= 1) {
        throw new Error("Cannot remove the last Arkade wallet — use Reset app instead");
      }

      const passkeyIndex = passkeyIndexFromMeta(record.meta);
      const isPasskeyChild =
        record.kind === "arkade" &&
        passkeyIndex !== null &&
        (record.meta?.derivedFrom === "passkey-index" || record.tag === "passkey");

      if (record.kind === "arkade") {
        try {
          await deleteMnemonic(walletId);
        } catch {
          /* missing ok */
        }
        if (isPasskeyChild && passkeyIndex !== null) {
          await archivePasskeyChildByIndex(passkeyIndex);
          try {
            await publishLabelDirectory();
          } catch (e) {
            console.warn("[basic] label directory publish after archive failed", e);
          }
        }
      }

      if (record.kind === "lightning") {
        await clearLndHubIfWallet(walletId);
        await clearLndRestIfWallet(walletId);
      }

      const wasSelected = selectedIdRef.current === walletId;
      if (wasSelected) {
        clearCatchUpPolls();
        clearOpenWallet();
        selectedIdRef.current = null;
        setWallet(null);
        setArkAddress(null);
        setBoardingAddress(null);
        setBalance(null);
        setBalanceStatus("idle");
        setFundsNotice(null);
      }

      removeWallet(networkId, walletId);
      const remaining = listWallets(networkId);
      setWallets(remaining);
      queueEncryptedBackupSync(`remove-wallet:${walletId.slice(0, 8)}`);

      if (wasSelected) {
        const next =
          remaining.find((w) => w.kind === "arkade" && (w.tag === "main" || w.label === "Personal")) ??
          remaining.find((w) => w.kind === "arkade") ??
          remaining[0];
        if (next) {
          await selectWallet(next.id);
        } else {
          setSelectedWallet(null);
          setHasWallet(false);
        }
      }
    },
    [selectWallet],
  );

  const restoreArchivedPasskeyWallet = useCallback(
    async (index: number) => {
      const root = await getExistingPrfEntropy();
      const entry = await restorePasskeyChildByIndex(index);
      await seedPasskeyChildEntry(root, entry);
      const networkId = getNetworkConfig().id;
      const id = passkeyChildWalletIdByIndex(entry.index);
      await writeZeroCachedBalance(networkId, id);
      try {
        await publishLabelDirectory();
      } catch (e) {
        console.warn("[basic] label directory publish after restore failed", e);
      }
      setWallets(listWallets(networkId));
      queueEncryptedBackupSync(`restore-archived:${index}`);
      await selectWallet(id);
      return getWallet(networkId, id)!;
    },
    [seedPasskeyChildEntry, selectWallet],
  );

  const applyFactoryReset = useCallback(async () => {
    clearCatchUpPolls();
    clearOpenWallet();
    selectedIdRef.current = null;
    lastAckRef.current = null;
    prevBalanceRef.current = null;
    prevBoardingRef.current = 0;
    balanceBaselineReadyRef.current = false;
    quietImportSyncRef.current = false;
    forcedArkAddressRef.current = null;
    setWallet(null);
    setSelectedWallet(null);
    setWallets([]);
    setHasWallet(false);
    setArkAddress(null);
    setBoardingAddress(null);
    setBoardingError(null);
    setBalance(null);
    setBalanceStatus("idle");
    setFundsNotice(null);
    setActivityEpoch((n) => n + 1);
    setSessionLive(false);
    setOpenRestoreDone(false);
    openRestoreDoneRef.current = false;
    await clearWarmupSeen();
  }, []);

  const reopenWithWalletMode = useCallback(
    async (mode: "hd" | "static") => {
      const walletId = selectedIdRef.current;
      if (!walletId) return;
      if (getOpenWalletMode() === mode && getOpenWallet()) {
        return;
      }
      console.warn("[basic] reopenWithWalletMode", mode);
      openSyncQuietRef.current = true;
      suppressIncomingUntilRef.current = Date.now() + 15_000;
      try {
        clearOpenWallet();
        setWallet(null);
        const w = await openHdWalletFromKeystore(walletId, {
          runRestore: mode === "hd",
          walletMode: mode,
        });
        if (selectedIdRef.current !== walletId) {
          clearOpenWallet();
          return;
        }
        setWallet(w);
        await syncReceiveAddresses(w);
        await reloadWallet(w, walletId);
      } catch (e) {
        console.warn("[basic] reopenWithWalletMode failed", e);
      } finally {
        openSyncQuietRef.current = false;
      }
    },
    [reloadWallet, syncReceiveAddresses],
  );

  useEffect(() => {
    void bootstrapExisting();
  }, [bootstrapExisting]);

  useEffect(() => {
    if (!wallet || balanceStatus !== "error") return;
    const walletId = selectedIdRef.current;
    if (!walletId) return;
    const t = setTimeout(() => {
      void loadBalance(wallet, walletId);
    }, 2500);
    return () => clearTimeout(t);
  }, [wallet, balanceStatus, loadBalance]);

  useEffect(() => {
    if (wallet || !hasWallet || balanceStatus !== "error") return;
    if (selectedWallet?.kind !== "arkade") return;
    if (openRetryCountRef.current >= 3) return;
    const attempt = openRetryCountRef.current;
    const delayMs = 5_000 * (attempt + 1);
    const t = setTimeout(() => {
      openRetryCountRef.current += 1;
      if (selectedIdRef.current) void openWalletAndSync(selectedIdRef.current);
    }, delayMs);
    return () => clearTimeout(t);
  }, [wallet, hasWallet, balanceStatus, selectedWallet, openWalletAndSync]);

  useEffect(() => {
    const w = wallet;
    const walletId = selectedIdRef.current;
    if (!w || !walletId || selectedWallet?.kind !== "arkade") return;
    // Expo notify is flaky — keep a safety poll. Slow when subscribed; 4s if dead; 1s under POS.
    const boosted = incomingWatchBoostRef.current > 0;
    const intervalMs = boosted
      ? BALANCE_POLL_BOOST_MS
      : notifySubscribed
        ? BALANCE_POLL_FALLBACK_MS
        : BALANCE_POLL_MS;
    console.warn("[basic] balancePoll", { intervalMs, boosted, notifySubscribed });
    void loadBalance(w, walletId);
    const t = setInterval(() => {
      if (selectedIdRef.current !== walletId) return;
      if (posUiHoldRef.current > 0) return;
      void loadBalance(w, walletId);
    }, intervalMs);
    return () => clearInterval(t);
  }, [wallet, selectedWallet, loadBalance, incomingWatchBoostEpoch, notifySubscribed]);

  useEffect(() => {
    const w = wallet;
    const walletId = selectedIdRef.current;
    if (!w || !walletId || selectedWallet?.kind !== "arkade") return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    let sawSubscribeReplay = false;
    setNotifySubscribed(false);

    void (async () => {
      try {
        const subscribedAt = Date.now();
        const unsub = await w.notifyIncomingFunds((funds) => {
          if (cancelled) return;
          if (funds.type !== "utxo" && funds.spentVtxos.length === 0) {
            const amount = funds.newVtxos.reduce((s, c) => s + (c.value ?? 0), 0);
            const networkId = getNetworkConfig().id;
            // Pure asset receive (arkade.money DePix/USDT send uses amount: 0).
            const assetAtomic = sumDesignatedAssetAtomic(funds.newVtxos, networkId);
            if (
              isFiatModeActiveGate() &&
              assetAtomic > 0n &&
              !openSyncQuietRef.current &&
              !quietImportSyncRef.current
            ) {
              const display = depixAtomicToDisplay(assetAtomic, networkId);
              if (display >= 0.01) {
                const postSend = Date.now() < suppressIncomingUntilRef.current;
                const expectingReceive =
                  posUiHoldRef.current > 0 || incomingWatchBoostRef.current > 0;
                if (!postSend || expectingReceive) {
                  const shown = emitFundsNotice(display, "brl", {
                    bypassSendSuppress: expectingReceive,
                  });
                  if (shown === "shown") {
                    console.warn("[basic] notifyIncomingFunds fiat asset", {
                      display,
                      assetAtomic: String(assetAtomic),
                      sats: amount,
                    });
                    try {
                      recordOptimisticArkadeReceive(getNetworkConfig().id, walletId, {
                        amountSats: 0,
                        assets: [
                          {
                            assetId: depixAssetIdForNetwork(networkId),
                            amount: assetAtomic,
                          },
                        ],
                      });
                      setActivityEpoch((n) => n + 1);
                    } catch (e) {
                      console.warn("[basic] optimistic fiat recv activity failed", e);
                    }
                  }
                }
              }
            }
            if (amount > 0) {
              // First callback often replays existing vtxos (= full balance).
              // Skip only that immediate replay — a real receive can be first
              // after a late subscribe / remount.
              if (!sawSubscribeReplay) {
                sawSubscribeReplay = true;
                const ackAvail = lastAckRef.current?.available ?? 0;
                const ackTotal = lastAckRef.current?.total ?? 0;
                const displayed = prevBalanceRef.current;
                const baselineReady = balanceBaselineReadyRef.current;
                // First callback often replays existing vtxos (incl. 330 dust
                // after Fiat Mode enter). Skip when ack/display already match,
                // or baseline is not ready yet (ack still loading).
                const looksLikeFullReplay =
                  Date.now() - subscribedAt < 2500 &&
                  (!baselineReady ||
                    lastAckRef.current == null ||
                    Math.abs(amount - ackAvail) <= 2 ||
                    (ackTotal > 0 && amount >= ackTotal * 0.9) ||
                    (displayed != null &&
                      (Math.abs(amount - (displayed.available ?? 0)) <= 2 ||
                        Math.abs(amount - displayed.total) <= 2)) ||
                    (amount <= DEFAULT_MIN_VTXO_SATS &&
                      displayed != null &&
                      displayed.total <= DEFAULT_MIN_VTXO_SATS));
                if (looksLikeFullReplay) {
                  console.warn("[basic] notifyIncomingFunds skip replay", {
                    amount,
                    ackAvail,
                    displayed: displayed?.total ?? null,
                    baselineReady,
                  });
                  scheduleReload(w, walletId, { event: true });
                  return;
                }
              }
              forcedArkAddressRef.current = null;
              console.warn("[basic] notifyIncomingFunds", { amount });
              if (!openSyncQuietRef.current && !quietImportSyncRef.current) {
                // After our own send, ASP often pushes change as newVtxos. That must
                // not look like a receive on the sending wallet. Bypass suppress only
                // when Receive/POS is actively waiting for payment (prior POS lag fix).
                const postSend =
                  Date.now() < suppressIncomingUntilRef.current;
                const expectingReceive =
                  posUiHoldRef.current > 0 || incomingWatchBoostRef.current > 0;
                if (postSend && !expectingReceive) {
                  console.warn("[basic] notifyIncomingFunds skip post-send change", {
                    amount,
                  });
                } else {
                  const shown = emitFundsNotice(amount, "arkade", {
                    bypassSendSuppress: expectingReceive,
                  });
                  // Always ack dust carriers in Fiat Mode so resync does not re-toast.
                  if (shown === "shown" || (isFiatModeActiveGate() && amount <= DEFAULT_MIN_VTXO_SATS)) {
                    acknowledgeIncomingAmount(amount);
                    if (shown === "shown") {
                      applyLocalReceive(amount);
                      const wid = selectedIdRef.current;
                      if (wid) {
                        try {
                          recordOptimisticArkadeReceive(getNetworkConfig().id, wid, {
                            amountSats: amount,
                          });
                          setActivityEpoch((n) => n + 1);
                        } catch (e) {
                          console.warn("[basic] optimistic receive activity failed", e);
                        }
                      }
                    }
                  }
                }
              }
            }
          }
          scheduleReload(w, walletId, { event: true });
        });
        if (cancelled) {
          unsub();
          return;
        }
        stop = unsub;
        setNotifySubscribed(true);
      } catch (e) {
        console.warn("[basic] notifyIncomingFunds unavailable", e);
        if (!cancelled) setNotifySubscribed(false);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(reloadTimerRef.current);
      stop?.();
      setNotifySubscribed(false);
    };
  }, [
    wallet,
    selectedWallet,
    scheduleReload,
    emitFundsNotice,
    acknowledgeIncomingAmount,
    applyLocalReceive,
  ]);

  const balanceSats = balance?.total ?? null;
  const avatarLabel = selectedWallet ? avatarLetter(selectedWallet.label) : "P";
  const walletInteractive = wallet != null;
  const sessionPhase: SessionPhase = !ready
    ? "booting"
    : hasWallet && !sessionLive
      ? "warming"
      : "live";

  // Onboarding / no wallet: skip warmup gate.
  useEffect(() => {
    if (ready && !hasWallet) setSessionLive(true);
  }, [ready, hasWallet]);

  // Encrypted contacts directory (Nostr) — independent of Path C backup enable.
  useEffect(() => {
    if (sessionPhase !== "live") return;
    queueContactsDirectoryBootSync();
  }, [sessionPhase]);

  // Debounced background exit package when recovery address is set.
  useEffect(() => {
    if (selectedWallet?.kind !== "arkade") return;
    if (balanceStatus !== "ready") return;
    if (balanceSats === null || balanceSats <= 0) return;
    scheduleAutoPrepare("balance-ready");
  }, [selectedWallet?.kind, selectedWallet?.id, balanceStatus, balanceSats, activityEpoch]);

  const value = useMemo(
    () => ({
      ready,
      hasWallet,
      sessionPhase,
      walletInteractive,
      openRestoreDone,
      markSessionLive,
      wallets,
      selectedWallet,
      wallet,
      arkAddress,
      boardingAddress,
      boardingError,
      balanceSats,
      balance,
      balanceStatus,
      balanceHidden,
      toggleBalanceHidden,
      activityEpoch,
      bumpActivity,
      fundsNotice,
      clearFundsNotice,
      notifyFundsReceived,
      setPosUiHold,
      setIncomingWatchBoost,
      noteLocalSend,
      beginOutboundSend,
      endOutboundSend,
      applyLocalSpend,
      refresh,
      refreshBalanceOnly,
      refreshActivity,
      ensureBoardingAddress,
      rotateReceiveAddress,
      rotateBoardingAddress,
      settleBoarding,
      provisionFromMnemonic,
      provisionFromPasskeyEntropy,
      beginQuietImportSync,
      createExtraArkadeWallet,
      renameWallet,
      removeWalletById,
      restoreArchivedPasskeyWallet,
      selectWallet,
      refreshWalletList,
      bootstrapExisting,
      applyFactoryReset,
      reopenWithWalletMode,
      avatarLabel,
    }),
    [
      ready,
      hasWallet,
      sessionPhase,
      walletInteractive,
      openRestoreDone,
      markSessionLive,
      wallets,
      selectedWallet,
      wallet,
      arkAddress,
      boardingAddress,
      boardingError,
      balanceSats,
      balance,
      balanceStatus,
      balanceHidden,
      toggleBalanceHidden,
      activityEpoch,
      bumpActivity,
      fundsNotice,
      clearFundsNotice,
      notifyFundsReceived,
      setIncomingWatchBoost,
      noteLocalSend,
      beginOutboundSend,
      endOutboundSend,
      applyLocalSpend,
      refresh,
      refreshBalanceOnly,
      refreshActivity,
      ensureBoardingAddress,
      rotateReceiveAddress,
      rotateBoardingAddress,
      settleBoarding,
      provisionFromMnemonic,
      provisionFromPasskeyEntropy,
      beginQuietImportSync,
      createExtraArkadeWallet,
      renameWallet,
      removeWalletById,
      restoreArchivedPasskeyWallet,
      selectWallet,
      refreshWalletList,
      bootstrapExisting,
      applyFactoryReset,
      reopenWithWalletMode,
      avatarLabel,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet outside WalletProvider");
  return ctx;
}
