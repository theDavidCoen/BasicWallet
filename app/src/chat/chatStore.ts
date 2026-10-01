/**
 * Pay in Chat local store — SQLCipher account DB (mainnet file, like Contacts).
 */

import { getAccountDb } from "../account/accountDb";
import type { ArkadeNetworkId } from "../config/network";
import { getFocusedChatContactId } from "./chatThreadFocus";
import {
  type ChatDirection,
  type ChatMessage,
  type ChatMessageKind,
  type ChatMessageStatus,
  type ChatThread,
  newChatId,
} from "./types";

const CHAT_NETWORK: ArkadeNetworkId = "mainnet";

function db() {
  return getAccountDb(CHAT_NETWORK);
}

type ThreadRow = {
  contact_id: string;
  peer_pubkey: string | null;
  last_message_at: number | null;
  unread_count: number;
  archived: number | null;
  created_at: number;
  updated_at: number;
};

type MessageRow = {
  id: string;
  contact_id: string;
  kind: string;
  direction: string;
  body_text: string | null;
  amount_sats: number | null;
  fiat_caption: string | null;
  memo: string | null;
  status: string | null;
  request_id: string | null;
  payment_id: string | null;
  nostr_event_id: string | null;
  created_at: number;
  updated_at: number;
  pay_to_json: string | null;
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeChatStore(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch (e) {
      console.warn("[basic] chat store listener failed", e);
    }
  }
}

function rowToThread(r: ThreadRow): ChatThread {
  return {
    contactId: r.contact_id,
    peerPubkey: r.peer_pubkey,
    lastMessageAt: r.last_message_at,
    unreadCount: r.unread_count,
    archived: (r.archived ?? 0) !== 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToMessage(r: MessageRow): ChatMessage {
  return {
    id: r.id,
    contactId: r.contact_id,
    kind: r.kind as ChatMessageKind,
    direction: r.direction as ChatDirection,
    bodyText: r.body_text,
    amountSats: r.amount_sats,
    fiatCaption: r.fiat_caption,
    memo: r.memo,
    status: (r.status as ChatMessageStatus | null) ?? null,
    requestId: r.request_id,
    paymentId: r.payment_id,
    nostrEventId: r.nostr_event_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    payToJson: r.pay_to_json,
  };
}

export function ensureChatThread(
  contactId: string,
  peerPubkey?: string | null,
): ChatThread {
  const database = db();
  const existing = database.getFirstSync<ThreadRow>(
    `SELECT * FROM chat_thread WHERE contact_id = ?`,
    [contactId],
  );
  const now = Date.now();
  if (existing) {
    if (peerPubkey && peerPubkey !== existing.peer_pubkey) {
      database.runSync(
        `UPDATE chat_thread SET peer_pubkey = ?, updated_at = ? WHERE contact_id = ?`,
        [peerPubkey.toLowerCase(), now, contactId],
      );
      notify();
      return {
        ...rowToThread(existing),
        peerPubkey: peerPubkey.toLowerCase(),
        updatedAt: now,
      };
    }
    return rowToThread(existing);
  }
  database.runSync(
    `INSERT INTO chat_thread (contact_id, peer_pubkey, last_message_at, unread_count, archived, created_at, updated_at)
     VALUES (?, ?, NULL, 0, 0, ?, ?)`,
    [contactId, peerPubkey?.toLowerCase() ?? null, now, now],
  );
  notify();
  return {
    contactId,
    peerPubkey: peerPubkey?.toLowerCase() ?? null,
    lastMessageAt: null,
    unreadCount: 0,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function listChatThreads(opts?: { archived?: boolean }): ChatThread[] {
  const archived = opts?.archived === true ? 1 : 0;
  const rows = db().getAllSync<ThreadRow>(
    `SELECT * FROM chat_thread
     WHERE COALESCE(archived, 0) = ?
     ORDER BY COALESCE(last_message_at, updated_at) DESC`,
    [archived],
  );
  return rows.map(rowToThread);
}

export function setChatThreadArchived(contactId: string, archived: boolean): void {
  ensureChatThread(contactId);
  db().runSync(
    `UPDATE chat_thread SET archived = ?, updated_at = ? WHERE contact_id = ?`,
    [archived ? 1 : 0, Date.now(), contactId],
  );
  notify();
}

export function countArchivedChatThreads(): number {
  const row = db().getFirstSync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM chat_thread WHERE COALESCE(archived, 0) = 1`,
  );
  return row?.n ?? 0;
}

export function getChatThread(contactId: string): ChatThread | null {
  const row = db().getFirstSync<ThreadRow>(
    `SELECT * FROM chat_thread WHERE contact_id = ?`,
    [contactId],
  );
  return row ? rowToThread(row) : null;
}

export function listChatMessages(contactId: string, limit = 200): ChatMessage[] {
  const rows = db().getAllSync<MessageRow>(
    `SELECT * FROM chat_message WHERE contact_id = ? ORDER BY created_at ASC LIMIT ?`,
    [contactId, limit],
  );
  return rows.map(rowToMessage);
}

export function getChatMessage(id: string): ChatMessage | null {
  const row = db().getFirstSync<MessageRow>(`SELECT * FROM chat_message WHERE id = ?`, [id]);
  return row ? rowToMessage(row) : null;
}

export function findMessageByNostrEventId(eventId: string): ChatMessage | null {
  const row = db().getFirstSync<MessageRow>(
    `SELECT * FROM chat_message WHERE nostr_event_id = ? LIMIT 1`,
    [eventId],
  );
  return row ? rowToMessage(row) : null;
}

export function findMessageByRequestId(
  contactId: string,
  requestId: string,
): ChatMessage | null {
  const row = db().getFirstSync<MessageRow>(
    `SELECT * FROM chat_message WHERE contact_id = ? AND request_id = ? LIMIT 1`,
    [contactId, requestId],
  );
  return row ? rowToMessage(row) : null;
}

export type InsertChatMessageInput = {
  id?: string;
  contactId: string;
  kind: ChatMessageKind;
  direction: ChatDirection;
  bodyText?: string | null;
  amountSats?: number | null;
  fiatCaption?: string | null;
  memo?: string | null;
  status?: ChatMessageStatus | null;
  requestId?: string | null;
  paymentId?: string | null;
  nostrEventId?: string | null;
  createdAt?: number;
  payToJson?: string | null;
  bumpUnread?: boolean;
};

export function insertChatMessage(input: InsertChatMessageInput): ChatMessage {
  if (input.nostrEventId) {
    const dup = findMessageByNostrEventId(input.nostrEventId);
    if (dup) return dup;
  }
  ensureChatThread(input.contactId);
  const now = Date.now();
  const id = input.id ?? newChatId("m");
  const createdAt = input.createdAt ?? now;
  db().runSync(
    `INSERT INTO chat_message (
      id, contact_id, kind, direction, body_text, amount_sats, fiat_caption, memo,
      status, request_id, payment_id, nostr_event_id, created_at, updated_at, pay_to_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.contactId,
      input.kind,
      input.direction,
      input.bodyText ?? null,
      input.amountSats ?? null,
      input.fiatCaption ?? null,
      input.memo ?? null,
      input.status ?? null,
      input.requestId ?? null,
      input.paymentId ?? null,
      input.nostrEventId ?? null,
      createdAt,
      now,
      input.payToJson ?? null,
    ],
  );
  // Do not bump unread for the thread the user is currently reading.
  const focusedId = getFocusedChatContactId();
  const unreadBump =
    input.bumpUnread &&
    input.direction === "in" &&
    focusedId !== input.contactId
      ? 1
      : 0;
  db().runSync(
    `UPDATE chat_thread SET
      last_message_at = ?,
      updated_at = ?,
      unread_count = unread_count + ?
     WHERE contact_id = ?`,
    [createdAt, now, unreadBump, input.contactId],
  );
  notify();
  return getChatMessage(id)!;
}

export function updateChatMessage(
  id: string,
  patch: Partial<{
    bodyText: string | null;
    amountSats: number | null;
    fiatCaption: string | null;
    memo: string | null;
    status: ChatMessageStatus | null;
    paymentId: string | null;
    nostrEventId: string | null;
    payToJson: string | null;
  }>,
): ChatMessage | null {
  const existing = getChatMessage(id);
  if (!existing) return null;
  const now = Date.now();
  const next = {
    bodyText: patch.bodyText !== undefined ? patch.bodyText : existing.bodyText,
    amountSats: patch.amountSats !== undefined ? patch.amountSats : existing.amountSats,
    fiatCaption: patch.fiatCaption !== undefined ? patch.fiatCaption : existing.fiatCaption,
    memo: patch.memo !== undefined ? patch.memo : existing.memo,
    status: patch.status !== undefined ? patch.status : existing.status,
    paymentId: patch.paymentId !== undefined ? patch.paymentId : existing.paymentId,
    nostrEventId:
      patch.nostrEventId !== undefined ? patch.nostrEventId : existing.nostrEventId,
    payToJson: patch.payToJson !== undefined ? patch.payToJson : existing.payToJson,
  };
  db().runSync(
    `UPDATE chat_message SET
      body_text = ?, amount_sats = ?, fiat_caption = ?, memo = ?, status = ?,
      payment_id = ?, nostr_event_id = ?, pay_to_json = ?, updated_at = ?
     WHERE id = ?`,
    [
      next.bodyText,
      next.amountSats,
      next.fiatCaption,
      next.memo,
      next.status,
      next.paymentId,
      next.nostrEventId,
      next.payToJson,
      now,
      id,
    ],
  );
  db().runSync(`UPDATE chat_thread SET updated_at = ? WHERE contact_id = ?`, [
    now,
    existing.contactId,
  ]);
  notify();
  return getChatMessage(id);
}

export function clearThreadUnread(contactId: string): void {
  const row = db().getFirstSync<{ unread_count: number }>(
    `SELECT unread_count FROM chat_thread WHERE contact_id = ?`,
    [contactId],
  );
  if (!row || row.unread_count === 0) return;
  db().runSync(
    `UPDATE chat_thread SET unread_count = 0, updated_at = ? WHERE contact_id = ?`,
    [Date.now(), contactId],
  );
  notify();
}

/** Threads with unread_count > 0 (active + archived). */
export function listUnreadChatThreads(): ChatThread[] {
  const rows = db().getAllSync<ThreadRow>(
    `SELECT * FROM chat_thread
     WHERE unread_count > 0
     ORDER BY COALESCE(last_message_at, updated_at) DESC`,
  );
  return rows.map(rowToThread);
}

export type UnreadChatSummary = {
  threadCount: number;
  totalUnread: number;
  /** When exactly one thread has unread — banner can deep-link to it. */
  singleContactId: string | null;
  hasText: boolean;
  hasPaymentRequest: boolean;
};

/**
 * Home banner input: unread text and/or payment requests across threads.
 * Uses last N inbound messages per thread (N = unread_count) to classify kinds.
 */
export function summarizeUnreadChatActivity(): UnreadChatSummary {
  const threads = listUnreadChatThreads();
  let hasText = false;
  let hasPaymentRequest = false;
  let totalUnread = 0;

  for (const t of threads) {
    totalUnread += t.unreadCount;
    const limit = Math.max(1, Math.min(t.unreadCount, 50));
    const rows = db().getAllSync<{ kind: string }>(
      `SELECT kind FROM chat_message
       WHERE contact_id = ? AND direction = 'in'
       ORDER BY created_at DESC LIMIT ?`,
      [t.contactId, limit],
    );
    for (const r of rows) {
      if (r.kind === "text") hasText = true;
      if (r.kind === "request") hasPaymentRequest = true;
    }
  }

  // Unread without text/request (e.g. payment receipt) still surfaces as message.
  if (totalUnread > 0 && !hasText && !hasPaymentRequest) {
    hasText = true;
  }

  return {
    threadCount: threads.length,
    totalUnread,
    singleContactId: threads.length === 1 ? threads[0]!.contactId : null,
    hasText,
    hasPaymentRequest,
  };
}

export type ChatOutboxItem = {
  id: string;
  payloadJson: string;
  recipientPubkey: string;
  attempts: number;
  nextAttemptAt: number | null;
  lastError: string | null;
  contactId: string | null;
  localMessageId: string | null;
};

export function enqueueChatOutbox(input: {
  payloadJson: string;
  recipientPubkey: string;
  contactId?: string | null;
  localMessageId?: string | null;
}): string {
  const id = newChatId("out");
  db().runSync(
    `INSERT INTO chat_outbox (id, payload_json, recipient_pubkey, attempts, next_attempt_at, last_error, contact_id, local_message_id)
     VALUES (?, ?, ?, 0, ?, NULL, ?, ?)`,
    [
      id,
      input.payloadJson,
      input.recipientPubkey.toLowerCase(),
      Date.now(),
      input.contactId ?? null,
      input.localMessageId ?? null,
    ],
  );
  return id;
}

export function listDueChatOutbox(now = Date.now()): ChatOutboxItem[] {
  const rows = db().getAllSync<{
    id: string;
    payload_json: string;
    recipient_pubkey: string;
    attempts: number;
    next_attempt_at: number | null;
    last_error: string | null;
    contact_id: string | null;
    local_message_id: string | null;
  }>(
    `SELECT * FROM chat_outbox
     WHERE next_attempt_at IS NULL OR next_attempt_at <= ?
     ORDER BY next_attempt_at ASC LIMIT 20`,
    [now],
  );
  return rows.map((r) => ({
    id: r.id,
    payloadJson: r.payload_json,
    recipientPubkey: r.recipient_pubkey,
    attempts: r.attempts,
    nextAttemptAt: r.next_attempt_at,
    lastError: r.last_error,
    contactId: r.contact_id,
    localMessageId: r.local_message_id,
  }));
}

export function removeChatOutbox(id: string): void {
  db().runSync(`DELETE FROM chat_outbox WHERE id = ?`, [id]);
}

export function bumpChatOutboxFailure(id: string, error: string): void {
  const row = db().getFirstSync<{ attempts: number }>(
    `SELECT attempts FROM chat_outbox WHERE id = ?`,
    [id],
  );
  const attempts = (row?.attempts ?? 0) + 1;
  const delay = Math.min(60_000 * attempts, 15 * 60_000);
  db().runSync(
    `UPDATE chat_outbox SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?`,
    [attempts, Date.now() + delay, error.slice(0, 400), id],
  );
}
