/**
 * Parse payment URIs (BIP21 + bare ark / lightning) for Send / Home scan.
 * BIP21 `amount=` is BTC; we expose integer sats via SDK BIP21.amountSats.
 */

import { BIP21, isValidArkAddress } from "@arkade-os/sdk";
import {
  extractArkAddressFromScan,
  extractLightningPayFromScan,
} from "../screens/ScanQrModal";
import { parseAssetBip21 } from "./bip21Asset";

export type PayIntentPrefer = "arkade" | "lightning";

export type PayIntent = {
  /** Value for the Send destination field (ark… / bolt11 / lnurl / …). */
  destination: string;
  /** From BIP21 amount=, when present (BTC mode only). */
  amountSats?: number;
  /** Present when URI carries `assetid` (DePix / BRL). */
  assetId?: string;
  /** Asset display units from `amount=` when `assetId` is set. */
  assetAmountDisplay?: string;
};

function amountFromRaw(raw: string): number | undefined {
  try {
    const n = BIP21.amountSats(raw.trim());
    return n != null && n > 0 ? Math.floor(n) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a pasted/scanned payload into destination + optional amount.
 * Unified BIP21 (onchain + ark= + lightning= + amount=) prefers ark on
 * Arkade wallets and lightning on Lightning wallets.
 */
export function resolvePayIntent(
  raw: string,
  prefer: PayIntentPrefer = "arkade",
): PayIntent | null {
  const t = raw.trim();
  if (!t) return null;
  const amountSats = amountFromRaw(t);

  if (/^bitcoin:/i.test(t)) {
    try {
      const assetParsed = parseAssetBip21(t);
      if (assetParsed.assetId && assetParsed.arkAddress && isValidArkAddress(assetParsed.arkAddress)) {
        return {
          destination: assetParsed.arkAddress,
          assetId: assetParsed.assetId,
          assetAmountDisplay: assetParsed.assetAmountDisplay ?? undefined,
        };
      }
      const { params } = BIP21.parse(t);
      const ark = typeof params.ark === "string" ? params.ark.trim() : "";
      const ln =
        (typeof params.lightning === "string" && params.lightning.trim()) ||
        (typeof params.ln === "string" && params.ln.trim()) ||
        "";
      if (prefer === "lightning") {
        const dest = extractLightningPayFromScan(t) ?? (ln || null);
        if (dest) return { destination: dest, amountSats };
      }
      if (ark && isValidArkAddress(ark)) {
        return { destination: ark, amountSats };
      }
      const dest =
        extractLightningPayFromScan(t) ??
        extractArkAddressFromScan(t) ??
        (ln || null);
      if (dest) return { destination: dest, amountSats };
    } catch {
      /* fall through to bare extractors */
    }
  }

  if (prefer === "lightning") {
    const ln = extractLightningPayFromScan(t);
    if (ln) return { destination: ln, amountSats };
    const ark = extractArkAddressFromScan(t);
    if (ark) return { destination: ark, amountSats };
  } else {
    const ark = extractArkAddressFromScan(t);
    if (ark) return { destination: ark, amountSats };
    const ln = extractLightningPayFromScan(t);
    if (ln) return { destination: ln, amountSats };
  }

  return null;
}
