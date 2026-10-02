/**
 * Ensure spendable sats cover a chat/classic pay amount.
 * Fiat Mode: targeted stable→sats convert via convertDepixToSatsForPay when needed.
 * Maxi / sats-enough: no-op.
 *
 * Fiat Mode also reserves a dust carrier (DEFAULT_MIN_VTXO_SATS) so a sats send
 * after partial DePix convert can leave ≥dust change for leftover assets
 * (SDK: "0 sats of change cannot carry 1 asset change(s), needs 330").
 */

import type { ArkadeNetworkId } from "../config/network";
import { fiatStableForNetwork } from "../fiat/depixAssets";
import { DEFAULT_MIN_VTXO_SATS } from "../wallet/arkMultiSend";

export async function ensureSatsForPay(opts: {
  satsNeeded: number;
  spendable: number | null;
  fiatMode: boolean;
  depixDisplay: number | null;
  networkId: ArkadeNetworkId;
  convertDepixToSatsForPay: (
    satsNeeded: number,
    convertOpts?: { quiet?: boolean },
  ) => Promise<number>;
  /** Override dust reserve (tests); default ASP min vtxo. */
  dustReserve?: number;
  /** Suppress Fiat Mode converting overlay (chat pay bubble owns UX). */
  quiet?: boolean;
}): Promise<{ spendable: number | null; converted: boolean }> {
  const need = Math.floor(opts.satsNeeded);
  if (!(need > 0)) throw new Error("Enter a positive amount.");

  const dust =
    opts.dustReserve != null && opts.dustReserve > 0
      ? Math.floor(opts.dustReserve)
      : DEFAULT_MIN_VTXO_SATS;
  // Fiat wallets usually keep stable remnants → need carrier after the sats send.
  const target = opts.fiatMode ? need + dust : need;

  const have = opts.spendable;
  if (have != null && have >= target) {
    return { spendable: have, converted: false };
  }
  // Maxi / no convert path: only the payment itself must be covered.
  if (!opts.fiatMode) {
    if (have != null && have >= need) {
      return { spendable: have, converted: false };
    }
    throw new Error("Insufficient balance.");
  }

  const display = opts.depixDisplay ?? 0;
  const unit = fiatStableForNetwork(opts.networkId).displayCode;
  if (!(display > 0)) {
    throw new Error(`No ${unit} balance to convert`);
  }

  // Convert enough for payment + dust carrier (targeted; leaves remaining stable).
  const available = await opts.convertDepixToSatsForPay(target, {
    quiet: opts.quiet,
  });
  if (!(available >= need)) {
    throw new Error(
      `Converted but only ${available.toLocaleString("en-US")} sats available (need ${need.toLocaleString("en-US")}).`,
    );
  }
  if (available < target) {
    // Soft warn path: send may still work if prepareDustSafeSend prefers pure BTC.
    console.warn("[basic] ensureSatsForPay short of dust carrier", {
      need,
      target,
      available,
      dust,
    });
  }
  return { spendable: available, converted: true };
}
