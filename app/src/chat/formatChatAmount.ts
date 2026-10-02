/**
 * Viewer-mode chat amount formatting (Pay in Chat Phase B).
 * Settlement stays sats; cards follow the viewer's mode.
 * Maxi = sats only. Fiat = stable primary + ≈ sats secondary.
 * Prefer frozen fiatCaption when present (history honesty).
 */

import type { ArkadeNetworkId } from "../config/network";
import {
  formatBrlDisplay,
  satsToFiatEstimate,
} from "../fiat/depixAssets";

export type ChatAmountView = {
  primary: string;
  secondary: string | null;
};

export function formatSatsLine(amountSats: number): string {
  return `${Math.floor(amountSats).toLocaleString("en-US")} sats`;
}

/** Freeze a Fiat caption from sats + spot at event time. */
export function freezeFiatCaptionFromSats(
  amountSats: number,
  spot: number | null | undefined,
  networkId: ArkadeNetworkId,
): string | null {
  if (spot == null || !(spot > 0) || !(amountSats > 0)) return null;
  const est = satsToFiatEstimate(amountSats, spot, networkId);
  if (est == null || !(est > 0)) return null;
  return formatBrlDisplay(est, { networkId });
}

export function formatChatAmountView(opts: {
  amountSats: number;
  viewerFiatMode: boolean;
  networkId: ArkadeNetworkId;
  /** Frozen at send/receive/request time. */
  fiatCaption?: string | null;
  /** Spot fallback when caption missing (Fiat viewer only). */
  spot?: number | null;
}): ChatAmountView {
  const satsLine = formatSatsLine(opts.amountSats);

  // Decision 5: Maxi sees sats only — never peer display metadata.
  if (!opts.viewerFiatMode) {
    return { primary: satsLine, secondary: null };
  }

  const frozen = opts.fiatCaption?.trim() || null;
  if (frozen) {
    return { primary: frozen, secondary: `≈ ${satsLine}` };
  }

  const fromSpot = freezeFiatCaptionFromSats(
    opts.amountSats,
    opts.spot,
    opts.networkId,
  );
  if (fromSpot) {
    return { primary: fromSpot, secondary: `≈ ${satsLine}` };
  }

  return { primary: satsLine, secondary: null };
}
