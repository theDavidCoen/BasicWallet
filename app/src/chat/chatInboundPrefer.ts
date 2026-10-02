/**
 * Chat & Pay inbound must never use the classic Funds Received overlay.
 * Prefer chat bubble (+ banner/badge) whether or not ChatThread is focused (α70).
 */

import { catchUpGiftWraps } from "../contacts/contactShareWatch";
import { sleep } from "../wallet/arkMultiSend";
import {
  insertChatMessage,
  listChatMessages,
  listChatThreads,
  updateChatMessage,
  findMessageByRequestId,
} from "./chatStore";
import {
  getFocusedChatContactId,
  isChatThreadFocused,
} from "./chatThreadFocus";
import { newChatId } from "./types";

type ReceiptHint = { amountSats: number; contactId: string; at: number };

const recentReceiptHints: ReceiptHint[] = [];
const RECEIPT_HINT_TTL_MS = 5 * 60_000;
/** How long to race Nostr catch-up before allowing classic overlay (non-chat). */
const CHAT_RACE_MS = 2_200;

function pruneHints(now = Date.now()): void {
  for (let i = recentReceiptHints.length - 1; i >= 0; i--) {
    if (now - recentReceiptHints[i].at > RECEIPT_HINT_TTL_MS) {
      recentReceiptHints.splice(i, 1);
    }
  }
}

/** Call from payment_receipt ingest (any direction that creates our inbound). */
export function noteChatInboundReceiptHint(
  contactId: string,
  amountSats: number,
): void {
  const abs = Math.abs(Math.floor(amountSats));
  if (!contactId || !(abs > 0)) return;
  pruneHints();
  recentReceiptHints.push({ amountSats: abs, contactId, at: Date.now() });
}

export function consumeChatInboundReceiptHint(
  amountSats: number,
  newerThanMs = 90_000,
): ReceiptHint | null {
  pruneHints();
  const abs = Math.abs(Math.floor(amountSats));
  const since = Date.now() - Math.max(0, newerThanMs);
  for (let i = recentReceiptHints.length - 1; i >= 0; i--) {
    const h = recentReceiptHints[i];
    if (h.at < since) continue;
    if (Math.abs(h.amountSats - abs) > 1) continue;
    recentReceiptHints.splice(i, 1);
    return h;
  }
  return null;
}

/** Outbound pay-requests we published that still await payment. */
function findOpenPayRequestForAmount(amountSats: number): {
  contactId: string;
  requestId: string | null;
  messageId: string;
} | null {
  const abs = Math.abs(Math.floor(amountSats));
  if (!(abs > 0)) return null;
  const threads = [
    ...listChatThreads({ archived: false }),
    ...listChatThreads({ archived: true }),
  ];
  const since = Date.now() - 24 * 60 * 60_000;
  for (const t of threads) {
    const msgs = listChatMessages(t.contactId, 80);
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.kind !== "request" || m.direction !== "out") continue;
      if (m.createdAt < since) continue;
      if (m.status === "paid" || m.status === "declined" || m.status === "expired") {
        continue;
      }
      if (m.amountSats == null || Math.abs(m.amountSats - abs) > 1) continue;
      return {
        contactId: t.contactId,
        requestId: m.requestId,
        messageId: m.id,
      };
    }
  }
  return null;
}

function hasRecentInboundPaymentBubble(
  contactId: string,
  amountSats: number,
  newerThanMs = 120_000,
): boolean {
  const abs = Math.abs(Math.floor(amountSats));
  const since = Date.now() - newerThanMs;
  return listChatMessages(contactId, 40).some(
    (m) =>
      m.kind === "payment" &&
      m.direction === "in" &&
      m.createdAt >= since &&
      m.amountSats != null &&
      Math.abs(m.amountSats - abs) <= 1,
  );
}

/**
 * Create / ensure inbound chat payment bubble for a matched chat pay.
 * Returns true when classic Funds Received must be suppressed.
 */
export function ensureChatInboundBubble(opts: {
  contactId: string;
  amountSats: number;
  requestId?: string | null;
  status?: "paid" | "arriving";
}): boolean {
  const abs = Math.floor(opts.amountSats);
  if (!opts.contactId || !(abs > 0)) return false;
  if (hasRecentInboundPaymentBubble(opts.contactId, abs)) {
    noteChatInboundReceiptHint(opts.contactId, abs);
    return true;
  }
  const focused = getFocusedChatContactId();
  insertChatMessage({
    contactId: opts.contactId,
    kind: "payment",
    direction: "in",
    amountSats: abs,
    status: opts.status ?? "paid",
    paymentId: newChatId("pay"),
    requestId: opts.requestId ?? null,
    // Unread unless this exact thread is open (banner/badge still update elsewhere).
    bumpUnread: focused !== opts.contactId,
  });
  if (opts.requestId) {
    const req = findMessageByRequestId(opts.contactId, opts.requestId);
    if (req) updateChatMessage(req.id, { status: "paid" });
  }
  noteChatInboundReceiptHint(opts.contactId, abs);
  console.warn("[basic] chat inbound bubble (prefer over classic)", {
    contactId: opts.contactId.slice(0, 10),
    amount: abs,
  });
  return true;
}

/**
 * Hard rule: chat-originated inbound → chat UX only, never classic overlay.
 * Races a short Nostr catch-up so Ark-before-giftwrap still lands as a bubble.
 */
export async function preferChatInboundOverClassic(
  amountSats: number,
): Promise<boolean> {
  const abs = Math.floor(amountSats);
  if (!(abs > 0)) return false;

  // Already on ChatThread — overlay always suppressed (existing rule).
  if (isChatThreadFocused()) {
    // Still try to attach a bubble if a request matches.
    const open = findOpenPayRequestForAmount(abs);
    if (open) {
      ensureChatInboundBubble({
        contactId: open.contactId,
        amountSats: abs,
        requestId: open.requestId,
        status: "paid",
      });
    }
    return true;
  }

  // Open pay-request we sent — peer is paying us in chat.
  const open = findOpenPayRequestForAmount(abs);
  if (open) {
    return ensureChatInboundBubble({
      contactId: open.contactId,
      amountSats: abs,
      requestId: open.requestId,
      status: "paid",
    });
  }

  // Receipt already ingested (hint) — bubble exists or is en route.
  if (consumeChatInboundReceiptHint(abs, 120_000)) {
    console.warn("[basic] fundsNotice suppressed (chat receipt hint)", abs);
    return true;
  }

  // Race: catch up gift-wraps then re-check hint (Ark often beats NIP-17 by seconds).
  const started = Date.now();
  try {
    await catchUpGiftWraps({ force: true });
  } catch (e) {
    console.warn("[basic] chat inbound catchUp failed", e);
  }
  if (consumeChatInboundReceiptHint(abs, 120_000)) {
    console.warn("[basic] fundsNotice suppressed (chat receipt after catchUp)", abs);
    return true;
  }

  const remain = CHAT_RACE_MS - (Date.now() - started);
  if (remain > 50) {
    await sleep(remain);
    if (consumeChatInboundReceiptHint(abs, 120_000)) {
      console.warn("[basic] fundsNotice suppressed (chat receipt after race)", abs);
      return true;
    }
    // Live wrap may have inserted bubble without going through noteHint — scan threads.
    const threads = [
      ...listChatThreads({ archived: false }),
      ...listChatThreads({ archived: true }),
    ];
    for (const t of threads) {
      if (hasRecentInboundPaymentBubble(t.contactId, abs, 90_000)) {
        console.warn("[basic] fundsNotice suppressed (chat bubble present)", abs);
        return true;
      }
    }
  }

  return false;
}

/** After classic notice already shown: dismiss if chat receipt lands. */
export function shouldDismissClassicNoticeForChat(amountSats: number): boolean {
  const abs = Math.floor(amountSats);
  if (!(abs > 0)) return false;
  if (consumeChatInboundReceiptHint(abs, 180_000)) return true;
  const threads = [
    ...listChatThreads({ archived: false }),
    ...listChatThreads({ archived: true }),
  ];
  for (const t of threads) {
    if (hasRecentInboundPaymentBubble(t.contactId, abs, 180_000)) return true;
  }
  return false;
}

type DismissFn = (amountSats: number) => void;
let dismissClassicNotice: DismissFn | null = null;

/** WalletProvider registers so receipt ingest can clear a mistaken classic toast. */
export function registerClassicFundsNoticeDismiss(fn: DismissFn | null): void {
  dismissClassicNotice = fn;
}

export function dismissClassicFundsNoticeIfChat(amountSats: number): void {
  const abs = Math.floor(amountSats);
  if (!(abs > 0)) return;
  pruneHints();
  const hint = recentReceiptHints.some(
    (h) => Math.abs(h.amountSats - abs) <= 1 && Date.now() - h.at < 180_000,
  );
  let bubble = false;
  if (!hint) {
    const threads = [
      ...listChatThreads({ archived: false }),
      ...listChatThreads({ archived: true }),
    ];
    bubble = threads.some((t) =>
      hasRecentInboundPaymentBubble(t.contactId, abs, 180_000),
    );
  }
  if (!hint && !bubble) return;
  console.warn("[basic] dismiss classic fundsNotice (chat receipt)", abs);
  dismissClassicNotice?.(abs);
}
