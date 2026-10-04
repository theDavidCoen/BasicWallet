/**
 * Pure Activity refresh / optimistic-receive helpers (α91 Xiaomi delay).
 * No SDK, SQLite, or React — scenario checks import this file.
 */

export const ACTIVITY_REMATERIALIZE_COOL_MS = 60_000;
export const ACTIVITY_HISTORY_BUDGET_MS = 10_000;
export const ACTIVITY_HISTORY_MIN_SLICE_MS = 400;
export const OPTIMISTIC_RECEIVE_DEDUP_MS = 120_000;

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
};

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
  // Catch-up / persist / funds-notice skip if notify (or a prior catch-up) already
  // wrote this amount recently.
  if (incoming.source === "notify-credit") return null;

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

export function filterUnmatchedLocalReceives<
  T extends { amount: number; createdAt: number; arkTxid?: string },
>(
  local: T[],
  history: Array<{ amount: number; createdAt: number; id: string; arkTxid?: string }>,
): T[] {
  return local.filter((p) => !localReceiveMatchedByHistory(p, history));
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
