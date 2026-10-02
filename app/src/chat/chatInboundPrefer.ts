/**
 * Chat & Pay inbound must never use the classic Funds Received overlay.
 * Suppress-first when chat context exists; only allow classic after race fails (α71).
 */

import { catchUpGiftWraps } from "../contacts/contactShareWatch";
import { sleep } from "../wallet/arkMultiSend";
import {
  insertChatMessage,
  listChatMessages,
  listChatThreads,
  updateChatMessage,
  findMessageByRequestId,
  findRecentInboundPaymentByAmount,
} from "./chatStore";
import {
  getFocusedChatContactId,
  isChatThreadFocused,
} from "./chatThreadFocus";
import { newChatId } from "./types";

type ReceiptHint = { amountSats: number; contactId: string; at: number };

const recentReceiptHints: ReceiptHint[] = [];
const RECEIPT_HINT_TTL_MS = 5 * 60_000;
/** Brief wait for gift-wrap when no hot-thread bubble yet (α72). */
const CHAT_RACE_MS = 3_500;

/** amountSats → defer-until ms (persistBalance must not toast mid-race). */
const classicDeferUntil = new Map<number, number>();

function pruneHints(now = Date.now()): void {
  for (let i = recentReceiptHints.length - 1; i >= 0; i--) {
    if (now - recentReceiptHints[i].at > RECEIPT_HINT_TTL_MS) {
      recentReceiptHints.splice(i, 1);
    }
  }
}

function allThreads() {
  return [
    ...listChatThreads({ archived: false }),
    ...listChatThreads({ archived: true }),
  ];
}

/**
 * True when Pay in Chat is in use — classic arkade toast must defer to chat race.
 * (Active threads, unread, or recent messages.)
 */
export function hasChatPayContext(): boolean {
  try {
    const threads = listChatThreads({ archived: false });
    if (threads.length === 0) return false;
    const recent = Date.now() - 7 * 24 * 60 * 60_000;
    return threads.some(
      (t) =>
        t.unreadCount > 0 ||
        (t.lastMessageAt != null && t.lastMessageAt >= recent) ||
        (t.updatedAt != null && t.updatedAt >= recent),
    );
  } catch {
    return false;
  }
}

export function beginClassicChatDefer(
  amountSats: number,
  ms = CHAT_RACE_MS + 2_000,
): void {
  const abs = Math.floor(amountSats);
  if (!(abs > 0)) return;
  const until = Date.now() + Math.max(1_000, ms);
  const prev = classicDeferUntil.get(abs) ?? 0;
  classicDeferUntil.set(abs, Math.max(prev, until));
}

export function isClassicChatDeferPending(amountSats: number): boolean {
  const abs = Math.floor(amountSats);
  const until = classicDeferUntil.get(abs);
  if (until == null) return false;
  if (Date.now() >= until) {
    classicDeferUntil.delete(abs);
    return false;
  }
  return true;
}

export function endClassicChatDefer(amountSats: number): void {
  classicDeferUntil.delete(Math.floor(amountSats));
}

/** Call from payment_receipt ingest (inbound). */
export function noteChatInboundReceiptHint(
  contactId: string,
  amountSats: number,
): void {
  const abs = Math.abs(Math.floor(amountSats));
  if (!contactId || !(abs > 0)) return;
  pruneHints();
  recentReceiptHints.push({ amountSats: abs, contactId, at: Date.now() });
}

export function peekChatInboundReceiptHint(
  amountSats: number,
  newerThanMs = 120_000,
): ReceiptHint | null {
  pruneHints();
  const abs = Math.abs(Math.floor(amountSats));
  const since = Date.now() - Math.max(0, newerThanMs);
  for (let i = recentReceiptHints.length - 1; i >= 0; i--) {
    const h = recentReceiptHints[i];
    if (h.at < since) continue;
    if (Math.abs(h.amountSats - abs) > 1) continue;
    return h;
  }
  return null;
}

export function consumeChatInboundReceiptHint(
  amountSats: number,
  newerThanMs = 90_000,
): ReceiptHint | null {
  const h = peekChatInboundReceiptHint(amountSats, newerThanMs);
  if (!h) return null;
  const idx = recentReceiptHints.lastIndexOf(h);
  if (idx >= 0) recentReceiptHints.splice(idx, 1);
  return h;
}

/** Outbound pay-requests we published that still await payment. */
function findOpenPayRequestForAmount(amountSats: number): {
  contactId: string;
  requestId: string | null;
  messageId: string;
} | null {
  const abs = Math.abs(Math.floor(amountSats));
  if (!(abs > 0)) return null;
  const since = Date.now() - 24 * 60 * 60_000;
  for (const t of allThreads()) {
    const msgs = listChatMessages(t.contactId, 40);
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.kind !== "request" || m.direction !== "out") continue;
      if (m.createdAt < since) continue;
      if (
        m.status === "paid" ||
        m.status === "declined" ||
        m.status === "expired"
      ) {
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

/** Most recently active non-archived thread (for Ark-before-receipt bubbles). */
function findRecentActiveChatContact(
  newerThanMs = 2 * 60 * 60_000,
): string | null {
  const since = Date.now() - newerThanMs;
  const threads = listChatThreads({ archived: false })
    .filter((t) => (t.lastMessageAt ?? t.updatedAt ?? 0) >= since)
    .sort(
      (a, b) =>
        (b.lastMessageAt ?? b.updatedAt ?? 0) -
        (a.lastMessageAt ?? a.updatedAt ?? 0),
    );
  return threads[0]?.contactId ?? null;
}

function hasRecentInboundPaymentBubble(
  contactId: string,
  amountSats: number,
  newerThanMs = 120_000,
): boolean {
  return (
    findRecentInboundPaymentByAmount(contactId, amountSats, newerThanMs) != null
  );
}

/** Sync claim so Ark notify + gift-wrap cannot both insert the same amount (α74). */
const inboundBubbleClaims = new Map<string, number>();
/** Short race window only — two real 500-sat pays minutes apart must both show. */
const INBOUND_CLAIM_TTL_MS = 20_000;

function inboundClaimKey(contactId: string, amountSats: number): string {
  return `${contactId}:${Math.floor(amountSats)}`;
}

function tryClaimInboundBubble(contactId: string, amountSats: number): boolean {
  const key = inboundClaimKey(contactId, amountSats);
  const now = Date.now();
  for (const [k, at] of inboundBubbleClaims) {
    if (now - at > INBOUND_CLAIM_TTL_MS) inboundBubbleClaims.delete(k);
  }
  // Placeholder from Ark notify (no receipt yet) — merge, don't duplicate.
  const existing = findRecentInboundPaymentByAmount(contactId, amountSats, 90_000);
  if (existing && !existing.nostrEventId) {
    inboundBubbleClaims.set(key, now);
    return false;
  }
  if (inboundBubbleClaims.has(key)) return false;
  inboundBubbleClaims.set(key, now);
  return true;
}

/**
 * Create / ensure inbound chat payment bubble for a matched chat pay.
 * Returns true when classic Funds Received must be suppressed.
 */
export function ensureChatInboundBubble(opts: {
  contactId: string;
  amountSats: number;
  requestId?: string | null;
  paymentId?: string | null;
  status?: "paid" | "arriving";
}): boolean {
  const abs = Math.floor(opts.amountSats);
  if (!opts.contactId || !(abs > 0)) return false;
  if (!tryClaimInboundBubble(opts.contactId, abs)) {
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
    paymentId: opts.paymentId?.trim() || newChatId("pay"),
    requestId: opts.requestId ?? null,
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
 * Suppress-first race so Ark-before-giftwrap never flashes classic (α71).
 *
 * @param opts.forceClassicOk — POS/Receive awaiting payment may fall through to
 *   classic after the race if there is no chat match (do not hold forever).
 */
export async function preferChatInboundOverClassic(
  amountSats: number,
  opts?: { forceClassicOk?: boolean },
): Promise<boolean> {
  const abs = Math.floor(amountSats);
  if (!(abs > 0)) return false;

  beginClassicChatDefer(abs);

  // ChatThread open: show You received immediately on this contact (α72).
  if (isChatThreadFocused()) {
    const focused = getFocusedChatContactId();
    const open = findOpenPayRequestForAmount(abs);
    if (open) {
      ensureChatInboundBubble({
        contactId: open.contactId,
        amountSats: abs,
        requestId: open.requestId,
        status: "paid",
      });
    } else if (focused) {
      ensureChatInboundBubble({
        contactId: focused,
        amountSats: abs,
        status: "paid",
      });
    }
    return true;
  }

  const open = findOpenPayRequestForAmount(abs);
  if (open) {
    return ensureChatInboundBubble({
      contactId: open.contactId,
      amountSats: abs,
      requestId: open.requestId,
      status: "paid",
    });
  }

  if (peekChatInboundReceiptHint(abs, 120_000)) {
    console.warn("[basic] fundsNotice suppressed (chat receipt hint)", abs);
    return true;
  }

  // Immediate bubble on hottest chat thread — don't wait for NIP-17 (α72).
  // Receipt ingest upgrades/dedupes the same amount.
  if (hasChatPayContext()) {
    const hot = findRecentActiveChatContact();
    if (hot) {
      ensureChatInboundBubble({
        contactId: hot,
        amountSats: abs,
        status: "paid",
      });
      // Still kick catch-up in background for the real receipt (memo/txid).
      void catchUpGiftWraps({ force: true }).catch(() => {});
      console.warn("[basic] fundsNotice suppressed (hot chat bubble)", abs);
      return true;
    }
  }

  const started = Date.now();
  try {
    await catchUpGiftWraps({ force: true });
  } catch (e) {
    console.warn("[basic] chat inbound catchUp failed", e);
  }
  if (peekChatInboundReceiptHint(abs, 120_000)) {
    console.warn("[basic] fundsNotice suppressed (chat receipt after catchUp)", abs);
    return true;
  }
  for (const t of allThreads()) {
    if (hasRecentInboundPaymentBubble(t.contactId, abs, 90_000)) {
      console.warn("[basic] fundsNotice suppressed (chat bubble present)", abs);
      return true;
    }
  }

  const remain = CHAT_RACE_MS - (Date.now() - started);
  if (remain > 50) {
    await sleep(remain);
    if (peekChatInboundReceiptHint(abs, 120_000)) {
      console.warn("[basic] fundsNotice suppressed (chat receipt after race)", abs);
      return true;
    }
    for (const t of allThreads()) {
      if (hasRecentInboundPaymentBubble(t.contactId, abs, 90_000)) {
        console.warn("[basic] fundsNotice suppressed (chat bubble present)", abs);
        return true;
      }
    }
  }

  // Pay in Chat in use: hold classic — receipt/live wrap will own the bubble.
  // POS/Receive (forceClassicOk) may still show classic after a failed match.
  if (hasChatPayContext() && !opts?.forceClassicOk) {
    console.warn("[basic] fundsNotice suppressed (chat context hold)", abs);
    return true;
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
    bubble = allThreads().some((t) =>
      hasRecentInboundPaymentBubble(t.contactId, abs, 180_000),
    );
  }
  if (!hint && !bubble) return;
  console.warn("[basic] dismiss classic fundsNotice (chat receipt)", abs);
  dismissClassicNotice?.(abs);
}
