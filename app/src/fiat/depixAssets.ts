/**
 * Designated DePix (BRL) asset ids and display helpers for Fiat Mode.
 * Never mix mainnet / mutinynet ids.
 */

import type { ArkadeNetworkId } from "../config/network";

/** Mainnet DePix (RC depix-solver.card.json quote_asset.id). */
export const MAINNET_DEPIX_ASSET_ID =
  "0abcbc23c60028511880807dfe42aa16de88bd56df210a0b9135262d5d3959510000";

/** Mutinynet DePix (official wallet accountAssets.ts). */
export const MUTINYNET_DEPIX_ASSET_ID =
  "47004bf4a5fbdb2221f708030528de68ea28f5980044e546b7bb5a352457d1f30000";

export const DEPIX_DECIMALS = 8;
export const DEPIX_ATOMIC_PER_UNIT = 100_000_000n;

/** From pinned DePix card (reload before ship if card changes). */
export const DEPIX_FEE_BPS = 140;
export const DEPIX_MIN_BASE_SATS = 1001;

/** Card price feed (same as depix-solver.card.json). */
export const DEPIX_BTCBRL_FEED =
  "https://api.binance.com/api/v3/ticker/price?symbol=BTCBRL";

/**
 * Enter/exit swaps need a pinned solver card. Mainnet ships with
 * `depix-solver.card.json`. Mutinynet DePix id is known but no mutiny card
 * is pinned yet, so Fiat Mode convert is disabled there.
 */
export function isFiatModeSwapAvailable(networkId: ArkadeNetworkId): boolean {
  return networkId === "mainnet";
}

export function depixAssetIdForNetwork(networkId: ArkadeNetworkId): string {
  return networkId === "mutinynet" ? MUTINYNET_DEPIX_ASSET_ID : MAINNET_DEPIX_ASSET_ID;
}

/** Spot BTC/BRL from the DePix card price feed. */
export async function fetchBtcBrlSpot(): Promise<number | null> {
  try {
    const res = await fetch(DEPIX_BTCBRL_FEED);
    if (!res.ok) return null;
    const json = (await res.json()) as { price?: string };
    const p = Number(json.price);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

/** DePix/BRL display units → approx sats via BTCBRL spot. */
export function brlToSatsEstimate(brlDisplay: number, btcBrl: number): number | null {
  if (!(brlDisplay > 0) || !(btcBrl > 0)) return null;
  return Math.max(0, Math.round((brlDisplay / btcBrl) * 100_000_000));
}

export function isDesignatedDepixId(assetId: string, networkId: ArkadeNetworkId): boolean {
  return assetId.trim().toLowerCase() === depixAssetIdForNetwork(networkId).toLowerCase();
}

/** Parse BRL display from user input (accepts `2,50` or `2.50`). */
export function parseBrlDisplay(raw: string): number | null {
  const t = String(raw ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Display units (e.g. 1000 BRL) → atomic bigint. */
export function depixDisplayToAtomic(display: number | string): bigint {
  const n = typeof display === "string" ? Number(String(display).replace(",", ".")) : display;
  if (!Number.isFinite(n) || n < 0) return 0n;
  return BigInt(Math.round(n * Number(DEPIX_ATOMIC_PER_UNIT)));
}

/** Atomic → display number (may be fractional). */
export function depixAtomicToDisplay(atomic: bigint | number | string): number {
  const a = typeof atomic === "bigint" ? atomic : BigInt(String(atomic));
  return Number(a) / Number(DEPIX_ATOMIC_PER_UNIT);
}

export function formatBrlDisplay(display: number, opts?: { hidden?: boolean }): string {
  if (opts?.hidden) return "••••";
  const abs = Math.abs(display);
  const formatted = abs.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `R$ ${formatted}`;
}

/** Pad sats for expected swap fee when requesting Universal BIP21 in Fiat Mode. */
export function padSatsForDepixSwap(sats: number, feeBps = DEPIX_FEE_BPS): number {
  if (!(sats > 0)) return 0;
  const padded = Math.ceil(sats * (1 + feeBps / 10_000));
  return Math.max(padded, DEPIX_MIN_BASE_SATS);
}

export const FIAT_MODE_LABEL_SUFFIX = " - FIAT MODE";

export function withFiatModeLabelSuffix(label: string): string {
  const base = label.trim();
  if (!base) return `Wallet${FIAT_MODE_LABEL_SUFFIX}`;
  if (base.endsWith(FIAT_MODE_LABEL_SUFFIX)) return base;
  return `${base}${FIAT_MODE_LABEL_SUFFIX}`;
}

export function stripFiatModeLabelSuffix(label: string): string {
  const t = label.trim();
  if (t.endsWith(FIAT_MODE_LABEL_SUFFIX)) {
    return t.slice(0, -FIAT_MODE_LABEL_SUFFIX.length).trim() || t;
  }
  return t;
}

/** Default-ish labels we may auto-suffix on enter. */
export function isDefaultishWalletLabel(label: string): boolean {
  const t = stripFiatModeLabelSuffix(label).trim().toLowerCase();
  return t === "personal" || t === "wallet" || t === "savings" || t.length === 0;
}
