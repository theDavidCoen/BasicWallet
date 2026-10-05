/**
 * Publish bot → owner gift-wraps and mirror into the local bot thread as inbound.
 */

import { publishChatEnvelopeWithSk } from "../chat/chatNostr";
import { ensureChatThread, insertChatMessage } from "../chat/chatStore";
import { buildPayToJson } from "../chat/payToJson";
import type { ChatEnvelope, ChatTextEnvelope, PayRequestEnvelope } from "../chat/types";
import { CURSOR_BOT_CONTACT_ID } from "./botConstants";
import { loadBotKeyPair, readBotMeta } from "./botIdentity";

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

async function publishAsBot(envelope: ChatEnvelope): Promise<string> {
  const meta = await readBotMeta();
  const pair = await loadBotKeyPair();
  if (!meta?.enabled || !pair) {
    throw new Error("Cursor bot is not active.");
  }
  const pub = await withTimeout(
    publishChatEnvelopeWithSk(pair.sk, meta.ownerPubkey, envelope),
    PUBLISH_TIMEOUT_MS,
    "Bot publish",
  );
  return pub.eventId;
}

export async function botReplyText(body: string): Promise<void> {
  const text = body.trim();
  if (!text) return;
  const meta = await readBotMeta();
  if (!meta) return;
  ensureChatThread(CURSOR_BOT_CONTACT_ID, meta.botPubkey);
  const envelope: ChatTextEnvelope = {
    v: 1,
    type: "basic.wallet.chat.text",
    body: text.slice(0, 2000),
    sentAt: Date.now(),
    threadContactHint: CURSOR_BOT_CONTACT_ID,
  };
  try {
    const eventId = await publishAsBot(envelope);
    insertChatMessage({
      contactId: CURSOR_BOT_CONTACT_ID,
      kind: "text",
      direction: "in",
      bodyText: envelope.body,
      status: "sent",
      nostrEventId: eventId,
      bumpUnread: true,
    });
  } catch (e) {
    // Still show locally so the owner sees the reply even if relays flake.
    console.warn("[basic] bot text publish failed; inserting locally", e);
    insertChatMessage({
      contactId: CURSOR_BOT_CONTACT_ID,
      kind: "text",
      direction: "in",
      bodyText: envelope.body,
      status: "sent",
      bumpUnread: true,
    });
  }
}

export async function botReplyPayRequest(envelope: PayRequestEnvelope): Promise<void> {
  const meta = await readBotMeta();
  if (!meta) return;
  ensureChatThread(CURSOR_BOT_CONTACT_ID, meta.botPubkey);
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

  try {
    const eventId = await publishAsBot(envelope);
    insertChatMessage({
      contactId: CURSOR_BOT_CONTACT_ID,
      kind: "request",
      direction: "in",
      amountSats: envelope.amountSats,
      memo: envelope.memo ?? null,
      status: "pending",
      requestId: envelope.requestId,
      nostrEventId: eventId,
      payToJson,
      bumpUnread: true,
    });
  } catch (e) {
    console.warn("[basic] bot pay_request publish failed; inserting locally", e);
    insertChatMessage({
      contactId: CURSOR_BOT_CONTACT_ID,
      kind: "request",
      direction: "in",
      amountSats: envelope.amountSats,
      memo: envelope.memo ?? null,
      status: "pending",
      requestId: envelope.requestId,
      payToJson,
      bumpUnread: true,
    });
  }
}
