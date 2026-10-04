/**
 * Poll catch-up credit budget (α89.1).
 *
 * When persistBalance adopts Home while classic notice is deferred (chat-prefer),
 * record the adopted *delta* so a later notifyIncomingFunds does not
 * applyLocalReceive the same sats again. Running total across adopts; notify
 * consumes min(amount, budget) and applies only the remainder.
 *
 * `settledSats` tracks how much of the budget already had a classic/chat notice
 * (re-review S8) so split/overwrite notifies do not re-toast after 60s dedupe.
 */

export type CatchUpCredit = {
  /** Remaining unconsumed adopted sats. */
  sats: number;
  /** Portion of the budget whose notice was already handled. */
  settledSats: number;
  /** Last adopt/add time (ms). Settled-inheritance TTL is measured from this. */
  at: number;
  /**
   * Poll-"shown" seed: consume only on exact amount match within this TTL.
   * Prevents a catch-up/shown credit from swallowing a later different payment.
   */
  exactMatchTtlMs?: number;
};

/** Match tolerance for amount compare (same as funds-notice dedupe). */
export const CATCH_UP_CREDIT_EPS = 2;

/**
 * After this, consume still spends the balance budget but does not skip toast
 * via settledSats (re-review S6). Well above observed ~109s Samsung lag.
 */
export const CATCH_UP_SETTLED_TTL_MS = 15 * 60 * 1000;

/** Default TTL for poll-shown exact-match credit (α92 B2). */
export const CATCH_UP_EXACT_MATCH_TTL_MS = 120_000;

export function addCatchUpCredit(
  prev: CatchUpCredit | null,
  deltaSats: number,
  opts: {
    noticeSettled?: boolean;
    now?: number;
    /** Seed for poll-shown → notify same amount only (not a running budget). */
    exactMatchOnly?: boolean;
    exactMatchTtlMs?: number;
  } = {},
): CatchUpCredit | null {
  const add = Math.floor(deltaSats);
  if (!(add > 0)) return prev;
  const now = opts.now ?? Date.now();
  const settleAdd = opts.noticeSettled ? add : 0;

  if (opts.exactMatchOnly) {
    // Do not convert an existing running (deferred) budget into exact-match-only.
    if (prev && prev.sats > 0 && prev.exactMatchTtlMs == null) {
      const sats = prev.sats + add;
      return {
        sats,
        settledSats: Math.min(sats, prev.settledSats + settleAdd),
        at: now,
      };
    }
    const ttl = opts.exactMatchTtlMs ?? CATCH_UP_EXACT_MATCH_TTL_MS;
    if (!prev || prev.sats <= 0) {
      return {
        sats: add,
        settledSats: settleAdd,
        at: now,
        exactMatchTtlMs: ttl,
      };
    }
    const sats = prev.sats + add;
    return {
      sats,
      settledSats: Math.min(sats, prev.settledSats + settleAdd),
      at: now,
      exactMatchTtlMs: prev.exactMatchTtlMs ?? ttl,
    };
  }

  if (!prev || prev.sats <= 0) {
    return { sats: add, settledSats: settleAdd, at: now };
  }
  const sats = prev.sats + add;
  return {
    sats,
    settledSats: Math.min(sats, prev.settledSats + settleAdd),
    at: now,
  };
}

export type ConsumeCatchUpResult = {
  credit: CatchUpCredit | null;
  /** Sats to acknowledge + applyLocalReceive (0 when fully covered). */
  applyAmount: number;
  /** Skip classic toast when consumed fits in settledSats within TTL. */
  noticeSettled: boolean;
  consumed: number;
  exact: boolean;
};

/**
 * Consume up to `amount` from the budget. Applies only the leftover.
 * Skips toast when consumed fits in settledSats, TTL is fresh, and nothing
 * new remains to apply (final check N11).
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
  const exact = Math.abs(amt - credit.sats) <= CATCH_UP_CREDIT_EPS;

  // Poll-shown seed: only an exact match within TTL consumes; else leave/apply full.
  if (credit.exactMatchTtlMs != null) {
    if (now - credit.at > credit.exactMatchTtlMs) {
      return {
        credit: null,
        applyAmount: Math.max(0, amt),
        noticeSettled: false,
        consumed: 0,
        exact: false,
      };
    }
    if (!exact) {
      return {
        credit,
        applyAmount: Math.max(0, amt),
        noticeSettled: false,
        consumed: 0,
        exact: false,
      };
    }
    return {
      credit: null,
      applyAmount: 0,
      noticeSettled: credit.settledSats > 0,
      consumed: amt,
      exact: true,
    };
  }

  const settledTtlMs = opts.settledTtlMs ?? CATCH_UP_SETTLED_TTL_MS;
  const settledFresh = now - credit.at <= settledTtlMs;
  const consumed = Math.min(amt, credit.sats);
  const applyAmount = amt - consumed;
  const skipToast =
    settledFresh &&
    consumed > 0 &&
    applyAmount <= CATCH_UP_CREDIT_EPS &&
    consumed <= credit.settledSats + CATCH_UP_CREDIT_EPS;
  const left = credit.sats - consumed;
  const settledLeft = Math.max(0, credit.settledSats - consumed);
  const next: CatchUpCredit | null =
    left <= CATCH_UP_CREDIT_EPS
      ? null
      : {
          sats: left,
          settledSats: Math.min(left, settledLeft),
          at: credit.at,
        };
  return {
    credit: next,
    applyAmount,
    noticeSettled: skipToast,
    consumed,
    exact,
  };
}

/** Add toasted/chat-suppressed amount to settledSats (capped at budget). */
export function settleCatchUpCredit(
  credit: CatchUpCredit | null,
  amountSats: number,
): CatchUpCredit | null {
  if (!credit || credit.sats <= 0) return credit;
  const amt = Math.floor(amountSats);
  if (!(amt > 0)) return credit;
  return {
    ...credit,
    settledSats: Math.min(credit.sats, credit.settledSats + amt),
  };
}

/** True when credit is a short-lived poll-shown exact-match seed. */
export function isExactMatchCatchUpCredit(credit: CatchUpCredit | null): boolean {
  return credit != null && credit.exactMatchTtlMs != null;
}

/** Per-wallet credit map — switch must not wipe another wallet's budget. */
export type CatchUpCreditByWallet = Record<string, CatchUpCredit>;

export function getCatchUpCreditForWallet(
  byWallet: CatchUpCreditByWallet,
  walletId: string | null | undefined,
): CatchUpCredit | null {
  if (!walletId) return null;
  const c = byWallet[walletId];
  return c && c.sats > 0 ? c : null;
}

export function setCatchUpCreditForWallet(
  byWallet: CatchUpCreditByWallet,
  walletId: string | null | undefined,
  credit: CatchUpCredit | null,
): void {
  if (!walletId) return;
  if (credit && credit.sats > 0) byWallet[walletId] = credit;
  else delete byWallet[walletId];
}
