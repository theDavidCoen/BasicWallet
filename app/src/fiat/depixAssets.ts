/**
 * Fiat Mode designated stables — mainnet DePix/BRL, mutinynet USDT/USD.
 * Never mix mainnet / mutinynet asset ids.
 */

import type { ArkadeNetworkId } from "../config/network";

/** Mainnet DePix (RC depix-solver.card.json quote_asset.id). */
export const MAINNET_DEPIX_ASSET_ID =
  "0abcbc23c60028511880807dfe42aa16de88bd56df210a0b9135262d5d3959510000";

/** Mutinynet DePix (official wallet accountAssets.ts) — not used for Fiat Mode. */
export const MUTINYNET_DEPIX_ASSET_ID =
  "47004bf4a5fbdb2221f708030528de68ea28f5980044e546b7bb5a352457d1f30000";

/** Mutinynet USDT (solver-registry frenchman / official wallet). */
export const MUTINYNET_USDT_ASSET_ID =
  "f121ac9b7656797cc68d1e8fecacfbaa2069ec1461edf0bf2f3c37404cb9791a0000";

export const DEPIX_DECIMALS = 8;
export const DEPIX_ATOMIC_PER_UNIT = 100_000_000n;
export const USDT_DECIMALS = 2;
export const USDT_ATOMIC_PER_UNIT = 100n;

/** From pinned DePix card (reload before ship if card changes). */
export const DEPIX_FEE_BPS = 140;
export const DEPIX_MIN_BASE_SATS = 1001;

/** From pinned mutinynet frenchman USDT card. */
export const USDT_FEE_BPS = 30;
export const USDT_MIN_BASE_SATS = 330;

/** Card price feed (same as depix-solver.card.json). */
export const DEPIX_BTCBRL_FEED =
  "https://api.binance.com/api/v3/ticker/price?symbol=BTCBRL";

export const USDT_BTCUSD_FEED =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";

export type FiatStableKind = "brl" | "usd";

export type FiatStableInfo = {
  kind: FiatStableKind;
  /** On-chain / VTXO asset id (bare hex). */
  assetId: string;
  ticker: string;
  /** UI currency label: BRL or USD. */
  displayCode: "BRL" | "USD";
  decimals: number;
  atomicPerUnit: bigint;
  feeBps: number;
  minBaseSats: number;
  spotFeedUrl: string;
  /** JSON path segments under the response root for the spot number. */
  spotPricePath: string[];
};

export function fiatStableForNetwork(networkId: ArkadeNetworkId): FiatStableInfo {
  if (networkId === "mutinynet") {
    return {
      kind: "usd",
      assetId: MUTINYNET_USDT_ASSET_ID,
      ticker: "USDT",
      displayCode: "USD",
      decimals: USDT_DECIMALS,
      atomicPerUnit: USDT_ATOMIC_PER_UNIT,
      feeBps: USDT_FEE_BPS,
      minBaseSats: USDT_MIN_BASE_SATS,
      spotFeedUrl: USDT_BTCUSD_FEED,
      spotPricePath: ["bitcoin", "usd"],
    };
  }
  return {
    kind: "brl",
    assetId: MAINNET_DEPIX_ASSET_ID,
    ticker: "DePix",
    displayCode: "BRL",
    decimals: DEPIX_DECIMALS,
    atomicPerUnit: DEPIX_ATOMIC_PER_UNIT,
    feeBps: DEPIX_FEE_BPS,
    minBaseSats: DEPIX_MIN_BASE_SATS,
    spotFeedUrl: DEPIX_BTCBRL_FEED,
    spotPricePath: ["price"],
  };
}

/**
 * Enter/exit swaps need a pinned solver card.
 * Mainnet: DePix. Mutinynet: frenchman USDT.
 */
export function isFiatModeSwapAvailable(networkId: ArkadeNetworkId): boolean {
  return networkId === "mainnet" || networkId === "mutinynet";
}

/** Fiat Mode asset id for the active network (DePix mainnet / USDT mutiny). */
export function depixAssetIdForNetwork(networkId: ArkadeNetworkId): string {
  return fiatStableForNetwork(networkId).assetId;
}

export function fiatFeeBps(networkId: ArkadeNetworkId): number {
  return fiatStableForNetwork(networkId).feeBps;
}

export function fiatMinBaseSats(networkId: ArkadeNetworkId): number {
  return fiatStableForNetwork(networkId).minBaseSats;
}

function readPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Spot BTC/fiat from the pinned card price feed. */
export async function fetchFiatSpot(networkId: ArkadeNetworkId): Promise<number | null> {
  const info = fiatStableForNetwork(networkId);
  try {
    const res = await fetch(info.spotFeedUrl);
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    const raw = readPath(json, info.spotPricePath);
    const p = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

/** @deprecated Prefer fetchFiatSpot(networkId). */
export async function fetchBtcBrlSpot(): Promise<number | null> {
  return fetchFiatSpot("mainnet");
}

/** Display units → approx sats via spot. */
export function brlToSatsEstimate(display: number, btcFiat: number): number | null {
  if (!(display > 0) || !(btcFiat > 0)) return null;
  return Math.max(0, Math.round((display / btcFiat) * 100_000_000));
}

export function isDesignatedDepixId(assetId: string, networkId: ArkadeNetworkId): boolean {
  return assetId.trim().toLowerCase() === depixAssetIdForNetwork(networkId).toLowerCase();
}

/** Parse fiat display from user input (accepts `2,50` or `2.50`). */
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

/** Display units → atomic bigint (network-aware decimals). */
export function depixDisplayToAtomic(
  display: number | string,
  networkId: ArkadeNetworkId = "mainnet",
): bigint {
  const n = typeof display === "string" ? Number(String(display).replace(",", ".")) : display;
  if (!Number.isFinite(n) || n < 0) return 0n;
  const { atomicPerUnit } = fiatStableForNetwork(networkId);
  return BigInt(Math.round(n * Number(atomicPerUnit)));
}

/** Atomic → display number (network-aware decimals). */
export function depixAtomicToDisplay(
  atomic: bigint | number | string,
  networkId: ArkadeNetworkId = "mainnet",
): number {
  const a = typeof atomic === "bigint" ? atomic : BigInt(String(atomic));
  const { atomicPerUnit } = fiatStableForNetwork(networkId);
  return Number(a) / Number(atomicPerUnit);
}

/** Format Fiat Mode display amount (R$ … / $ …). */
export function formatBrlDisplay(
  display: number,
  opts?: { hidden?: boolean; networkId?: ArkadeNetworkId },
): string {
  if (opts?.hidden) return "••••";
  const networkId = opts?.networkId ?? "mainnet";
  const { displayCode } = fiatStableForNetwork(networkId);
  const abs = Math.abs(display);
  if (displayCode === "USD") {
    const formatted = abs.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `$ ${formatted}`;
  }
  const formatted = abs.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `R$ ${formatted}`;
}

/** Pad sats for expected swap fee when requesting Universal BIP21 in Fiat Mode. */
export function padSatsForDepixSwap(
  sats: number,
  feeBpsOrNetwork: number | ArkadeNetworkId = DEPIX_FEE_BPS,
): number {
  if (!(sats > 0)) return 0;
  const feeBps =
    typeof feeBpsOrNetwork === "string"
      ? fiatFeeBps(feeBpsOrNetwork)
      : feeBpsOrNetwork;
  const minBase =
    typeof feeBpsOrNetwork === "string"
      ? fiatMinBaseSats(feeBpsOrNetwork)
      : DEPIX_MIN_BASE_SATS;
  const padded = Math.ceil(sats * (1 + feeBps / 10_000));
  return Math.max(padded, minBase);
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

/** Sum designated fiat-asset atomic amount from notifyIncoming newVtxos. */
export function sumDesignatedAssetAtomic(
  coins: ReadonlyArray<{ assets?: ReadonlyArray<{ assetId?: string; amount?: bigint | number | string }> }>,
  networkId: ArkadeNetworkId,
): bigint {
  const want = depixAssetIdForNetwork(networkId).toLowerCase();
  let total = 0n;
  for (const c of coins) {
    for (const a of c.assets ?? []) {
      const id = String(a.assetId ?? "").toLowerCase();
      if (id !== want) continue;
      const amt = a.amount;
      if (typeof amt === "bigint") total += amt;
      else if (typeof amt === "number" && Number.isFinite(amt)) total += BigInt(Math.floor(amt));
      else if (typeof amt === "string" && /^\d+$/.test(amt)) total += BigInt(amt);
    }
  }
  return total;
}
