/**
 * Pay a BOLT11 invoice from the selected Arkade wallet (swap corridor).
 * Used for bot Bitrefill (and any chat pay_request with preferredReceive bolt11).
 * Always cancel-capable via AbortSignal; no Promise.race on watchers.
 */

import { btcOn } from "@arkade-os/swap";
import type { ArkadeNetworkId } from "../config/network";
import { getOrCreateDepixSwapClient } from "../fiat/depixSwapClient";
import { normalizeBolt11 } from "../lightning/lndhub";
import type { BasicWallet } from "../wallet/hdWallet";
import {
  findMessageByRequestId,
  insertChatMessage,
  updateChatMessage,
  getChatMessage,
} from "./chatStore";
import { publishPaymentReceipt } from "./chatActions";
import { newChatId } from "./types";

const LN_PAY_TIMEOUT_MS = 10 * 60_000;

export type ChatLightningPayHooks = {
  wallet: BasicWallet;
  walletId: string;
  networkId: ArkadeNetworkId;
  beginOutboundSend: () => void;
  endOutboundSend: () => void;
  applyLocalSpend: (sats: number) => void;
  bumpActivity?: () => void;
  refreshActivity?: () => Promise<void>;
};

function maxFeeSats(amountSats: number): bigint {
  const pct = Math.ceil(amountSats * 0.02);
  return BigInt(Math.max(500, pct) + 500);
}

export async function executeChatLightningPay(opts: {
  contactId: string;
  amountSats: number;
  bolt11: string;
  memo?: string;
  requestId?: string | null;
  fiatCaption?: string | null;
  localMessageId?: string | null;
  paymentId?: string | null;
  hooks: ChatLightningPayHooks;
  signal?: AbortSignal;
}): Promise<{ swapId: string; paymentId: string }> {
  const amount = Math.floor(opts.amountSats);
  if (!(amount > 0)) throw new Error("Enter a positive amount.");
  const invoice = normalizeBolt11(opts.bolt11);
  if (!invoice) throw new Error("Invalid Lightning invoice.");

  const { wallet, walletId, networkId } = opts.hooks;
  const paymentId = opts.paymentId?.trim() || newChatId("pay");
  const netLabel = networkId === "mutinynet" ? "mutinynet" : "bitcoin";
  const BTC = btcOn("arkade", netLabel);

  opts.hooks.beginOutboundSend();
  try {
    if (opts.localMessageId) {
      updateChatMessage(opts.localMessageId, { status: "sending" });
    }

    const client = await getOrCreateDepixSwapClient(wallet, networkId, walletId);
    const result = await client.pay(invoice, {
      maxFee: { amount: maxFeeSats(amount), asset: BTC },
    });

    if (result.kind !== "swap") {
      throw new Error("Unexpected payment result for Lightning invoice.");
    }

    const swapId = result.swap.id;
    let settled = false;
    let finalOutcome = "open";

    const unsub = client.onUpdate(({ swap: s, outcome }) => {
      if (s.id !== swapId) return;
      const o = String(outcome);
      if (o === "paid" || o === "filled" || o === "claimed") {
        settled = true;
        finalOutcome = "paid";
      } else if (
        o === "cancelled" ||
        o === "refunded" ||
        o === "refunding" ||
        o === "failed" ||
        o === "lapsed" ||
        o === "needs_recovery"
      ) {
        settled = true;
        finalOutcome = o;
      }
    });

    try {
      const started = Date.now();
      while (!settled) {
        if (opts.signal?.aborted) {
          try {
            await client.cancel(swapId);
          } catch (e) {
            console.warn("[basic] chat ln pay cancel failed", e);
          }
          throw new Error("Payment cancelled.");
        }
        if (Date.now() - started > LN_PAY_TIMEOUT_MS) {
          try {
            await client.cancel(swapId);
          } catch {
            /* ignore */
          }
          throw new Error("Lightning payment timed out.");
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    } finally {
      unsub();
    }

    if (finalOutcome !== "paid") {
      throw new Error(`Lightning payment failed (${finalOutcome}).`);
    }

    opts.hooks.applyLocalSpend(amount);

    let localId = opts.localMessageId ?? null;
    if (localId) {
      updateChatMessage(localId, { status: "paid", paymentId });
    } else {
      const local = insertChatMessage({
        contactId: opts.contactId,
        kind: "payment",
        direction: "out",
        amountSats: amount,
        memo: opts.memo ?? null,
        fiatCaption: opts.fiatCaption ?? null,
        status: "paid",
        paymentId,
        requestId: opts.requestId ?? null,
      });
      localId = local.id;
    }

    if (opts.requestId) {
      const req = findMessageByRequestId(opts.contactId, opts.requestId);
      if (req) updateChatMessage(req.id, { status: "paid" });
    }

    void publishPaymentReceipt({
      contactId: opts.contactId,
      paymentId,
      amountSats: amount,
      memo: opts.memo,
      txid: swapId,
      rail: "lightning",
      relatedRequestId: opts.requestId ?? undefined,
    });

    opts.hooks.bumpActivity?.();
    void opts.hooks.refreshActivity?.().catch((e) =>
      console.warn("[basic] chat ln pay refreshActivity failed", e),
    );

    // Confirm local bubble stayed paid (hang recovery parity).
    if (localId) {
      const cur = getChatMessage(localId);
      if (cur && cur.status !== "paid") {
        updateChatMessage(localId, { status: "paid" });
      }
    }

    return { swapId, paymentId };
  } finally {
    opts.hooks.endOutboundSend();
  }
}
