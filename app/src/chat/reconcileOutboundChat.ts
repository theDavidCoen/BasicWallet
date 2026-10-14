/**
 * Reconcile false-failed / stuck outbound chat payments after ASP hang (α69).
 * Matches recent activity / pending-send stamps → flip bubble to paid.
 *
 * α93: never let a brand-new chat bubble self-match a historical −amount
 * Activity row (Xiaomi Pay in Chat 2000: chat showed paid, Home/Activity not).
 */

import type { ArkadeNetworkId } from "../config/network";
import { readActivityFromDb } from "../account/activityStore";
import { findPendingSendStamp } from "../account/txMeta";
import {
  listOutboundPaymentsByStatus,
  updateChatMessage,
  getChatMessage,
  markPayRequestPaid,
} from "./chatStore";
import { publishPaymentReceipt } from "./chatActions";
import {
  activityRowMatchesOutboundBubble,
  pendingStampMatchesFailedBubble,
  pickAlreadySettledOutbound,
  type ChatSettleActivityRow,
} from "./chatPaySettle";

function readOutboundActivityRows(
  networkId: ArkadeNetworkId,
  walletId: string,
): ChatSettleActivityRow[] {
  return readActivityFromDb(networkId, { walletId, limit: 40 }).map((r) => ({
    id: r.id,
    amount: r.amount,
    createdAt: r.createdAt,
    tags: r.tags,
  }));
}

function activityMatchesMessage(
  networkId: ArkadeNetworkId,
  walletId: string,
  amountSats: number,
  messageCreatedAt: number,
  now = Date.now(),
): { id: string; createdAt: number } | null {
  const rows = readOutboundActivityRows(networkId, walletId);
  for (const r of rows) {
    if (
      activityRowMatchesOutboundBubble({
        amountSats,
        bubbleCreatedAt: messageCreatedAt,
        now,
        row: r,
      })
    ) {
      return { id: r.id, createdAt: r.createdAt };
    }
  }
  return null;
}

/**
 * Flip failed/sending/converting outbound bubbles to paid when a matching
 * arkade send already settled locally (activity or pending-send stamp).
 */
export function reconcileOutboundChatPayments(opts: {
  networkId: ArkadeNetworkId;
  walletId: string;
  newerThanMs?: number;
  /** Also republish receipt for reconciled failed rows (best-effort). */
  republishReceipt?: boolean;
}): number {
  const newerThanMs = opts.newerThanMs ?? 45 * 60_000;
  const msgs = listOutboundPaymentsByStatus(
    ["failed", "sending", "converting"],
    newerThanMs,
  );
  let n = 0;
  // Newest first so a same-attempt failed bubble wins before older Max fails.
  const ordered = [...msgs].sort((a, b) => b.createdAt - a.createdAt);
  /** One stamp-only recovery per amount — never resurrect a stack of Max fails. */
  const stampRecoveredAmounts = new Set<number>();
  for (const m of ordered) {
    if (m.amountSats == null || !(m.amountSats > 0)) continue;
    const pending = findPendingSendStamp(
      opts.networkId,
      opts.walletId,
      m.amountSats,
      newerThanMs,
    );
    const hit = activityMatchesMessage(
      opts.networkId,
      opts.walletId,
      m.amountSats,
      m.createdAt,
    );
    // pendingSend is pre-send. Never use it for status=sending (false You sent).
    // For failed: stamp must be from the *same* attempt (near bubble createdAt).
    // A later Max retry stamp must not flip 3:48/3:49 fails + republish×N (5966).
    const amountKey = Math.floor(m.amountSats);
    const pendingOk =
      m.status === "failed" &&
      !stampRecoveredAmounts.has(amountKey) &&
      pendingStampMatchesFailedBubble({
        bubbleCreatedAt: m.createdAt,
        pendingStampAt: pending?.at ?? null,
        now: Date.now(),
      });
    if (!hit && !pendingOk) continue;
    // Converting / sending: require activity evidence — never stamp-only.
    if ((m.status === "converting" || m.status === "sending") && !hit) continue;

    const was = m.status;
    const via = hit ? "activity" : "pending-stamp-failed";
    updateChatMessage(m.id, { status: "paid" });
    // Payment bubbles share request_id with the request card — settle it too
    // (α77 hang path used to flip "You sent" while Request stayed pending).
    markPayRequestPaid(m.contactId, m.requestId);
    if (!hit) stampRecoveredAmounts.add(amountKey);
    n += 1;
    console.warn("[basic] reconcile outbound chat → paid", {
      id: m.id.slice(0, 12),
      amount: m.amountSats,
      was,
      via,
    });

    // Only republish when activity proves settle. Stamp-only recovery has no
    // proof the peer should get a receipt (failed Max never spent).
    if (opts.republishReceipt !== false && m.paymentId && hit) {
      void publishPaymentReceipt({
        contactId: m.contactId,
        paymentId: m.paymentId,
        amountSats: m.amountSats,
        memo: m.memo ?? undefined,
        txid: hit.id,
        rail: "arkade",
        relatedRequestId: m.requestId ?? undefined,
      }).catch((e) => {
        console.warn("[basic] reconcile receipt republish failed", e);
      });
    }
  }
  return n;
}

/**
 * Before a new chat send: if a *prior* unsettled bubble of the same amount
 * already has settlement evidence, mark it paid and skip wallet.send.
 * The brand-new localMessageId is excluded so history cannot false-skip.
 */
export function findAlreadySettledOutbound(opts: {
  networkId: ArkadeNetworkId;
  walletId: string;
  contactId: string;
  amountSats: number;
  newerThanMs?: number;
  /** Fresh send bubble — never treat as prior settlement (α93). */
  excludeMessageId?: string | null;
  /** After send error: prefer reconciling this message. */
  preferMessageId?: string | null;
}): { messageId: string; txid: string; paymentId: string | null } | null {
  const amount = Math.floor(opts.amountSats);
  if (!(amount > 0)) return null;
  const newerThanMs = opts.newerThanMs ?? 20 * 60_000;
  const now = Date.now();

  const pending = findPendingSendStamp(
    opts.networkId,
    opts.walletId,
    amount,
    newerThanMs,
  );

  const candidates = listOutboundPaymentsByStatus(
    ["failed", "sending", "converting"],
    newerThanMs,
  ).map((m) => ({
    id: m.id,
    contactId: m.contactId,
    amountSats: m.amountSats,
    createdAt: m.createdAt,
    paymentId: m.paymentId,
    status: m.status ?? "sending",
  }));

  // Recovery may need the current message even when exclude is also set.
  if (
    opts.preferMessageId &&
    !candidates.some((m) => m.id === opts.preferMessageId)
  ) {
    const cur = getChatMessage(opts.preferMessageId);
    if (cur) {
      candidates.unshift({
        id: cur.id,
        contactId: cur.contactId,
        amountSats: cur.amountSats,
        createdAt: cur.createdAt,
        paymentId: cur.paymentId,
        status: cur.status ?? "sending",
      });
    }
  }

  const picked = pickAlreadySettledOutbound({
    amountSats: amount,
    contactId: opts.contactId,
    excludeMessageId: opts.excludeMessageId,
    preferMessageId: opts.preferMessageId,
    now,
    candidates,
    activityRows: readOutboundActivityRows(opts.networkId, opts.walletId),
    pendingStampAt: pending?.at ?? null,
  });
  if (!picked) return null;

  updateChatMessage(picked.messageId, { status: "paid" });
  const paidMsg = getChatMessage(picked.messageId);
  if (paidMsg?.requestId) {
    markPayRequestPaid(paidMsg.contactId, paidMsg.requestId);
  }
  return picked;
}
