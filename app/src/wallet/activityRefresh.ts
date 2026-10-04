/**
 * Pure Activity refresh / optimistic-receive helpers (α91 Xiaomi delay).
 * No SDK, SQLite, or React — scenario checks import this file.
 */

export const ACTIVITY_REMATERIALIZE_COOL_MS = 60_000;
export const ACTIVITY_HISTORY_BUDGET_MS = 10_000;
export const ACTIVITY_HISTORY_MIN_SLICE_MS = 400;
export const OPTIMISTIC_RECEIVE_DEDUP_MS = 120_000;
/** Catch-up placeholders expire even if history never lands. */
export const CATCH_UP_LOCAL_MAX_AGE_MS = 30 * 60_000;
/** Tag stored on poll/catch-up optimistic receives (not notify-credit). */
export const CATCH_UP_RECEIVE_TAG = "catch-up";
/** Narrow shown-then-notify amount dedupe — shorter than history merge window. */
export const NOTIFY_CATCHUP_ROW_DEDUP_MS = 60_000;

export type OptimisticReceiveSource =
  | "catch-up"
  | "funds-notice"
  | "persist-adopt"
  | "notify-credit"
  | "notify-skip-change"
  | "home-post-send"
  | "change-hold";

export type OptimisticReceiveHint = {
  id: string;
  amount: number;
  createdAt: number;
  arkTxid?: string;
  tags?: string[];
};

export function isCatchUpOptimisticSource(source: OptimisticReceiveSource): boolean {
  return (
    source === "catch-up" ||
    source === "funds-notice" ||
    source === "persist-adopt"
  );
}

export function rowHasCatchUpTag(tags?: string[]): boolean {
  return (tags ?? []).includes(CATCH_UP_RECEIVE_TAG);
}

function hintHasRealTxid(row: { id?: string; arkTxid?: string }): boolean {
  const ark = (row.arkTxid || "").trim().toLowerCase();
  const id = (row.id || "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(ark) || /^[0-9a-f]{64}$/.test(id);
}

export function shouldRecordOptimisticReceive(input: {
  amountSats: number;
  source: OptimisticReceiveSource;
  isOwnChange: boolean;
}): { record: boolean; reason: string } {
  const amount = Math.floor(input.amountSats);
  if (!(amount > 0)) return { record: false, reason: "non-positive" };
  if (input.isOwnChange) return { record: false, reason: "own-change" };
  if (
    input.source === "notify-skip-change" ||
    input.source === "home-post-send" ||
    input.source === "change-hold"
  ) {
    return { record: false, reason: input.source };
  }
  if (
    input.source === "catch-up" ||
    input.source === "funds-notice" ||
    input.source === "persist-adopt" ||
    input.source === "notify-credit"
  ) {
    return { record: true, reason: input.source };
  }
  return { record: false, reason: "unknown-source" };
}

/** Match an inbound we are about to insert against rows already in Activity. */
export function matchOptimisticReceive(
  existing: OptimisticReceiveHint[],
  incoming: {
    amountSats: number;
    txid?: string;
    now?: number;
    source: OptimisticReceiveSource;
  },
): string | null {
  const amount = Math.abs(Math.floor(incoming.amountSats));
  const now = incoming.now ?? 0;
  const tx = (incoming.txid ?? "").trim().toLowerCase();
  const txOk = /^[0-9a-f]{64}$/.test(tx);

  for (const row of existing) {
    if (!(row.amount > 0)) continue;
    if (row.createdAt > 0 && now > 0 && now - row.createdAt > 15 * 60_000) continue;
    const ark = (row.arkTxid || row.id).toLowerCase();
    if (txOk && (ark === tx || row.id.toLowerCase() === tx)) return row.id;
  }

  // Notify credit must not collapse two distinct same-size inbounds (S7).
  // Narrow exception: a poll "shown" catch-up row with no txid from the last
  // ~60s is the same funds as a later notify (α92 S1).
  if (incoming.source === "notify-credit") {
    for (const row of existing) {
      if (!(row.amount > 0)) continue;
      if (Math.abs(row.amount - amount) > 1) continue;
      if (hintHasRealTxid(row)) continue;
      if (!rowHasCatchUpTag(row.tags)) continue;
      if (row.createdAt > 0 && now > 0 && now - row.createdAt > NOTIFY_CATCHUP_ROW_DEDUP_MS) {
        continue;
      }
      return row.id;
    }
    return null;
  }

  for (const row of existing) {
    if (!(row.amount > 0)) continue;
    if (Math.abs(row.amount - amount) > 1) continue;
    if (row.createdAt > 0 && now > 0 && now - row.createdAt > OPTIMISTIC_RECEIVE_DEDUP_MS) {
      continue;
    }
    return row.id;
  }
  return null;
}

export function shouldDropCatchUpLocalReceive(input: {
  createdAt: number;
  historySucceeded: boolean;
  historyFetchStartedAt?: number;
  now?: number;
  maxAgeMs?: number;
}): boolean {
  // Never age-out or drop on timed-out / empty history (keeps Fiat R$ + catch-up).
  if (!input.historySucceeded) return false;
  const now = input.now ?? 0;
  const maxAge = input.maxAgeMs ?? CATCH_UP_LOCAL_MAX_AGE_MS;
  if (now > 0 && input.createdAt > 0 && now - input.createdAt > maxAge) {
    return true;
  }
  const started = input.historyFetchStartedAt;
  if (started == null) return false;
  return started > input.createdAt;
}

export function localReceiveMatchedByHistory(
  local: { amount: number; createdAt: number; arkTxid?: string },
  history: Array<{ amount: number; createdAt: number; id: string; arkTxid?: string }>,
): boolean {
  const abs = Math.abs(local.amount);
  const ark = (local.arkTxid || "").toLowerCase();
  return history.some((r) => {
    if (!(r.amount > 0)) return false;
    if (Math.abs(Math.abs(r.amount) - abs) > 1) return false;
    const hid = r.id.toLowerCase();
    const hArk = (r.arkTxid || "").toLowerCase();
    if (ark && (hid === ark || hArk === ark)) return true;
    return Math.abs(r.createdAt - local.createdAt) < OPTIMISTIC_RECEIVE_DEDUP_MS;
  });
}

export type LocalReceiveMergeOpts = {
  historySucceeded?: boolean;
  historyFetchStartedAt?: number;
  now?: number;
};

export function filterUnmatchedLocalReceives<
  T extends { amount: number; createdAt: number; arkTxid?: string; tags?: string[] },
>(
  local: T[],
  history: Array<{ amount: number; createdAt: number; id: string; arkTxid?: string }>,
  opts?: LocalReceiveMergeOpts,
): T[] {
  const historySucceeded = opts?.historySucceeded === true;
  const now = opts?.now;
  return local.filter((p) => {
    // Age / post-history drop applies only to catch-up-tagged placeholders.
    // Untagged local-recv (Fiat/Pay-in-Chat R$ rows) stay until history dedupe.
    if (
      rowHasCatchUpTag(p.tags) &&
      shouldDropCatchUpLocalReceive({
        createdAt: p.createdAt,
        historySucceeded,
        historyFetchStartedAt: opts?.historyFetchStartedAt,
        now,
      })
    ) {
      return false;
    }
    return !localReceiveMatchedByHistory(p, history);
  });
}

/** Join only when the in-flight rematerialize is still current and not already done. */
export function shouldJoinActivityRefresh(input: {
  inFlightGen: number | null | undefined;
  currentGen: number;
  inFlightSettled?: boolean;
}): boolean {
  if (input.inFlightSettled) return false;
  if (input.inFlightGen == null) return false;
  return input.inFlightGen === input.currentGen;
}

/**
 * Register-then-run model: a sync no-op (wallet not open) must not leave a
 * joinable flight. A later attempt with the wallet open must `ran`, not `join`.
 */
export function activityRefreshFlightAfterAttempt(input: {
  walletOpen: boolean;
  currentGen: number;
  inFlight: { gen: number; settled: boolean } | null;
}): {
  action: "join" | "ran" | "empty";
  currentGen: number;
  inFlight: { gen: number; settled: boolean } | null;
} {
  if (
    input.inFlight &&
    shouldJoinActivityRefresh({
      inFlightGen: input.inFlight.gen,
      currentGen: input.currentGen,
      inFlightSettled: input.inFlight.settled,
    })
  ) {
    return {
      action: "join",
      currentGen: input.currentGen,
      inFlight: input.inFlight,
    };
  }
  const startedGen = input.currentGen + 1;
  if (!input.walletOpen) {
    return { action: "empty", currentGen: startedGen, inFlight: null };
  }
  return {
    action: "ran",
    currentGen: startedGen,
    inFlight: { gen: startedGen, settled: false },
  };
}

/** Join an in-flight rematerialize for the same wallet; start a new one otherwise. */
export function coalesceActivityRefresh(input: {
  inFlightWalletId: string | null | undefined;
  requestedWalletId: string;
}): "join" | "start" {
  if (input.inFlightWalletId && input.inFlightWalletId === input.requestedWalletId) {
    return "join";
  }
  return "start";
}

/** Timeout may bump gen only when this call is still the newest. */
export function shouldBumpMaterializeGenOnFailure(input: {
  startedGen: number;
  currentGen: number;
}): boolean {
  return input.startedGen === input.currentGen;
}

export type OutboundSpendTarget = "apply-home" | "persist-foreign" | "ignore";

/** Spend/hold follow the wallet captured at beginOutboundSend, not the current selection. */
export function outboundSpendTarget(input: {
  outboundWalletId: string | null | undefined;
  currentWalletId: string | null | undefined;
}): OutboundSpendTarget {
  const out = input.outboundWalletId || null;
  const cur = input.currentWalletId || null;
  if (!out && !cur) return "ignore";
  if (!out) return "apply-home";
  if (out === cur) return "apply-home";
  return "persist-foreign";
}

export function persistSpendBreakdown(input: {
  preSend: { available: number; boarding: number; total: number };
  spendSats: number;
}): { available: number; boarding: number; total: number } {
  const spend = Math.max(0, Math.floor(input.spendSats));
  const available = Math.max(0, Math.floor(input.preSend.available) - spend);
  return {
    available,
    boarding: input.preSend.boarding,
    total: available + input.preSend.boarding,
  };
}

export function shouldCommitWalletWork(input: {
  startedWalletId: string;
  currentWalletId: string | null;
  startedGen: number;
  currentGen: number;
}): boolean {
  if (!input.currentWalletId) return false;
  if (input.startedWalletId !== input.currentWalletId) return false;
  if (input.startedGen !== input.currentGen) return false;
  return true;
}

export function isWalletCoolingDown(
  untilByWallet: Record<string, number>,
  walletId: string,
  now: number,
): boolean {
  return now < (untilByWallet[walletId] ?? 0);
}

export function remainingHistoryBudgetMs(
  startedAt: number,
  now: number,
  budgetMs = ACTIVITY_HISTORY_BUDGET_MS,
): number {
  return Math.max(0, budgetMs - (now - startedAt));
}

/** VTXO fallback only while budget remains — never a third long ASP call after timeout. */
export function shouldFetchVtxoFallback(input: {
  rowCount: number;
  remainingMs: number;
}): boolean {
  if (input.remainingMs < ACTIVITY_HISTORY_MIN_SLICE_MS) return false;
  if (input.rowCount === 0) return true;
  if (input.rowCount < 4 && input.remainingMs >= 2_000) return true;
  return false;
}

export function previousBalanceForWallet<T>(
  prev: T | null,
  prevWalletId: string | null,
  currentWalletId: string,
): T | null {
  if (prev == null) return null;
  if (!prevWalletId || prevWalletId !== currentWalletId) return null;
  return prev;
}

export type BalanceBreakdownLike = {
  total: number;
  available: number;
  boarding: number;
};

/** Home number on switch: this wallet's ack/cache only — never the previous wallet. */
export function switchHomeBalance(input: {
  cached: BalanceBreakdownLike | null;
  ack: BalanceBreakdownLike | null;
}): BalanceBreakdownLike {
  const zero: BalanceBreakdownLike = { total: 0, available: 0, boarding: 0 };
  const cached = input.cached ?? zero;
  const ack = input.ack;
  if (ack && ack.total > 0) {
    if (cached.total === 0) return ack;
    if (cached.total > ack.total + Math.max(2, ack.total * 0.02)) return ack;
  }
  return cached;
}
