/**
 * Ensure spendable sats cover a chat/classic pay amount.
 * Fiat Mode: targeted stable→sats convert via convertDepixToSatsForPay when needed.
 * Maxi / sats-enough: no-op.
 */

import type { ArkadeNetworkId } from "../config/network";
import { fiatStableForNetwork } from "../fiat/depixAssets";

export async function ensureSatsForPay(opts: {
  satsNeeded: number;
  spendable: number | null;
  fiatMode: boolean;
  depixDisplay: number | null;
  networkId: ArkadeNetworkId;
  convertDepixToSatsForPay: (satsNeeded: number) => Promise<number>;
}): Promise<{ spendable: number | null; converted: boolean }> {
  const need = Math.floor(opts.satsNeeded);
  if (!(need > 0)) throw new Error("Enter a positive amount.");

  const have = opts.spendable;
  if (have != null && have >= need) {
    return { spendable: have, converted: false };
  }

  if (!opts.fiatMode) {
    throw new Error("Insufficient balance.");
  }

  const display = opts.depixDisplay ?? 0;
  const unit = fiatStableForNetwork(opts.networkId).displayCode;
  if (!(display > 0)) {
    throw new Error(`No ${unit} balance to convert`);
  }

  const available = await opts.convertDepixToSatsForPay(need);
  if (!(available >= need)) {
    throw new Error(
      `Converted but only ${available.toLocaleString("en-US")} sats available (need ${need.toLocaleString("en-US")}).`,
    );
  }
  return { spendable: available, converted: true };
}
