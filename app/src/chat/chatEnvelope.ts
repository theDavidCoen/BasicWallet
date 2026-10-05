/**
 * Parse / build Pay in Chat gift-wrap envelopes.
 */

import {
  CHAT_ENVELOPE_V,
  CHAT_TEXT_MAX_LEN,
  type ChatAsset,
  type ChatEnvelope,
  type ChatTextEnvelope,
  type PayDeclineEnvelope,
  type PayRequestEnvelope,
  type PayRequestFulfillment,
  type PayRequestReplyEnvelope,
  type PaymentReceiptEnvelope,
} from "./types";

function isAsset(v: unknown): v is ChatAsset {
  return v === "btc" || v === "depix" || v === "usdt";
}

function parseFulfillment(raw: unknown): PayRequestFulfillment | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const invoiceId =
    typeof o.invoiceId === "string"
      ? o.invoiceId.trim()
      : typeof o.invoice_id === "string"
        ? o.invoice_id.trim()
        : "";
  const invoiceAccessToken =
    typeof o.invoiceAccessToken === "string"
      ? o.invoiceAccessToken.trim()
      : typeof o.invoice_access_token === "string"
        ? o.invoice_access_token.trim()
        : undefined;
  if (!invoiceId) return undefined;
  const provider =
    o.provider === "bitrefill" || !o.provider ? "bitrefill" : undefined;
  if (!provider) return undefined;
  return {
    provider,
    invoiceId,
    invoiceAccessToken: invoiceAccessToken || undefined,
  };
}

export function parseChatEnvelope(raw: string): ChatEnvelope | null {
  try {
    const p = JSON.parse(raw) as Partial<ChatEnvelope> & { type?: string };
    if (p.v !== CHAT_ENVELOPE_V || typeof p.type !== "string") return null;
    const sentAt = typeof p.sentAt === "number" ? p.sentAt : Date.now();
    const hint =
      typeof p.threadContactHint === "string" ? p.threadContactHint : undefined;

    switch (p.type) {
      case "basic.wallet.chat.text": {
        const body = typeof (p as ChatTextEnvelope).body === "string"
          ? (p as ChatTextEnvelope).body.trim()
          : "";
        if (!body) return null;
        return {
          v: 1,
          type: "basic.wallet.chat.text",
          body: body.slice(0, CHAT_TEXT_MAX_LEN),
          sentAt,
          threadContactHint: hint,
        };
      }
      case "basic.wallet.chat.pay_request": {
        const r = p as PayRequestEnvelope;
        if (typeof r.requestId !== "string" || !r.requestId.trim()) return null;
        if (typeof r.amountSats !== "number" || !(r.amountSats > 0)) return null;
        if (!isAsset(r.asset)) return null;
        if (typeof r.expiresAt !== "number") return null;
        const fulfillment = parseFulfillment(
          (r as PayRequestEnvelope).fulfillment ??
            (p as { fulfillment?: unknown }).fulfillment,
        );
        return {
          v: 1,
          type: "basic.wallet.chat.pay_request",
          requestId: r.requestId.trim(),
          amountSats: Math.floor(r.amountSats),
          memo: typeof r.memo === "string" ? r.memo.slice(0, 280) : undefined,
          asset: r.asset,
          expiresAt: r.expiresAt,
          preferredReceive: r.preferredReceive,
          fulfillment,
          sentAt,
          threadContactHint: hint,
        };
      }
      case "basic.wallet.chat.pay_request_reply": {
        const r = p as PayRequestReplyEnvelope;
        if (typeof r.requestId !== "string" || !r.requestId.trim()) return null;
        if (r.status !== "accept" && r.status !== "address") return null;
        if (
          !r.payTo ||
          (r.payTo.kind !== "ark" && r.payTo.kind !== "bolt11") ||
          typeof r.payTo.value !== "string" ||
          !r.payTo.value.trim()
        ) {
          return null;
        }
        return {
          v: 1,
          type: "basic.wallet.chat.pay_request_reply",
          requestId: r.requestId.trim(),
          status: r.status,
          payTo: { kind: r.payTo.kind, value: r.payTo.value.trim() },
          sentAt,
          threadContactHint: hint,
        };
      }
      case "basic.wallet.chat.pay_decline": {
        const r = p as PayDeclineEnvelope;
        if (typeof r.requestId !== "string" || !r.requestId.trim()) return null;
        return {
          v: 1,
          type: "basic.wallet.chat.pay_decline",
          requestId: r.requestId.trim(),
          sentAt,
          threadContactHint: hint,
        };
      }
      case "basic.wallet.chat.payment_receipt": {
        const r = p as PaymentReceiptEnvelope;
        if (typeof r.paymentId !== "string" || !r.paymentId.trim()) return null;
        if (r.direction !== "out" && r.direction !== "in") return null;
        if (typeof r.amountSats !== "number" || !(r.amountSats > 0)) return null;
        if (r.rail !== "arkade" && r.rail !== "lightning" && r.rail !== "onchain") {
          return null;
        }
        return {
          v: 1,
          type: "basic.wallet.chat.payment_receipt",
          paymentId: r.paymentId.trim(),
          direction: r.direction,
          amountSats: Math.floor(r.amountSats),
          memo: typeof r.memo === "string" ? r.memo.slice(0, 280) : undefined,
          txid: typeof r.txid === "string" ? r.txid : undefined,
          rail: r.rail,
          relatedRequestId:
            typeof r.relatedRequestId === "string" ? r.relatedRequestId : undefined,
          sentAt,
          threadContactHint: hint,
        };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export function isChatEnvelopeJson(raw: string): boolean {
  const t = raw.trimStart();
  if (!t.startsWith("{")) return false;
  return (
    t.includes("basic.wallet.chat.") ||
    t.includes('"type":"basic.wallet.chat')
  );
}
