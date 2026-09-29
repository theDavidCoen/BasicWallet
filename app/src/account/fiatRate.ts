/**
 * Local historical fiat-rate cache (Edge §7.3.2 pattern, sats-only).
 * Fill-on-write: enqueue coverage when activity lands; never block list reads.
 * Rates are looked up via a pluggable fetcher (default: CoinGecko simple).
 */

import type { ArkadeNetworkId } from "../config/network";
import { getAccountDb } from "./accountDb";

const BUCKET_MS = 12 * 60 * 60 * 1000; // 12h buckets
const DEFAULT_FIAT = "eur";

type Pending = { asset: string; bucket: number };
const queue: Pending[] = [];
let draining = false;

function bucketFor(ms: number): number {
  if (!ms || ms <= 0) return bucketFor(Date.now());
  return Math.floor(ms / BUCKET_MS) * BUCKET_MS;
}

export function enqueueFiatCoverage(
  networkId: ArkadeNetworkId,
  asset: string,
  createdAtMs: number,
): void {
  const bucket = bucketFor(createdAtMs);
  if (queue.some((p) => p.asset === asset && p.bucket === bucket)) return;
  queue.push({ asset, bucket });
  void drainFiatQueue(networkId);
}

async function fetchBtcRate(fiatCode: string): Promise<number | null> {
  const code = fiatCode.toLowerCase();
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${encodeURIComponent(code)}`;
    const res = await fetch(url);
    if (res.ok) {
      const json = (await res.json()) as { bitcoin?: Record<string, number> };
      const rate = json.bitcoin?.[code];
      if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
        return rate;
      }
    }
  } catch {
    /* fall through to mempool */
  }
  try {
    const res = await fetch("https://mempool.space/api/v1/prices");
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    const rate = json[fiatCode.toUpperCase()];
    return typeof rate === "number" && Number.isFinite(rate) && rate > 0
      ? rate
      : null;
  } catch {
    return null;
  }
}

async function drainFiatQueue(preferredNetwork?: ArkadeNetworkId): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const networks: ArkadeNetworkId[] = preferredNetwork
      ? [preferredNetwork]
      : ["mutinynet", "mainnet"];
    while (queue.length > 0) {
      const item = queue.shift()!;
      for (const networkId of networks) {
        try {
          await ensureRate(networkId, item.asset, DEFAULT_FIAT, item.bucket);
          applyFiatToActivity(networkId, item.asset, DEFAULT_FIAT, item.bucket);
        } catch {
          /* ignore per-network */
        }
      }
    }
  } finally {
    draining = false;
  }
}

async function ensureRate(
  networkId: ArkadeNetworkId,
  asset: string,
  fiatCode: string,
  bucket: number,
): Promise<number | null> {
  const db = getAccountDb(networkId);
  const existing = db.getFirstSync<{ rate: number }>(
    `SELECT rate FROM fiat_rate WHERE asset = ? AND fiat_code = ? AND bucket = ?`,
    [asset, fiatCode, bucket],
  );
  if (existing) return existing.rate;

  // Historical buckets: use current spot as approximation (good enough for v1).
  if (asset !== "btc") return null;
  const rate = await fetchBtcRate(fiatCode);
  if (rate == null) return null;
  db.runSync(
    `INSERT OR REPLACE INTO fiat_rate (asset, fiat_code, bucket, rate) VALUES (?, ?, ?, ?)`,
    [asset, fiatCode, bucket, rate],
  );
  return rate;
}

function applyFiatToActivity(
  networkId: ArkadeNetworkId,
  asset: string,
  fiatCode: string,
  bucket: number,
): void {
  if (asset !== "btc") return;
  const db = getAccountDb(networkId);
  const rateRow = db.getFirstSync<{ rate: number }>(
    `SELECT rate FROM fiat_rate WHERE asset = ? AND fiat_code = ? AND bucket = ?`,
    [asset, fiatCode, bucket],
  );
  if (!rateRow) return;
  const lo = bucket;
  const hi = bucket + BUCKET_MS;
  // amount_sats / 1e8 * rate
  db.runSync(
    `UPDATE activity_idx
     SET fiat_amount = (ABS(amount_sats) / 100000000.0) * ?,
         fiat_code = ?
     WHERE created_at >= ? AND created_at < ? AND fiat_amount IS NULL`,
    [rateRow.rate, fiatCode, lo, hi],
  );
}

/** Force a spot fill for recent null fiat rows (e.g. after Activity open). */
export async function backfillMissingFiat(networkId: ArkadeNetworkId): Promise<void> {
  const db = getAccountDb(networkId);
  const missing = db.getAllSync<{ created_at: number }>(
    `SELECT DISTINCT created_at FROM activity_idx WHERE fiat_amount IS NULL LIMIT 50`,
  );
  for (const row of missing) {
    enqueueFiatCoverage(networkId, "btc", row.created_at);
  }
  await drainFiatQueue(networkId);
}
