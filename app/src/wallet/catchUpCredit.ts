/**
 * Poll catch-up credit budget (α89.1).
 *
 * When persistBalance adopts Home while classic notice is deferred (chat-prefer),
 * record the adopted *delta* so a later notifyIncomingFunds does not
 * applyLocalReceive the same sats again. Running total across adopts; notify
 * consumes min(amount, budget) and applies only the remainder.
 */

export type CatchUpCredit = {
  /** Remaining unconsumed adopted sats. */
  sats: number;
  /** Last adopt/add time (ms). Settled-inheritance TTL is measured from this. */
  at: number;
  /** Classic/chat notice already handled for this budget (skip re-toast on exact). */
  noticeSettled: boolean;
};

/** Match tolerance for exact amount compare (same as funds-notice dedupe). */
export const CATCH_UP_CREDIT_EPS = 2;

/**
 * After this, exact-match notify still consumes the balance budget but does not
 * inherit noticeSettled (re-review S6). Well above observed ~109s Samsung lag.
 */
export const CATCH_UP_SETTLED_TTL_MS = 15 * 60 * 1000;

export function addCatchUpCredit(
  prev: CatchUpCredit | null,
  deltaSats: number,
  opts: { noticeSettled?: boolean; now?: number } = {},
): CatchUpCredit | null {
  const add = Math.floor(deltaSats);
  if (!(add > 0)) return prev;
  const now = opts.now ?? Date.now();
  const settled = !!opts.noticeSettled;
  if (!prev || prev.sats <= 0) {
    return { sats: add, at: now, noticeSettled: settled };
  }
  return {
    sats: prev.sats + add,
    at: now,
    // Keep settled if either side already handled notice (toast / chat-only).
    noticeSettled: prev.noticeSettled || settled,
  };
}

export type ConsumeCatchUpResult = {
  credit: CatchUpCredit | null;
  /** Sats to acknowledge + applyLocalReceive (0 when fully covered). */
  applyAmount: number;
  /** Skip classic toast only when exact match and settled within TTL. */
  noticeSettled: boolean;
  consumed: number;
  exact: boolean;
};

/**
 * Consume up to `amount` from the budget. Applies only the leftover.
 * Inherits noticeSettled only on an exact match within settled TTL.
 */
export function consumeCatchUpCredit(
  credit: CatchUpCredit | null,
  amount: number,
  opts: { now?: number; settledTtlMs?: number } = {},
): ConsumeCatchUpResult {
  const amt = Math.floor(amount);
  if (!(amt > 0) || !credit || credit.sats <= 0) {
    return {
      credit: credit && credit.sats > 0 ? credit : null,
      applyAmount: Math.max(0, amt),
      noticeSettled: false,
      consumed: 0,
      exact: false,
    };
  }
  const now = opts.now ?? Date.now();
  const settledTtlMs = opts.settledTtlMs ?? CATCH_UP_SETTLED_TTL_MS;
  const exact = Math.abs(amt - credit.sats) <= CATCH_UP_CREDIT_EPS;
  const settledFresh =
    credit.noticeSettled && now - credit.at <= settledTtlMs;
  const consumed = Math.min(amt, credit.sats);
  const applyAmount = amt - consumed;
  const left = credit.sats - consumed;
  const next: CatchUpCredit | null =
    left <= CATCH_UP_CREDIT_EPS
      ? null
      : {
          sats: left,
          at: credit.at,
          noticeSettled: credit.noticeSettled,
        };
  return {
    credit: next,
    applyAmount,
    noticeSettled: exact && settledFresh,
    consumed,
    exact,
  };
}

/** Mark notice settled when toast/chat-prefer handled this budget (exact). */
export function settleCatchUpCredit(
  credit: CatchUpCredit | null,
  amountSats: number,
): CatchUpCredit | null {
  if (!credit || credit.noticeSettled) return credit;
  const amt = Math.floor(amountSats);
  if (!(amt > 0)) return credit;
  if (Math.abs(credit.sats - amt) > CATCH_UP_CREDIT_EPS) return credit;
  return { ...credit, noticeSettled: true };
}
