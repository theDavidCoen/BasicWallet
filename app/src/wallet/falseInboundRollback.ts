/**
 * Detect transient ASP/poll balance spikes that were adopted as inbound
 * (deferred notice / FundsNotice) then reversed on the next live pull.
 *
 * Xiaomi 2026-10-05 ~10:44 UTC: +998 adopt → FundsNotice → ~28s later −998.
 * No notifyIncomingFunds, no FCM. Funds never stuck.
 */

export const FALSE_INBOUND_ROLLBACK_EPS = 2;

/** Match reverse against a recent notice / deferred adopt (α89.1 window). */
export const FALSE_INBOUND_ROLLBACK_MS = 120_000;

export type FalseInboundRollbackInput = {
  now: number;
  liveTotal: number;
  ackTotal: number;
  /** Last classic FundsNotice (arkade), if any. */
  noticeAmount: number | null;
  noticeAt: number | null;
  noticeKind: "arkade" | "boarding" | "brl" | "lightning" | null;
  /** Catch-up credit budget for this wallet (sats remaining). */
  catchUpCreditSats: number | null;
  /** lastNotifyFloor after deferred adopt / notify. */
  notifyFloor: number | null;
  /** Recent persist-adopt delta (optional stronger signal). */
  persistAdoptAmount: number | null;
  persistAdoptAt: number | null;
  /** POS / Receive awaiting — still allow heal; do not require notice. */
  awaitingRecv?: boolean;
  windowMs?: number;
};

export type FalseInboundRollbackResult = {
  rollback: boolean;
  healAck: boolean;
  dismissNotice: boolean;
  clearCatchUpCredit: boolean;
  dropOptimistic: boolean;
  amount: number;
  reason:
    | "none"
    | "notice-reverse"
    | "persist-adopt-reverse"
    | "credit-reverse"
    | "floor-reverse";
};

function amountMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= FALSE_INBOUND_ROLLBACK_EPS;
}

function fresh(at: number | null, now: number, windowMs: number): boolean {
  return at != null && at > 0 && now - at >= 0 && now - at < windowMs;
}

/**
 * When live drops below ack by ~the same amount as a recent inbound adopt/notice,
 * treat it as a false inbound spike and roll UI/ack/notice/credit back.
 */
export function decideFalseInboundRollback(
  input: FalseInboundRollbackInput,
): FalseInboundRollbackResult {
  const none: FalseInboundRollbackResult = {
    rollback: false,
    healAck: false,
    dismissNotice: false,
    clearCatchUpCredit: false,
    dropOptimistic: false,
    amount: 0,
    reason: "none",
  };

  const reverse = Math.floor(input.ackTotal) - Math.floor(input.liveTotal);
  if (!(reverse > FALSE_INBOUND_ROLLBACK_EPS)) return none;
  if (!(input.liveTotal >= 0) || !(input.ackTotal > input.liveTotal)) return none;

  const windowMs = input.windowMs ?? FALSE_INBOUND_ROLLBACK_MS;
  const now = input.now;

  const noticeOk =
    input.noticeKind === "arkade" &&
    input.noticeAmount != null &&
    input.noticeAmount > 0 &&
    amountMatch(input.noticeAmount, reverse) &&
    fresh(input.noticeAt, now, windowMs);

  if (noticeOk) {
    return {
      rollback: true,
      healAck: true,
      dismissNotice: true,
      clearCatchUpCredit: true,
      dropOptimistic: true,
      amount: reverse,
      reason: "notice-reverse",
    };
  }

  const adoptOk =
    input.persistAdoptAmount != null &&
    input.persistAdoptAmount > 0 &&
    amountMatch(input.persistAdoptAmount, reverse) &&
    fresh(input.persistAdoptAt, now, windowMs);

  if (adoptOk) {
    return {
      rollback: true,
      healAck: true,
      dismissNotice: true,
      clearCatchUpCredit: true,
      dropOptimistic: true,
      amount: reverse,
      reason: "persist-adopt-reverse",
    };
  }

  const creditOk =
    input.catchUpCreditSats != null &&
    input.catchUpCreditSats > 0 &&
    amountMatch(input.catchUpCreditSats, reverse);

  if (creditOk) {
    return {
      rollback: true,
      healAck: true,
      dismissNotice: true,
      clearCatchUpCredit: true,
      dropOptimistic: true,
      amount: reverse,
      reason: "credit-reverse",
    };
  }

  // Deferred adopt set notify floor to inflated live; reverse lands near prior.
  const floor = input.notifyFloor;
  if (
    floor != null &&
    floor > 0 &&
    amountMatch(floor, input.ackTotal) &&
    amountMatch(floor - input.liveTotal, reverse)
  ) {
    return {
      rollback: true,
      healAck: true,
      dismissNotice: true,
      clearCatchUpCredit: true,
      dropOptimistic: true,
      amount: reverse,
      reason: "floor-reverse",
    };
  }

  return none;
}
