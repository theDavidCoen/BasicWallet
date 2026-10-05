/**
 * Ingest unwrapped chat envelopes into the local SQLCipher store.
 */

import { listContacts } from "../contacts/contactStore";
import { getNetworkConfig } from "../config/network";
import { getSelectedWalletId } from "../account/walletRegistry";
import { fetchFiatSpot } from "../fiat/depixAssets";
import { readFiatModeState } from "../fiat/fiatModeStore";
import {
  consumeRecentInboundFiatSettle,
  isAutoInboundBusy,
} from "./chatInboundFiat";
import {
  dismissClassicFundsNoticeIfChat,
  noteChatInboundReceiptHint,
} from "./chatInboundPrefer";
import {
  findContactIdByPeerPubkey,
  silentlyUpsertContactArkFromChat,
} from "./contactPeer";
import {
  ensureChatThread,
  findMessageByNostrEventId,
  findMessageByPaymentId,
  findMessageByRequestId,
  findRecentInboundPaymentByAmount,
  insertChatMessage,
  updateChatMessage,
} from "./chatStore";
import { freezeFiatCaptionFromSats } from "./formatChatAmount";
import { buildPayToJson } from "./payToJson";
import type { ChatEnvelope } from "./types";

function resolveContactId(
  peerPubkey: string,
  hint?: string,
): string | null {
  const contacts = listContacts();
  const byPk = findContactIdByPeerPubkey(peerPubkey, contacts);
  if (byPk) return byPk;
  if (hint) {
    const hit = contacts.find((c) => c.id === hint);
    if (hit) return hit.id;
  }
  return null;
}

/** Freeze Fiat caption at ingest (receive) time when viewer is in Fiat Mode. */
async function freezeCaptionIfFiat(
  amountSats: number | null | undefined,
): Promise<string | null> {
  if (amountSats == null || !(amountSats > 0)) return null;
  try {
    const networkId = getNetworkConfig().id;
    const walletId = getSelectedWalletId(networkId);
    if (!walletId) return null;
    const state = await readFiatModeState(networkId, walletId);
    if (!state.fiatMode) return null;
    const spot = await fetchFiatSpot(networkId);
    return freezeFiatCaptionFromSats(amountSats, spot, networkId);
  } catch (e) {
    console.warn("[basic] chat ingest fiat caption freeze failed", e);
    return null;
  }
}

export async function ingestChatEnvelope(opts: {
  envelope: ChatEnvelope;
  peerPubkey: string;
  wrapEventId: string;
}): Promise<boolean> {
  const { envelope, peerPubkey, wrapEventId } = opts;
  if (findMessageByNostrEventId(wrapEventId)) return false;

  const contactId = resolveContactId(peerPubkey, envelope.threadContactHint);
  if (!contactId) {
    console.warn("[basic] chat ingest: no matching contact for peer", peerPubkey.slice(0, 12));
    return false;
  }

  ensureChatThread(contactId, peerPubkey);
  const sentAt = envelope.sentAt || Date.now();

  switch (envelope.type) {
    case "basic.wallet.chat.text": {
      insertChatMessage({
        contactId,
        kind: "text",
        direction: "in",
        bodyText: envelope.body,
        status: "sent",
        nostrEventId: wrapEventId,
        createdAt: sentAt,
        bumpUnread: true,
      });
      return true;
    }
    case "basic.wallet.chat.pay_request": {
      if (findMessageByRequestId(contactId, envelope.requestId)) return false;
      const expired = envelope.expiresAt < Date.now();
      const pref = envelope.preferredReceive;
      const payToJson =
        pref?.kind === "ark" && pref.value
          ? buildPayToJson({
              kind: "ark",
              value: pref.value,
              fulfillment: envelope.fulfillment,
            })
          : pref?.kind === "bolt11" && pref.value
            ? buildPayToJson({
                kind: "bolt11",
                value: pref.value,
                fulfillment: envelope.fulfillment,
              })
            : null;
      if (pref?.kind === "ark" && pref.value) {
        silentlyUpsertContactArkFromChat(contactId, pref.value);
      }
      const fiatCaption = await freezeCaptionIfFiat(envelope.amountSats);
      insertChatMessage({
        contactId,
        kind: "request",
        direction: "in",
        amountSats: envelope.amountSats,
        memo: envelope.memo ?? null,
        status: expired ? "expired" : "pending",
        requestId: envelope.requestId,
        nostrEventId: wrapEventId,
        createdAt: sentAt,
        payToJson,
        fiatCaption,
        bumpUnread: true,
      });
      return true;
    }
    case "basic.wallet.chat.pay_request_reply": {
      if (envelope.payTo?.kind === "ark" && envelope.payTo.value) {
        silentlyUpsertContactArkFromChat(contactId, envelope.payTo.value);
      }
      const existing = findMessageByRequestId(contactId, envelope.requestId);
      if (existing) {
        updateChatMessage(existing.id, {
          payToJson: JSON.stringify(envelope.payTo),
          status: existing.status === "pending" ? "pending" : existing.status,
        });
      } else {
        insertChatMessage({
          contactId,
          kind: "system",
          direction: "in",
          bodyText: "Peer shared a receive address",
          status: "sent",
          requestId: envelope.requestId,
          nostrEventId: wrapEventId,
          createdAt: sentAt,
          payToJson: JSON.stringify(envelope.payTo),
          bumpUnread: true,
        });
      }
      return true;
    }
    case "basic.wallet.chat.pay_decline": {
      const existing = findMessageByRequestId(contactId, envelope.requestId);
      if (existing) {
        updateChatMessage(existing.id, { status: "declined" });
      } else {
        insertChatMessage({
          contactId,
          kind: "request",
          direction: "out",
          status: "declined",
          requestId: envelope.requestId,
          nostrEventId: wrapEventId,
          createdAt: sentAt,
          bumpUnread: true,
        });
      }
      return true;
    }
    case "basic.wallet.chat.payment_receipt": {
      // Peer's "out" is our "in" and vice versa.
      const direction = envelope.direction === "out" ? "in" : "out";
      let fiatCaption: string | null = null;
      let status: "paid" | "arriving" | "converting" = "paid";
      if (direction === "in") {
        // Fiat Mode: never freeze theoretical pre-fee sats→fiat. Show
        // arriving/converting without amount until auto-inbound settles.
        try {
          const networkId = getNetworkConfig().id;
          const walletId = getSelectedWalletId(networkId);
          const state = walletId
            ? await readFiatModeState(networkId, walletId)
            : null;
          if (state?.fiatMode) {
            const settled = consumeRecentInboundFiatSettle();
            if (settled) {
              fiatCaption = settled;
              status = "paid";
            } else {
              fiatCaption = null;
              status = isAutoInboundBusy() ? "converting" : "arriving";
            }
          } else {
            fiatCaption = await freezeCaptionIfFiat(envelope.amountSats);
            status = "paid";
          }
        } catch (e) {
          console.warn("[basic] chat ingest inbound fiat status failed", e);
          fiatCaption = null;
          status = "paid";
        }
      } else {
        fiatCaption = await freezeCaptionIfFiat(envelope.amountSats);
        status = "paid";
      }
      // One bubble per payment — merge by paymentId, else same amount in window (α77).
      if (direction === "in" && envelope.amountSats > 0) {
        const abs = Math.floor(envelope.amountSats);
        const byPid = envelope.paymentId
          ? findMessageByPaymentId(envelope.paymentId)
          : null;
        const recentAmt = findRecentInboundPaymentByAmount(
          contactId,
          abs,
          90_000,
        );
        // Always merge recent same-amount inbound (notify placeholder OR prior receipt).
        const recent = byPid ?? recentAmt;
        if (recent) {
          updateChatMessage(recent.id, {
            status,
            memo: envelope.memo ?? recent.memo,
            paymentId: envelope.paymentId || recent.paymentId,
            nostrEventId: wrapEventId,
            fiatCaption: fiatCaption ?? recent.fiatCaption,
          });
          if (envelope.relatedRequestId) {
            const req = findMessageByRequestId(
              contactId,
              envelope.relatedRequestId,
            );
            if (req) updateChatMessage(req.id, { status: "paid" });
          }
          noteChatInboundReceiptHint(contactId, abs);
          dismissClassicFundsNoticeIfChat(abs);
          // Home balance: ASP notify only (receipt must not double-apply — α76).
          return true;
        }
      } else if (envelope.paymentId) {
        const byPid = findMessageByPaymentId(envelope.paymentId);
        if (byPid) {
          updateChatMessage(byPid.id, {
            status,
            memo: envelope.memo ?? byPid.memo,
            nostrEventId: wrapEventId,
            fiatCaption: fiatCaption ?? byPid.fiatCaption,
          });
          return true;
        }
      }
      insertChatMessage({
        contactId,
        kind: "payment",
        direction,
        amountSats: envelope.amountSats,
        memo: envelope.memo ?? null,
        status,
        paymentId: envelope.paymentId,
        requestId: envelope.relatedRequestId ?? null,
        nostrEventId: wrapEventId,
        createdAt: sentAt,
        fiatCaption,
        bumpUnread: true,
      });
      if (envelope.relatedRequestId) {
        const req = findMessageByRequestId(contactId, envelope.relatedRequestId);
        if (req) updateChatMessage(req.id, { status: "paid" });
      }
      // Hard rule: chat pay → chat bubble only; clear mistaken classic toast (α70).
      if (direction === "in" && envelope.amountSats > 0) {
        noteChatInboundReceiptHint(contactId, envelope.amountSats);
        dismissClassicFundsNoticeIfChat(envelope.amountSats);
      }
      return true;
    }
    default:
      return false;
  }
}
