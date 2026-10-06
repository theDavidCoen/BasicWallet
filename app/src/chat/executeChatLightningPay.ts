/**
 * Pay a BOLT11 invoice from the selected Arkade wallet (intents corridor).
 * Used for bot Bitrefill (and any chat pay_request with preferredReceive bolt11).
 * Confirm + biometrics stay in ChatThreadScreen. Always cancel-capable via AbortSignal.
 */

import type { ArkadeNetworkId } from "../config/network";
import { recordArkadeLnCorridorPay } from "../lightning/arkadeLnActivity";
import {
  friendlyArkadeLnError,
  payArkadeLightning,
} from "../lightning/arkadeLnSwap";
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

  opts.hooks.beginOutboundSend();
  try {
    if (opts.localMessageId) {
      updateChatMessage(opts.localMessageId, { status: "sending" });
    }

    let paid: Awaited<ReturnType<typeof payArkadeLightning>>;
    try {
      paid = await payArkadeLightning({
        wallet,
        networkId,
        walletId,
        bolt11: invoice,
        signal: opts.signal,
      });
    } catch (e) {
      throw new Error(friendlyArkadeLnError(e));
    }

    const spend = paid.fundSats > 0 ? paid.fundSats : amount;
    opts.hooks.applyLocalSpend(spend);

    recordArkadeLnCorridorPay({
      networkId,
      walletId,
      swapId: paid.swapId,
      invoiceSats: paid.invoiceSats || amount,
      feeSats: paid.feeSats,
    });

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
      txid: paid.swapId,
      rail: "lightning",
      relatedRequestId: opts.requestId ?? undefined,
    });

    opts.hooks.bumpActivity?.();
    void opts.hooks.refreshActivity?.().catch((e) =>
      console.warn("[basic] chat ln pay refreshActivity failed", e),
    );

    if (localId) {
      const cur = getChatMessage(localId);
      if (cur && cur.status !== "paid") {
        updateChatMessage(localId, { status: "paid" });
      }
    }

    return { swapId: paid.swapId, paymentId };
  } finally {
    opts.hooks.endOutboundSend();
  }
}
