/**
 * Post-send change-guard: decide whether a live ASP total may replace the
 * optimistic Home balance / lower ack while suppressIncoming is active.
 *
 * After applyLocalSpend(amount), ASP often reports preSend − spentVtxos while
 * change is still unindexed (Xiaomi spend-drop saw 8695→7358 for a 1000 send
 * with 337 change pending). Adopting that live total leaves Home too low; when
 * change + a returning inbound land together, persistBalance toasts the combined
 * delta (e.g. +2126). α88 had the same keep-only-if-live≈preSend rule — α89's
 * immediate resumeAspPolls pull makes the race more reliable.
 */

export type PostSendLiveDecision =
  | { adoptLive: false; reason: "stale-presend" | "change-pending" }
  | {
      adoptLive: true;
      reason:
        | "not-suppressed"
        | "no-presend"
        | "notify-ack-advanced"
        | "aligned-or-above";
    };

const EPS = 2;

/**
 * Legacy rule (pre-fix α88/α89): keep optimistic only when live still looks
 * like the pre-send total. Live below that (spent vtxos visible) falls through
 * to adopt — the H2 bug.
 */
export function legacyDecidePostSendLiveAdopt(input: {
  suppressed: boolean;
  preSendTotal: number | null;
  liveTotal: number;
  optimisticTotal: number | null;
  ackTotal: number | null;
}): PostSendLiveDecision {
  const { suppressed, preSendTotal, liveTotal, optimisticTotal, ackTotal } =
    input;
  if (!suppressed) return { adoptLive: true, reason: "not-suppressed" };
  if (preSendTotal == null) return { adoptLive: true, reason: "no-presend" };
  if (liveTotal >= preSendTotal - 1) {
    const ackMatchesLive =
      ackTotal != null &&
      Math.abs(liveTotal - ackTotal) <= 1 &&
      optimisticTotal != null &&
      liveTotal > optimisticTotal + 1;
    if (ackMatchesLive) {
      return { adoptLive: true, reason: "notify-ack-advanced" };
    }
    return { adoptLive: false, reason: "stale-presend" };
  }
  return { adoptLive: true, reason: "aligned-or-above" };
}

/**
 * Keep optimistic Home when live is still the pre-send snapshot OR when live
 * is below the optimistic post-spend total (change pending).
 */
export function decidePostSendLiveAdopt(input: {
  suppressed: boolean;
  preSendTotal: number | null;
  liveTotal: number;
  optimisticTotal: number | null;
  ackTotal: number | null;
}): PostSendLiveDecision {
  const { suppressed, preSendTotal, liveTotal, optimisticTotal, ackTotal } =
    input;
  if (!suppressed) return { adoptLive: true, reason: "not-suppressed" };
  if (preSendTotal == null) return { adoptLive: true, reason: "no-presend" };

  // Indexer still showing pre-spend wallet.
  if (liveTotal >= preSendTotal - 1) {
    const ackMatchesLive =
      ackTotal != null &&
      Math.abs(liveTotal - ackTotal) <= 1 &&
      optimisticTotal != null &&
      liveTotal > optimisticTotal + 1;
    if (ackMatchesLive) {
      return { adoptLive: true, reason: "notify-ack-advanced" };
    }
    return { adoptLive: false, reason: "stale-presend" };
  }

  // Spent vtxos visible, change not yet indexed — below optimistic Home.
  const optimistic =
    optimisticTotal != null && optimisticTotal > 0
      ? optimisticTotal
      : ackTotal != null && ackTotal > 0
        ? ackTotal
        : null;
  if (optimistic != null && liveTotal + EPS < optimistic) {
    return { adoptLive: false, reason: "change-pending" };
  }

  return { adoptLive: true, reason: "aligned-or-above" };
}

/**
 * While change-guard is active, never lower ack to a live total below ack
 * (that made the later inbound delta include the missing change).
 */
export function shouldWriteAckFromLive(input: {
  suppressed: boolean;
  liveTotal: number;
  ackTotal: number | null;
}): boolean {
  const { suppressed, liveTotal, ackTotal } = input;
  if (ackTotal == null) return true;
  if (!suppressed) return true;
  // Never raise ack while suppressed (existing invariant).
  if (liveTotal > ackTotal + EPS) return false;
  // Never lower ack to a post-spend-without-change snapshot.
  if (liveTotal + EPS < ackTotal) return false;
  return true;
}

/** Inbound notice amount if Home/ack held at optimistic after send. */
export function inboundNoticeDelta(opts: {
  optimisticAfterSend: number;
  liveAfterReturn: number;
}): number {
  return Math.max(0, opts.liveAfterReturn - opts.optimisticAfterSend);
}
