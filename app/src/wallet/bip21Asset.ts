/**
 * BIP21 helpers for Fiat Mode asset receive (arkade.money / official wallet shape).
 */

import { BIP21 } from "@arkade-os/sdk";

/** Encode DePix/BRL receive URI — amount is asset display units (not BTC). */
export function encodeReceiveBip21Asset(
  arkAddress: string,
  assetId: string,
  amountDisplay: number | string,
): string {
  const ark = arkAddress.trim();
  const id = assetId.trim().toLowerCase();
  const amount =
    typeof amountDisplay === "number"
      ? String(amountDisplay)
      : String(amountDisplay).trim();
  if (!ark || !id) {
    throw new Error("ark address and assetid required");
  }
  // Official wallet: bitcoin:?ark=…&assetid=…&amount=… (no on-chain address).
  return `bitcoin:?ark=${encodeURIComponent(ark)}&assetid=${encodeURIComponent(id)}&amount=${encodeURIComponent(amount)}`;
}

export type AssetBip21Parsed = {
  arkAddress: string | null;
  assetId: string | null;
  /** Display units when assetId present; otherwise undefined. */
  assetAmountDisplay: string | null;
  /** BTC amount as sats when no assetId. */
  amountSats: number | null;
};

function getParamCI(params: URLSearchParams, name: string): string | null {
  for (const [k, v] of params) {
    if (k.toLowerCase() === name) return v;
  }
  return null;
}

/** Parse BIP21 including optional `assetid` (case-insensitive). */
export function parseAssetBip21(uri: string): AssetBip21Parsed {
  const t = uri.trim();
  const empty: AssetBip21Parsed = {
    arkAddress: null,
    assetId: null,
    assetAmountDisplay: null,
    amountSats: null,
  };
  if (!/^bitcoin:/i.test(t)) return empty;

  try {
    const { params } = BIP21.parse(t);
    const ark = typeof params.ark === "string" ? params.ark.trim() : null;
    // SDK index signature may keep assetid
    let assetId: string | null = null;
    for (const [k, v] of Object.entries(params)) {
      if (k.toLowerCase() === "assetid" && (typeof v === "string" || typeof v === "number")) {
        assetId = String(v).trim().toLowerCase() || null;
        break;
      }
    }
    // Fallback: manual query parse (some environments drop unknown keys)
    if (!assetId) {
      const q = t.indexOf("?");
      if (q >= 0) {
        const sp = new URLSearchParams(t.slice(q + 1));
        assetId = getParamCI(sp, "assetid")?.trim().toLowerCase() ?? null;
      }
    }

    if (assetId) {
      const amountRaw =
        params.amount != null
          ? String(params.amount)
          : (() => {
              const q = t.indexOf("?");
              if (q < 0) return null;
              return getParamCI(new URLSearchParams(t.slice(q + 1)), "amount");
            })();
      return {
        arkAddress: ark,
        assetId,
        assetAmountDisplay: amountRaw,
        amountSats: null,
      };
    }

    let amountSats: number | null = null;
    try {
      const n = BIP21.amountSats(t);
      if (n != null && n > 0) amountSats = Math.floor(n);
    } catch {
      /* ignore */
    }
    return {
      arkAddress: ark,
      assetId: null,
      assetAmountDisplay: null,
      amountSats,
    };
  } catch {
    return empty;
  }
}
