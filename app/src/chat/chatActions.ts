/**
 * Outgoing chat actions: text, pay request, decline, reply, receipt.
 * Queues to outbox on relay failure (honest pending_out).
 */

import { getContact } from "../contacts/contactStore";
import { hasNostrIdentity } from "../nostr/identityStore";
import { contactDisplayName } from "../contacts/types";
import { publishChatEnvelope } from "./chatNostr";
import { resolveContactPeerPubkey, contactHasNostrId } from "./contactPeer";
import {
  enqueueChatOutbox,
  ensureChatThread,
  insertChatMessage,
  listDueChatOutbox,
  removeChatOutbox,
  bumpChatOutboxFailure,
  updateChatMessage,
  findMessageByRequestId,
} from "./chatStore";
import {
  CHAT_TEXT_MAX_LEN,
  PAY_REQUEST_TTL_MS,
  type ChatAsset,
  type ChatEnvelope,
  type ChatTextEnvelope,
  type PayDeclineEnvelope,
  type PayRequestEnvelope,
  type PayRequestReplyEnvelope,
  type PaymentReceiptEnvelope,
  newChatId,
} from "./types";

/** Relays can hang forever; never block the UI spinner on publish. */
const PUBLISH_TIMEOUT_MS = 12_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function publishOrQueue(opts: {
  contactId: string;
  recipientPubkey: string;
  envelope: ChatEnvelope;
  localMessageId: string;
}): Promise<"sent" | "pending_out"> {
  try {
    const pub = await withTimeout(
      publishChatEnvelope(opts.recipientPubkey, opts.envelope),
      PUBLISH_TIMEOUT_MS,
      "Chat publish",
    );
    updateChatMessage(opts.localMessageId, {
      status: "sent",
      nostrEventId: pub.eventId,
    });
    return "sent";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    enqueueChatOutbox({
      payloadJson: JSON.stringify(opts.envelope),
      recipientPubkey: opts.recipientPubkey,
      contactId: opts.contactId,
      localMessageId: opts.localMessageId,
    });
    updateChatMessage(opts.localMessageId, { status: "pending_out" });
    console.warn("[basic] chat publish queued", msg);
    return "pending_out";
  }
}

export async function sendChatText(
  contactId: string,
  bodyRaw: string,
): Promise<{ messageId: string; status: "sent" | "pending_out" }> {
  const body = bodyRaw.trim().slice(0, CHAT_TEXT_MAX_LEN);
  if (!body) throw new Error("Message is empty.");
  if (!(await hasNostrIdentity())) {
    throw new Error("Create a Nostr identity before chatting.");
  }
  const contact = getContact(contactId);
  if (!contact) throw new Error("Contact not found.");
  if (!contactHasNostrId(contact)) {
    throw new Error("Add an npub or NIP-05 to this contact to chat.");
  }
  const peer = await resolveContactPeerPubkey(contact);
  if (!peer.ok) throw new Error(peer.message);

  ensureChatThread(contactId, peer.pubkeyHex);
  const envelope: ChatTextEnvelope = {
    v: 1,
    type: "basic.wallet.chat.text",
    body,
    sentAt: Date.now(),
    threadContactHint: contactId,
  };
  const local = insertChatMessage({
    contactId,
    kind: "text",
    direction: "out",
    bodyText: body,
    status: "pending",
  });
  const status = await publishOrQueue({
    contactId,
    recipientPubkey: peer.pubkeyHex,
    envelope,
    localMessageId: local.id,
  });
  return { messageId: local.id, status };
}

export async function sendPayRequest(opts: {
  contactId: string;
  amountSats: number;
  memo?: string;
  asset: ChatAsset;
  preferredReceive?: { kind: "ark" | "bolt11" | "lnurl"; value?: string };
  lightningInvoice?: string;
  /** Frozen Fiat caption for requester history (local). */
  fiatCaption?: string | null;
}): Promise<{ messageId: string; requestId: string; status: "sent" | "pending_out" }> {
  if (!(opts.amountSats > 0)) throw new Error("Enter a positive amount.");
  if (!(await hasNostrIdentity())) {
    throw new Error("Create a Nostr identity before requesting.");
  }
  const contact = getContact(opts.contactId);
  if (!contact) throw new Error("Contact not found.");
  if (!contactHasNostrId(contact)) {
    throw new Error("Add an npub or NIP-05 to this contact to request.");
  }
  const peer = await resolveContactPeerPubkey(contact);
  if (!peer.ok) throw new Error(peer.message);

  const requestId = newChatId("req");
  const envelope: PayRequestEnvelope = {
    v: 1,
    type: "basic.wallet.chat.pay_request",
    requestId,
    amountSats: Math.floor(opts.amountSats),
    memo: opts.memo?.trim() || undefined,
    asset: opts.asset,
    expiresAt: Date.now() + PAY_REQUEST_TTL_MS,
    preferredReceive: opts.preferredReceive,
    lightningInvoice: opts.lightningInvoice?.trim() || undefined,
    sentAt: Date.now(),
    threadContactHint: opts.contactId,
  };
  ensureChatThread(opts.contactId, peer.pubkeyHex);
  const local = insertChatMessage({
    contactId: opts.contactId,
    kind: "request",
    direction: "out",
    amountSats: envelope.amountSats,
    memo: envelope.memo ?? null,
    status: "pending",
    requestId,
    fiatCaption: opts.fiatCaption ?? null,
    payToJson: opts.preferredReceive?.value
      ? JSON.stringify({
          kind: opts.preferredReceive.kind,
          value: opts.preferredReceive.value,
        })
      : null,
  });
  const status = await publishOrQueue({
    contactId: opts.contactId,
    recipientPubkey: peer.pubkeyHex,
    envelope,
    localMessageId: local.id,
  });
  return { messageId: local.id, requestId, status };
}

export async function declinePayRequest(opts: {
  contactId: string;
  requestId: string;
}): Promise<void> {
  if (!(await hasNostrIdentity())) {
    throw new Error("Create a Nostr identity before declining.");
  }
  const contact = getContact(opts.contactId);
  if (!contact) throw new Error("Contact not found.");
  const peer = await resolveContactPeerPubkey(contact);
  if (!peer.ok) throw new Error(peer.message);

  const envelope: PayDeclineEnvelope = {
    v: 1,
    type: "basic.wallet.chat.pay_decline",
    requestId: opts.requestId,
    sentAt: Date.now(),
    threadContactHint: opts.contactId,
  };
  const existing = findMessageByRequestId(opts.contactId, opts.requestId);
  if (existing) {
    updateChatMessage(existing.id, { status: "declined" });
    try {
      const pub = await publishChatEnvelope(peer.pubkeyHex, envelope);
      updateChatMessage(existing.id, { nostrEventId: pub.eventId });
    } catch (e) {
      enqueueChatOutbox({
        payloadJson: JSON.stringify(envelope),
        recipientPubkey: peer.pubkeyHex,
        contactId: opts.contactId,
        localMessageId: existing.id,
      });
    }
  } else {
    const local = insertChatMessage({
      contactId: opts.contactId,
      kind: "request",
      direction: "in",
      status: "declined",
      requestId: opts.requestId,
    });
    await publishOrQueue({
      contactId: opts.contactId,
      recipientPubkey: peer.pubkeyHex,
      envelope,
      localMessageId: local.id,
    });
  }
}

export async function replyPayRequestWithAddress(opts: {
  contactId: string;
  requestId: string;
  arkAddress: string;
}): Promise<void> {
  if (!(await hasNostrIdentity())) {
    throw new Error("Create a Nostr identity first.");
  }
  const contact = getContact(opts.contactId);
  if (!contact) throw new Error("Contact not found.");
  const peer = await resolveContactPeerPubkey(contact);
  if (!peer.ok) throw new Error(peer.message);

  const envelope: PayRequestReplyEnvelope = {
    v: 1,
    type: "basic.wallet.chat.pay_request_reply",
    requestId: opts.requestId,
    status: "address",
    payTo: { kind: "ark", value: opts.arkAddress },
    sentAt: Date.now(),
    threadContactHint: opts.contactId,
  };
  await publishChatEnvelope(peer.pubkeyHex, envelope);
}

export async function publishPaymentReceipt(opts: {
  contactId: string;
  paymentId: string;
  amountSats: number;
  memo?: string;
  txid?: string;
  rail: "arkade" | "lightning" | "onchain";
  relatedRequestId?: string;
}): Promise<void> {
  const contact = getContact(opts.contactId);
  if (!contact || !contactHasNostrId(contact)) return;
  if (!(await hasNostrIdentity())) return;
  const peer = await resolveContactPeerPubkey(contact);
  if (!peer.ok) return;

  const envelope: PaymentReceiptEnvelope = {
    v: 1,
    type: "basic.wallet.chat.payment_receipt",
    paymentId: opts.paymentId,
    direction: "out",
    amountSats: opts.amountSats,
    memo: opts.memo,
    txid: opts.txid,
    rail: opts.rail,
    relatedRequestId: opts.relatedRequestId,
    sentAt: Date.now(),
    threadContactHint: opts.contactId,
  };
  try {
    await publishChatEnvelope(peer.pubkeyHex, envelope);
  } catch (e) {
    enqueueChatOutbox({
      payloadJson: JSON.stringify(envelope),
      recipientPubkey: peer.pubkeyHex,
      contactId: opts.contactId,
    });
    console.warn("[basic] payment receipt queued", e);
  }
}

let flushInFlight: Promise<void> | null = null;

export async function flushChatOutbox(): Promise<void> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = (async () => {
    try {
      if (!(await hasNostrIdentity())) return;
      const due = listDueChatOutbox();
      for (const item of due) {
        try {
          const envelope = JSON.parse(item.payloadJson) as ChatEnvelope;
          const pub = await publishChatEnvelope(item.recipientPubkey, envelope);
          removeChatOutbox(item.id);
          if (item.localMessageId) {
            updateChatMessage(item.localMessageId, {
              status: "sent",
              nostrEventId: pub.eventId,
            });
          }
        } catch (e) {
          bumpChatOutboxFailure(
            item.id,
            e instanceof Error ? e.message : String(e),
          );
        }
      }
    } finally {
      flushInFlight = null;
    }
  })();
  return flushInFlight;
}

export function chatGateMessage(contactId: string): string | null {
  const contact = getContact(contactId);
  if (!contact) return "Contact not found.";
  if (!contactHasNostrId(contact)) {
    return `Add an npub or NIP-05 for ${contactDisplayName(contact)} to use Request and text chat.`;
  }
  return null;
}
