/**
 * Fiat Mode Activity list: show the effective stable result, not the
 * sats→convert pipeline (inbound sats, Incoming optimistic, consolidated fill).
 * Maxi / non-fiat callers should not use this.
 */

import type { ArkadeNetworkId } from "../config/network";
import type { StoredActivity } from "../account/activityStore";
import {
  activityDepixAtomic,
  type ActivityRow,
} from "../wallet/activity";
import { depixAtomicToDisplay } from "./depixAssets";

function isIncomingOptimistic(row: { id: string; subtitle?: string }): boolean {
  // Legacy convert-pipeline placeholder only (α58/α59). Keep local-recv
  // "Converted" delta rows until a settled twin replaces them via dedupe.
  return String(row.subtitle ?? "").trim().toLowerCase() === "incoming";
}

/**
 * Filter Activity rows for Fiat Mode Home/sheet.
 * @param depixDisplay current Home stable balance (for consolidate detection)
 */
export function filterFiatModeActivityRows(
  rows: StoredActivity[],
  networkId: ArkadeNetworkId,
  depixDisplay?: number | null,
): StoredActivity[] {
  const bal = depixDisplay != null && depixDisplay >= 0.01 ? depixDisplay : null;
  const kept: StoredActivity[] = [];

  for (const row of rows) {
    if (isIncomingOptimistic(row)) continue;

    const depix = activityDepixAtomic(row, networkId);
    const pureSatsRecv =
      depix == null && typeof row.amount === "number" && row.amount > 0;
    if (pureSatsRecv) continue;

    if (depix != null && depix > 0n && bal != null) {
      const recvDisplay = depixAtomicToDisplay(depix, networkId);
      // Consolidated swap-fill VTXO often carries the entire stable balance.
      // Hide when receive ≈ current balance and an older stable row exists.
      const hadPriorStable = rows.some((r) => {
        if (r.createdAt >= row.createdAt) return false;
        const d = activityDepixAtomic(r, networkId);
        return d != null && d !== 0n;
      });
      if (
        hadPriorStable &&
        recvDisplay >= bal * 0.85 &&
        Math.abs(bal - recvDisplay) <= 0.05
      ) {
        continue;
      }
    }

    kept.push(row);
  }

  // Same-amount DePix receives within 2 min → keep real txid over local-recv.
  return dedupeDepixReceives(kept, networkId);
}

function dedupeDepixReceives(
  rows: StoredActivity[],
  networkId: ArkadeNetworkId,
): StoredActivity[] {
  const out: StoredActivity[] = [];
  for (const row of rows) {
    const depix = activityDepixAtomic(row, networkId);
    if (depix == null || depix <= 0n) {
      out.push(row);
      continue;
    }
    const dupIdx = out.findIndex((other) => {
      const od = activityDepixAtomic(other, networkId);
      if (od == null || od !== depix) return false;
      return Math.abs(other.createdAt - row.createdAt) <= 120_000;
    });
    if (dupIdx < 0) {
      out.push(row);
      continue;
    }
    const existing = out[dupIdx]!;
    const preferRow = preferSettledReceive(row, existing);
    if (preferRow === row) out[dupIdx] = row;
  }
  return out;
}

function preferSettledReceive(a: ActivityRow, b: ActivityRow): ActivityRow {
  const aLocal = a.id.startsWith("local-recv:");
  const bLocal = b.id.startsWith("local-recv:");
  if (aLocal && !bLocal) return b;
  if (!aLocal && bLocal) return a;
  if (a.settled && !b.settled) return a;
  if (!a.settled && b.settled) return b;
  return a.createdAt >= b.createdAt ? a : b;
}
