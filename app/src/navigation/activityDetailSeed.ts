/**
 * One-shot handoff of the Activity list row into Transaction Details.
 * Lets the detail screen paint from memory before any DB re-read.
 */

import type { StoredActivity } from "../account/activityStore";

let seed: StoredActivity | null = null;

export function offerActivityDetailSeed(row: StoredActivity): void {
  seed = row;
}

export function takeActivityDetailSeed(
  activityId: string,
  walletId?: string | null,
): StoredActivity | null {
  if (!seed) return null;
  if (seed.id !== activityId) return null;
  if (walletId && seed.walletId !== walletId) return null;
  const out = seed;
  seed = null;
  return out;
}

export function clearActivityDetailSeed(): void {
  seed = null;
}
