/**
 * Narrow post-send change hold (H2 / α90).
 *
 * Hold Home/ack only when this guard window ran applyLocalSpend, and only for
 * the pending-change shape (spent vtxos visible, change not yet indexed).
 * Failed sends, Fiat Enter, other-device spends and unilateral exits do not
 * hold. At max-hold expiry, adopt live and lower ack so the 660-sats floor
 * cannot pin a stale optimistic total.
 *
 * Fees: classic Arkade / chat pay applyLocalSpend the payment amount only
 * (Lightning already includes feeSats). Leftover fee is not added into the
 * spend — expiry adopt + lower-ack heals ack; a fee ≤ EPS is treated as
 * aligned. Do not invent a fee for chat/classic.
 *
 * Nits left documented (not fixed this ship):
 * N4. Two sends inside 75s with the first change still pending can briefly
 *     show Home too low (selectedVtxoTotal is replaced, not accumulated).
 * N5. A stale-presend indexer lagging past 75s briefly shows pre-send funds
 *     again, then drops when the indexer catches up (no toast).
 * N6. The first poll after the 5m suppress uses hold-expired + skipFloorPin;
 *     a dust/partial read on that poll can ack dust and the next good read
 *     toasts a whole-balance delta. Narrow: that one poll.
 */

export const CHANGE_HOLD_MAX_MS = 75_000;
export const POST_SEND_EPS = 2;
export const DEFAULT_FLOOR_VTXO_SATS = 330;

export type PostSendPersistReason =
  | "change-pending"
  | "stale-presend"
  | "notify-ack-advanced"
  | "aligned-or-above"
  | "below-change-bound"
  | "hold-expired"
  | "no-local-spend"
  | "not-suppressed"
  | "floor-pin"
  | "floor-heal";

export type PostSendPersistInput = {
  now: number;
  suppressUntil: number;
  /** Date.now() + CHANGE_HOLD_MAX_MS at applyLocalSpend; 0 if none. */
  holdUntil: number;
  preSendTotal: number | null;
  /** Sum applied via applyLocalSpend this window; null if never applied. */
  localSpend: number | null;
  /** preSend − localSpend from applyLocalSpend, not displayed. */
  optimisticTotal: number | null;
  /** Sum of plan.selectedVtxos when known. */
  selectedVtxoTotal: number | null;
  liveTotal: number;
  ackTotal: number | null;
  displayedTotal: number | null;
  fiatMode?: boolean;
  postOpen?: boolean;
  awaitingRecv?: boolean;
  minVtxoSats?: number;
};

export type PostSendPersistResult = {
  adoptLive: boolean;
  writeAck: boolean;
  skipFloorPin: boolean;
  floorPinned: boolean;
  reason: PostSendPersistReason;
  homeTotal: number;
  ackTotal: number | null;
};

export type PostSendInboundInput = {
  now: number;
  suppressUntil: number;
  holdUntil: number;
  preSendTotal: number | null;
  localSpend: number | null;
  optimisticTotal: number | null;
  selectedVtxoTotal: number | null;
  liveTotal: number | null;
  ackTotal: number;
  notifyAmount: number;
  expectingReceive: boolean;
};

export type PostSendInboundResult = {
  action: "skip-change" | "credit" | "skip-no-credit";
  credit: number;
  reason: string;
};

function hasAppliedLocalSpend(input: {
  localSpend: number | null;
  optimisticTotal: number | null;
}): boolean {
  return (
    input.localSpend != null &&
    input.localSpend > 0 &&
    input.optimisticTotal != null
  );
}

function holdActive(input: {
  now: number;
  holdUntil: number;
  localSpend: number | null;
  optimisticTotal: number | null;
}): boolean {
  return (
    input.holdUntil > 0 &&
    input.now < input.holdUntil &&
    hasAppliedLocalSpend(input)
  );
}

function expectedChangeSats(input: {
  preSendTotal: number | null;
  localSpend: number | null;
  optimisticTotal: number | null;
  selectedVtxoTotal: number | null;
}): number | null {
  if (
    input.selectedVtxoTotal != null &&
    input.selectedVtxoTotal > 0 &&
    input.localSpend != null &&
    input.localSpend > 0
  ) {
    const c = input.selectedVtxoTotal - input.localSpend;
    return c > 0 ? c : null;
  }
  return null;
}

function pendingChangeLowerBound(input: {
  preSendTotal: number | null;
  selectedVtxoTotal: number | null;
}): number | null {
  if (
    input.preSendTotal == null ||
    input.selectedVtxoTotal == null ||
    input.selectedVtxoTotal <= 0
  ) {
    return null;
  }
  return input.preSendTotal - input.selectedVtxoTotal;
}

function looksLikeChangeAmount(
  amount: number,
  input: {
    preSendTotal: number | null;
    localSpend: number | null;
    optimisticTotal: number | null;
    selectedVtxoTotal: number | null;
    liveTotal: number | null;
  },
): boolean {
  if (!(amount > 0)) return false;
  const expected = expectedChangeSats(input);
  if (expected != null && Math.abs(amount - expected) <= POST_SEND_EPS) {
    return true;
  }
  const opt = input.optimisticTotal;
  const live = input.liveTotal;
  if (opt != null && live != null && live + POST_SEND_EPS < opt) {
    const gap = opt - live;
    if (gap > POST_SEND_EPS && Math.abs(amount - gap) <= POST_SEND_EPS) {
      return true;
    }
  }
  return false;
}

function floorWouldPin(input: PostSendPersistInput, skipFloorPin: boolean): boolean {
  if (skipFloorPin) return false;
  if (input.now < input.suppressUntil) return false;
  if (input.fiatMode) return false;
  const minVtxo = input.minVtxoSats ?? DEFAULT_FLOOR_VTXO_SATS;
  const dustFloor = minVtxo * 2;
  const floor = Math.max(input.ackTotal ?? 0, input.displayedTotal ?? 0);
  if (!(floor > dustFloor && input.liveTotal + dustFloor < floor)) return false;
  if (input.ackTotal != null && input.liveTotal + 1 < input.ackTotal) {
    if (input.postOpen && !input.awaitingRecv) return false;
    return true;
  }
  return false;
}

/**
 * Persist decision for a live ASP total after a local send (or a guard that
 * was armed without applyLocalSpend).
 */
export function decidePostSendPersist(
  input: PostSendPersistInput,
): PostSendPersistResult {
  const displayed = input.displayedTotal ?? input.ackTotal ?? 0;
  const ack = input.ackTotal;
  const live = input.liveTotal;
  const suppressed = input.now < input.suppressUntil;
  const applied = hasAppliedLocalSpend(input);
  const active = holdActive(input);

  const finish = (
    reason: PostSendPersistReason,
    opts: {
      adoptLive: boolean;
      writeAck: boolean;
      skipFloorPin?: boolean;
    },
  ): PostSendPersistResult => {
    const skipFloorPin = !!opts.skipFloorPin;
    const pinned = !opts.adoptLive && floorWouldPin(input, skipFloorPin);
    if (pinned) {
      return {
        adoptLive: false,
        writeAck: false,
        skipFloorPin: false,
        floorPinned: true,
        reason: "floor-pin",
        homeTotal: displayed,
        ackTotal: ack,
      };
    }
    let nextAck: number | null = ack;
    if (opts.writeAck) {
      nextAck = live;
      if (suppressed && applied && input.optimisticTotal != null) {
        // S5: absorb change up to optimistic; never raise ack to live above it.
        const cap = Math.max(ack ?? 0, input.optimisticTotal);
        nextAck = Math.min(live, cap);
      } else if (suppressed && !applied && ack != null) {
        // No local spend: lower only (never raise while suppressed).
        nextAck = Math.min(live, ack);
      }
    }
    return {
      adoptLive: opts.adoptLive,
      writeAck: opts.writeAck,
      skipFloorPin,
      floorPinned: false,
      reason,
      homeTotal: opts.adoptLive ? live : displayed,
      ackTotal: nextAck,
    };
  };

  if (active) {
    const pre = input.preSendTotal;
    const optimistic = input.optimisticTotal as number;
    if (pre != null && live >= pre - 1) {
      const ackMatchesLive =
        ack != null &&
        Math.abs(live - ack) <= 1 &&
        live > optimistic + 1;
      if (ackMatchesLive) {
        return finish("notify-ack-advanced", {
          adoptLive: true,
          writeAck: true,
        });
      }
      return finish("stale-presend", { adoptLive: false, writeAck: false });
    }
    if (live + POST_SEND_EPS < optimistic) {
      const lower = pendingChangeLowerBound(input);
      if (lower != null && live + POST_SEND_EPS < lower) {
        return finish("below-change-bound", {
          adoptLive: true,
          writeAck: true,
        });
      }
      return finish("change-pending", { adoptLive: false, writeAck: false });
    }
    return finish("aligned-or-above", { adoptLive: true, writeAck: true });
  }

  if (applied && input.holdUntil > 0 && input.now >= input.holdUntil) {
    return finish("hold-expired", {
      adoptLive: true,
      writeAck: true,
      skipFloorPin: true,
    });
  }

  if (suppressed && !applied) {
    return finish("no-local-spend", {
      adoptLive: true,
      writeAck: true,
      skipFloorPin: true,
    });
  }

  if (!suppressed) {
    const minVtxo = input.minVtxoSats ?? DEFAULT_FLOOR_VTXO_SATS;
    const dustFloor = minVtxo * 2;
    const floor = Math.max(ack ?? 0, displayed);
    if (
      !input.fiatMode &&
      floor > dustFloor &&
      live + dustFloor < floor &&
      ack != null &&
      live + 1 < ack
    ) {
      if (input.postOpen && !input.awaitingRecv) {
        return finish("floor-heal", {
          adoptLive: true,
          writeAck: true,
          skipFloorPin: true,
        });
      }
      return {
        adoptLive: false,
        writeAck: false,
        skipFloorPin: false,
        floorPinned: true,
        reason: "floor-pin",
        homeTotal: displayed,
        ackTotal: ack,
      };
    }
    return finish("not-suppressed", { adoptLive: true, writeAck: true });
  }

  return finish("not-suppressed", { adoptLive: true, writeAck: true });
}

/**
 * Receive-screen notify while the 5m post-send suppress is on.
 * Never returns a negative credit. Change does not toast as a receive;
 * a real inbound uses notify amount (or live − optimistic once change is in).
 */
export function decidePostSendInbound(
  input: PostSendInboundInput,
): PostSendInboundResult {
  const suppressed = input.now < input.suppressUntil;
  const amount = Math.max(0, Math.floor(input.notifyAmount));
  if (!suppressed) {
    return { action: "credit", credit: amount, reason: "not-suppressed" };
  }
  if (!input.expectingReceive) {
    return { action: "skip-change", credit: 0, reason: "home-post-send" };
  }

  // S4: change-shape / inbound-vs-optimistic for the whole 5m suppress, not
  // only the 75s display hold. Change arriving at 90s must not toast.
  const applied = hasAppliedLocalSpend(input);
  if (applied && looksLikeChangeAmount(amount, input)) {
    return { action: "skip-change", credit: 0, reason: "pending-change-vtxo" };
  }

  if (applied && input.optimisticTotal != null) {
    const opt = input.optimisticTotal;
    const live = input.liveTotal;
    if (live == null || live + POST_SEND_EPS < opt) {
      if (!(amount > 0)) {
        return { action: "skip-no-credit", credit: 0, reason: "no-amount" };
      }
      return {
        action: "credit",
        credit: amount,
        reason: "inbound-while-change-pending",
      };
    }
    const net = live - opt;
    if (net <= POST_SEND_EPS) {
      return { action: "skip-change", credit: 0, reason: "change-settled" };
    }
    return {
      action: "credit",
      credit: net,
      reason: "inbound-after-change",
    };
  }

  const live = input.liveTotal;
  const ack = input.ackTotal;
  if (live == null || live <= ack + 1) {
    return { action: "skip-no-credit", credit: 0, reason: "no-net-credit" };
  }
  const credit = live - ack;
  if (!(credit > 0)) {
    return { action: "skip-no-credit", credit: 0, reason: "non-positive-credit" };
  }
  return { action: "credit", credit, reason: "live-minus-ack" };
}

/** Sum of plan selected vtxos; null when the plan had none. */
export function selectedVtxoSum(
  vtxos?: Array<{ value?: number }> | null,
): number | null {
  if (!vtxos || vtxos.length === 0) return null;
  const n = vtxos.reduce((s, v) => s + Math.max(0, Number(v.value ?? 0)), 0);
  return n > 0 ? n : null;
}
