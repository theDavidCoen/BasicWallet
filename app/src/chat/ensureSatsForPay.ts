/**
 * Ensure spendable sats cover a chat/classic pay amount.
 * Fiat Mode: targeted stable→sats convert via convertDepixToSatsForPay when needed.
 * Maxi / sats-enough: no-op.
 *
 * Fiat Mode also reserves a dust carrier (DEFAULT_MIN_VTXO_SATS) so a sats send
 * after partial DePix convert can leave ≥dust change for leftover assets
 * (SDK: "0 sats of change cannot carry 1 asset change(s), needs 330").
 *
 * Never trust UI/optimistic sats alone in Fiat Mode — pay-convert floors and
 * "ignore suspicious drop" can show thousands of sats while ASP only holds
 * dust carriers (α64: R$37 DePix + 660 live sats, UI claimed 3758).
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
  /**
   * Live ASP spendable sats (getBalance.available). Required for Fiat Mode
   * so stale UI floors cannot skip convert.
   */
  readLiveSpendableSats?: () => Promise<number | null>;
}): Promise<{ spendable: number | null; converted: boolean }> {
  const need = Math.floor(opts.satsNeeded);
  if (!(need > 0)) throw new Error("Enter a positive amount.");

  const dust =
    opts.dustReserve != null && opts.dustReserve > 0
      ? Math.floor(opts.dustReserve)
      : DEFAULT_MIN_VTXO_SATS;
  // Fiat wallets usually keep stable remnants → need carrier after the sats send.
  const target = opts.fiatMode ? need + dust : need;

  let have = opts.spendable;
  if (opts.fiatMode && opts.readLiveSpendableSats) {
    try {
      const live = await opts.readLiveSpendableSats();
      if (live != null && Number.isFinite(live)) {
        const liveN = Math.max(0, Math.floor(live));
        if (have == null || liveN < have) {
          console.warn("[basic] ensureSatsForPay prefer live sats", {
            ui: have,
            live: liveN,
            need,
            target,
          });
          have = liveN;
        }
      }
    } catch (e) {
      console.warn("[basic] ensureSatsForPay live sats read failed", e);
    }
  }

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

  const unit = fiatStableForNetwork(opts.networkId).displayCode;
  const display = opts.depixDisplay ?? 0;
  if (!(display > 0) && !(have != null && have >= need)) {
    console.warn("[basic] ensureSatsForPay stale depix display; trying live convert");
  }

  // Convert enough for payment + dust carrier (targeted; leaves remaining stable).
  const available = await opts.convertDepixToSatsForPay(target, {
    quiet: opts.quiet,
  });
  if (!(available >= need)) {
    throw new Error(
      `Not enough sats after convert (${available.toLocaleString("en-US")} available, need ${need.toLocaleString("en-US")}). ` +
        `Home ${unit} balance may still be settling — wait a few seconds and try again.`,
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
