/**
 * Pay a BOLT11 invoice from the selected wallet (Arkade LN corridor or LNDhub).
 * Used for bot Bitrefill, human contact LN*, and any chat pay_request with bolt11.
 * Confirm + biometrics stay in the screen. Always cancel-capable via AbortSignal.
 */

import type { ArkadeNetworkId } from "../config/network";
import { upsertLightningPayments } from "../account/lightningActivity";
import { notePendingSendFromThisDevice, recordSentFromThisDevice } from "../account/txMeta";
import { recordArkadeLnCorridorPay } from "../lightning/arkadeLnActivity";
import {
  friendlyArkadeLnError,
  payArkadeLightning,
} from "../lightning/arkadeLnSwap";
import {
  lndhubPayInvoice,
  normalizeBolt11,
  parseBolt11AmountSats,
} from "../lightning/lndhub";
import { loadLndHubCredentials } from "../lightning/lndhubCredentials";
import { loadLndRestCredentials } from "../lightning/lndCredentials";
import { lndPayInvoice } from "../lightning/lndRest";
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
  /** Required for Arkade corridor; omit for LNDhub. */
  wallet?: BasicWallet;
  walletId: string;
  networkId: ArkadeNetworkId;
  beginOutboundSend: () => void;
  endOutboundSend: () => void;
  applyLocalSpend: (sats: number) => void;
  bumpActivity?: () => void;
  refreshActivity?: () => Promise<void>;
  /** Default: arkade when `wallet` is set, else lightning. */
  rail?: "arkade" | "lightning";
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

  const { walletId, networkId } = opts.hooks;
  const rail =
    opts.hooks.rail ?? (opts.hooks.wallet ? "arkade" : "lightning");
  const paymentId = opts.paymentId?.trim() || newChatId("pay");

  opts.hooks.beginOutboundSend();
  try {
    if (opts.localMessageId) {
      updateChatMessage(opts.localMessageId, { status: "sending" });
    }

    let settleId: string;
    let spendSats = amount;

    if (rail === "lightning") {
      if (opts.signal?.aborted) {
        throw new Error("Payment cancelled.");
      }
      const hub = await loadLndHubCredentials(walletId);
      const rest = hub ? null : await loadLndRestCredentials(walletId);
      if (!hub && !rest) {
        throw new Error("Lightning node not connected for this wallet");
      }
      if (hub?.role === "invoice") {
        throw new Error(
          "This Lightning connection is invoice-only. Reconnect with an admin LNDHub URL to send.",
        );
      }
      notePendingSendFromThisDevice(networkId, walletId, amount, invoice);
      const invoiceAmt = parseBolt11AmountSats(invoice);
      const amtOpt = invoiceAmt == null ? amount : undefined;
      const result = hub
        ? await lndhubPayInvoice(hub, invoice, { amountSats: amtOpt })
        : await lndPayInvoice(
            {
              restUrl: rest!.restUrl,
              macaroonHex: rest!.macaroonHex,
              certThumbprint: rest!.certThumbprint,
              allowInsecure: rest!.allowInsecure,
              source: rest!.source,
            },
            invoice,
            { amountSats: amtOpt },
          );
      if (opts.signal?.aborted) {
        throw new Error("Payment cancelled.");
      }
      const paymentHash = result.paymentHash.toLowerCase();
      settleId = paymentHash;
      spendSats = amount + (result.feeSats ?? 0);
      const activityId = `ln-out-${paymentHash}`;
      upsertLightningPayments(networkId, walletId, [
        {
          id: activityId,
          amountSats: amount,
          direction: "out",
          createdAt: Date.now(),
          settled: true,
          memo: opts.memo,
          paymentHash,
          preimage: result.preimage,
          feeSats: result.feeSats,
        },
      ]);
      recordSentFromThisDevice(networkId, walletId, activityId);
    } else {
      const wallet = opts.hooks.wallet;
      if (!wallet) throw new Error("Arkade wallet not open.");
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
      settleId = paid.swapId;
      spendSats = paid.fundSats > 0 ? paid.fundSats : amount;
      recordArkadeLnCorridorPay({
        networkId,
        walletId,
        swapId: paid.swapId,
        invoiceSats: paid.invoiceSats || amount,
        feeSats: paid.feeSats,
        paymentHash: paid.paymentHash,
        memo: opts.memo?.trim() || paid.memo,
        preimage: paid.preimage,
      });
    }

    opts.hooks.applyLocalSpend(spendSats);

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
      txid: settleId,
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

    return { swapId: settleId, paymentId };
  } finally {
    opts.hooks.endOutboundSend();
  }
}
