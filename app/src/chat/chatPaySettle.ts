/**
 * Pure helpers: when may a chat pay skip wallet.send because ASP already
 * settled? (α69 hang recovery). Xiaomi α92: a brand-new bubble must not
 * self-match a historical −amount Activity row.
 */

export const CHAT_SETTLE_WINDOW_MS = 20 * 60_000;
export const CHAT_SETTLE_MAX_AGE_MS = 30 * 60_000;
/** Activity may lead the bubble by a few seconds (clock / insert race). */
export const CHAT_SETTLE_PREDATE_SKEW_MS = 5_000;

export type ChatSettleActivityRow = {
  id: string;
  amount: number;
  createdAt: number;
  tags?: string[];
};

export type ChatSettleBubble = {
  id: string;
  contactId: string;
  amountSats: number | null;
  createdAt: number;
  paymentId: string | null;
  status: string;
};

/**
 * Instant Activity local-send row (SendScreen parity) only after a real spend
 * was applied. already-settled / prior-bubble hang recovery set skipLocalSpend.
 */
export function shouldRecordChatPayOptimisticActivity(opts: {
  skipLocalSpend?: boolean;
}): boolean {
  return !opts.skipLocalSpend;
}

/** True when an outbound activity row is evidence for this bubble (not history). */
export function activityRowMatchesOutboundBubble(input: {
  amountSats: number;
  bubbleCreatedAt: number;
  now: number;
  row: ChatSettleActivityRow;
}): boolean {
  const abs = Math.abs(Math.floor(input.amountSats));
  if (!(abs > 0)) return false;
  const r = input.row;
  if (!(r.amount < 0)) return false;
  if (Math.abs(Math.abs(r.amount) - abs) > 1) return false;
  const tags = r.tags ?? [];
  if (tags.includes("lightning") || tags.includes("ln")) return false;

  const at = r.createdAt > 0 ? r.createdAt : 0;
  const bubbleAt = input.bubbleCreatedAt > 0 ? input.bubbleCreatedAt : 0;
  const now = input.now;

  if (at > 0) {
    // Historical sends before this bubble must not count (α92 chat 2000).
    if (bubbleAt > 0 && at < bubbleAt - CHAT_SETTLE_PREDATE_SKEW_MS) {
      return false;
    }
    if (bubbleAt > 0 && at - bubbleAt > CHAT_SETTLE_WINDOW_MS) return false;
    if (now - at > CHAT_SETTLE_MAX_AGE_MS) return false;
    return true;
  }

  // Pending local row (createdAt 0): only while the bubble itself is recent.
  if (bubbleAt > 0 && now - bubbleAt > CHAT_SETTLE_WINDOW_MS) return false;
  return bubbleAt > 0;
}

export function pickAlreadySettledOutbound(input: {
  amountSats: number;
  contactId: string;
  /** Fresh send: never treat this brand-new bubble as prior settlement. */
  excludeMessageId?: string | null;
  /** Error recovery: prefer reconciling this message. */
  preferMessageId?: string | null;
  now: number;
  candidates: ChatSettleBubble[];
  activityRows: ChatSettleActivityRow[];
  pendingStampAt: number | null;
}): { messageId: string; txid: string; paymentId: string | null } | null {
  const amount = Math.floor(input.amountSats);
  if (!(amount > 0)) return null;

  const filtered = input.candidates.filter((m) => {
    if (input.excludeMessageId && m.id === input.excludeMessageId) return false;
    if (m.contactId !== input.contactId) return false;
    if (m.amountSats == null || !(m.amountSats > 0)) return false;
    if (Math.abs(m.amountSats - amount) > 1) return false;
    return (
      m.status === "failed" ||
      m.status === "sending" ||
      m.status === "converting"
    );
  });

  const prefer = input.preferMessageId
    ? filtered.find((m) => m.id === input.preferMessageId)
    : null;
  const ordered = prefer
    ? [prefer, ...filtered.filter((m) => m.id !== prefer.id)]
    : filtered;

  for (const open of ordered) {
    const hit =
      input.activityRows.find((row) =>
        activityRowMatchesOutboundBubble({
          amountSats: amount,
          bubbleCreatedAt: open.createdAt,
          now: input.now,
          row,
        }),
      ) ?? null;

    const pendingAt = input.pendingStampAt;
    const pendingOk =
      pendingAt != null &&
      pendingAt > 0 &&
      pendingAt >= open.createdAt - CHAT_SETTLE_PREDATE_SKEW_MS &&
      input.now - pendingAt <= CHAT_SETTLE_WINDOW_MS;

    if (!hit && !pendingOk) continue;
    // Converting without activity: still mid Fiat convert — do not claim paid.
    if (open.status === "converting" && !hit) continue;

    return {
      messageId: open.id,
      txid: hit?.id ?? `pending:${pendingAt ?? input.now}`,
      paymentId: open.paymentId,
    };
  }
  return null;
}
