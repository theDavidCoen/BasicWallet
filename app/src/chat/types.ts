/**
 * Pay in Chat envelopes (NIP-17 gift-wrap) + local message model.
 * Settlement stays on Arkade/LN; chat carries intent + receipts only.
 */

export const CHAT_ENVELOPE_V = 1 as const;

export type ChatAsset = "btc" | "depix" | "usdt";

export type ChatEnvelopeType =
  | "basic.wallet.chat.text"
  | "basic.wallet.chat.pay_request"
  | "basic.wallet.chat.pay_request_reply"
  | "basic.wallet.chat.pay_decline"
  | "basic.wallet.chat.payment_receipt";

export type ChatEnvelopeBase = {
  v: typeof CHAT_ENVELOPE_V;
  type: ChatEnvelopeType;
  threadContactHint?: string;
  sentAt: number;
};

export type ChatTextEnvelope = ChatEnvelopeBase & {
  type: "basic.wallet.chat.text";
  body: string;
};

export type PayRequestEnvelope = ChatEnvelopeBase & {
  type: "basic.wallet.chat.pay_request";
  requestId: string;
  amountSats: number;
  memo?: string;
  asset: ChatAsset;
  expiresAt: number;
  preferredReceive?: { kind: "ark" | "bolt11" | "lnurl"; value?: string };
};

export type PayRequestReplyEnvelope = ChatEnvelopeBase & {
  type: "basic.wallet.chat.pay_request_reply";
  requestId: string;
  status: "accept" | "address";
  payTo: { kind: "ark" | "bolt11"; value: string };
};

export type PayDeclineEnvelope = ChatEnvelopeBase & {
  type: "basic.wallet.chat.pay_decline";
  requestId: string;
};

export type PaymentReceiptEnvelope = ChatEnvelopeBase & {
  type: "basic.wallet.chat.payment_receipt";
  paymentId: string;
  direction: "out" | "in";
  amountSats: number;
  memo?: string;
  txid?: string;
  rail: "arkade" | "lightning" | "onchain";
  relatedRequestId?: string;
};

export type ChatEnvelope =
  | ChatTextEnvelope
  | PayRequestEnvelope
  | PayRequestReplyEnvelope
  | PayDeclineEnvelope
  | PaymentReceiptEnvelope;

export type ChatMessageKind = "text" | "payment" | "request" | "system";
export type ChatDirection = "in" | "out";
export type ChatMessageStatus =
  | "pending"
  | "pending_out"
  | "sent"
  | "arriving"
  | "converting"
  | "sending"
  | "failed"
  | "paid"
  | "declined"
  | "expired";

export type ChatMessage = {
  id: string;
  contactId: string;
  kind: ChatMessageKind;
  direction: ChatDirection;
  bodyText: string | null;
  amountSats: number | null;
  fiatCaption: string | null;
  memo: string | null;
  status: ChatMessageStatus | null;
  requestId: string | null;
  paymentId: string | null;
  nostrEventId: string | null;
  createdAt: number;
  updatedAt: number;
  /** Local-only: pay-to address from reply (payer side). */
  payToJson: string | null;
};

export type ChatThread = {
  contactId: string;
  peerPubkey: string | null;
  lastMessageAt: number | null;
  unreadCount: number;
  /** Local-only: hidden from Pay hub main list until unarchived. */
  archived: boolean;
  createdAt: number;
  updatedAt: number;
};

export const CHAT_TEXT_MAX_LEN = 2000;
export const PAY_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function newChatId(prefix = "m"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
