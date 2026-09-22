/** Normalize SDK WalletBalance into sats the UI can show. */

export type BalanceBreakdown = {
  /** Hero total: owned funds without mid-settle / SDK-total wedges. */
  total: number;
  /** Spendable offchain (SDK `available`). */
  available: number;
  /** Confirmed+unconfirmed onchain boarding not yet settled. */
  boarding: number;
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  return null;
}

function nearlyEqual(a: number, b: number, tol = 2): boolean {
  return Math.abs(a - b) <= tol;
}

/**
 * Prefer explicit buckets over SDK `total`.
 *
 * - `available` is the spendable offchain figure (already net of gated/intent).
 * - `settled` + `preconfirmed` partition owned offchain — never sum them on top
 *   of `available`.
 * - SDK `total` has known wedges (boarding still listed while vtxos land; rare
 *   2× available). Hero is always composed from buckets.
 */
export function balanceFromSdk(
  bal: unknown,
  prev?: BalanceBreakdown | null,
): BalanceBreakdown {
  if (typeof bal === "number" && Number.isFinite(bal)) {
    return { total: bal, available: bal, boarding: 0 };
  }
  if (!bal || typeof bal !== "object") {
    return { total: 0, available: 0, boarding: 0 };
  }
  const o = bal as Record<string, unknown>;
  const boardingObj =
    o.boarding && typeof o.boarding === "object"
      ? (o.boarding as Record<string, unknown>)
      : null;
  const boarding =
    num(boardingObj?.total) ??
    (num(boardingObj?.confirmed) ?? 0) + (num(boardingObj?.unconfirmed) ?? 0);
  const available = num(o.available) ?? 0;
  const settled = num(o.settled) ?? 0;
  const preconfirmed = num(o.preconfirmed) ?? 0;
  // Prefer spendable bucket; only fall back to owned partitions if available is 0.
  const offchain = available > 0 ? available : settled + preconfirmed;
  const sdkTotal = num(o.total);

  if (boarding <= 0) {
    let total = offchain;
    // Guard: some SDK reads briefly report total ≈ 2× available.
    if (available > 0 && sdkTotal != null && nearlyEqual(sdkTotal, available * 2)) {
      total = available;
    } else if (sdkTotal != null && sdkTotal >= 0 && sdkTotal < offchain) {
      // Prefer not to under-report if we somehow over-counted partitions.
      total = offchain;
    }
    return { total, available: offchain, boarding: 0 };
  }

  if (offchain <= 0) {
    return { total: boarding, available: 0, boarding };
  }

  const composed = boarding + offchain;
  let overlap = 0;

  if (prev) {
    const availDelta = offchain - prev.available;
    const boardingDrop = prev.boarding - boarding;

    if (availDelta > 0 && prev.boarding > 0) {
      if (nearlyEqual(availDelta, prev.boarding) && boarding > 0) {
        overlap = Math.max(overlap, Math.min(boarding, prev.boarding));
      }
      if (nearlyEqual(availDelta, boarding)) {
        overlap = Math.max(overlap, boarding);
      }
      if (boardingDrop > 0) {
        overlap = Math.max(overlap, Math.min(boardingDrop, availDelta, boarding));
      }
    }

    if (
      overlap === 0 &&
      nearlyEqual(offchain, boarding, Math.max(2, Math.floor(boarding * 0.02)))
    ) {
      overlap = boarding;
    }
  } else if (nearlyEqual(offchain, boarding, Math.max(2, Math.floor(boarding * 0.02)))) {
    overlap = boarding;
  }

  const total = Math.max(offchain, composed - overlap);
  return { total, available: offchain, boarding };
}

/** @deprecated Prefer balanceFromSdk — kept for call sites that only need a number. */
export function totalSatsFromBalance(bal: unknown): number {
  return balanceFromSdk(bal).total;
}
