/**
 * Activity rows for Arkade-seed Lightning corridor pays.
 * Distinct from node-row upsertLightningPayments (LNDHub/BTCPay).
 * Survives Arkade SDK rematerialize via `ark-ln-out-` / `ark-ln-in-` id prefix.
 */

import type { ArkadeNetworkId } from "../config/network";
import { upsertActivityRows } from "../account/activityStore";
import { recordSentFromThisDevice } from "../account/txMeta";
import { deriveActivityStatus, type ActivityRow } from "../wallet/activity";

export function recordArkadeLnCorridorPay(opts: {
  networkId: ArkadeNetworkId;
  walletId: string;
  swapId: string;
  invoiceSats: number;
  feeSats?: number;
  paymentHash?: string;
  memo?: string;
  preimage?: string;
  settled?: boolean;
}): void {
  const amount = -Math.abs(opts.invoiceSats);
  const createdAt = Date.now();
  const id = `ark-ln-out-${opts.swapId}`;
  const memo = opts.memo?.trim() || undefined;
  const hash = opts.paymentHash?.toLowerCase() || undefined;
  const base: Omit<ActivityRow, "status"> = {
    id,
    title: "Lightning sent",
    subtitle: (hash || opts.swapId).slice(0, 18),
    amount,
    settled: opts.settled !== false,
    createdAt,
    tags: ["lightning", "ln", "arkade", "intents"],
    txs: [
      {
        type: "SENT",
        amount,
        settled: opts.settled !== false,
        createdAt,
        tag: "lightning",
        boardingTxid: "",
        commitmentTxid: "",
        arkTxid: hash || opts.swapId,
        feeSats: opts.feeSats,
        ...(memo ? { memo } : {}),
        ...(opts.preimage ? { preimage: opts.preimage.toLowerCase() } : {}),
      },
    ],
  };
  const row: ActivityRow = { ...base, status: deriveActivityStatus(base) };
  upsertActivityRows(opts.networkId, opts.walletId, [row]);
  recordSentFromThisDevice(opts.networkId, opts.walletId, id);
  console.warn("[basic] arkade ln corridor activity", {
    id: id.slice(0, 24),
    hasPreimage: Boolean(opts.preimage),
    hasMemo: Boolean(memo),
  });
}
