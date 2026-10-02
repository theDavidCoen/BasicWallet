/**
 * Reconcile false-failed / stuck outbound chat payments after ASP hang (α69).
 * Matches recent activity / pending-send stamps → flip bubble to paid.
 */

import type { ArkadeNetworkId } from "../config/network";
import {
  findRecentSendActivityId,
  readActivityFromDb,
} from "../account/activityStore";
import { findPendingSendStamp } from "../account/txMeta";
import {
  listOutboundPaymentsByStatus,
  updateChatMessage,
} from "./chatStore";
import { publishPaymentReceipt } from "./chatActions";

function activityMatchesMessage(
  networkId: ArkadeNetworkId,
  walletId: string,
  amountSats: number,
  messageCreatedAt: number,
): { id: string; createdAt: number } | null {
  const abs = Math.abs(amountSats);
  const rows = readActivityFromDb(networkId, { walletId, limit: 40 });
  const windowMs = 20 * 60_000;
  for (const r of rows) {
    if (!(r.amount < 0)) continue;
    if (Math.abs(Math.abs(r.amount) - abs) > 1) continue;
    if (r.tags.includes("lightning") || r.tags.includes("ln")) continue;
    const at = r.createdAt > 0 ? r.createdAt : 0;
    // Prefer activity near the chat bubble time (pending local rows may be 0).
    if (at > 0 && Math.abs(at - messageCreatedAt) > windowMs) continue;
    if (at > 0 && Date.now() - at > 30 * 60_000) continue;
    return { id: r.id, createdAt: at };
  }
  // Fallback: newest matching amount (findRecentSendActivityId).
  const id = findRecentSendActivityId(networkId, walletId, abs, "arkade");
  if (!id) return null;
  return { id, createdAt: 0 };
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
  for (const m of msgs) {
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
    if (!hit && !pending) continue;
    // Avoid claiming a still-in-flight convert as paid without activity evidence.
    if (m.status === "converting" && !hit) continue;

    const wasFailed = m.status === "failed";
    updateChatMessage(m.id, { status: "paid" });
    n += 1;
    console.warn("[basic] reconcile outbound chat → paid", {
      id: m.id.slice(0, 12),
      amount: m.amountSats,
      was: m.status,
      via: hit ? "activity" : "pending-stamp",
    });

    if (wasFailed && opts.republishReceipt !== false && m.paymentId) {
      void publishPaymentReceipt({
        contactId: m.contactId,
        paymentId: m.paymentId,
        amountSats: m.amountSats,
        memo: m.memo ?? undefined,
        txid: hit?.id,
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
 * Before a new chat send: if the same amount already settled (or is pending
 * mid-flight with activity evidence), settle the matching bubble and skip
 * wallet.send — prevents double-spend after false Failed (α69).
 */
export function findAlreadySettledOutbound(opts: {
  networkId: ArkadeNetworkId;
  walletId: string;
  contactId: string;
  amountSats: number;
  newerThanMs?: number;
}): { messageId: string; txid: string; paymentId: string | null } | null {
  const amount = Math.floor(opts.amountSats);
  if (!(amount > 0)) return null;
  const newerThanMs = opts.newerThanMs ?? 20 * 60_000;
  const pending = findPendingSendStamp(
    opts.networkId,
    opts.walletId,
    amount,
    newerThanMs,
  );
  const hit = activityMatchesMessage(
    opts.networkId,
    opts.walletId,
    amount,
    Date.now(),
  );
  if (!hit && !pending) return null;

  // Only unsettled bubbles — never block a deliberate second send of the same amount.
  const candidates = listOutboundPaymentsByStatus(
    ["failed", "sending", "converting"],
    newerThanMs,
  ).filter(
    (m) =>
      m.contactId === opts.contactId &&
      m.amountSats != null &&
      Math.abs(m.amountSats - amount) <= 1,
  );
  const open = candidates[0];
  if (!open) return null;
  // Require evidence: matching activity, or a pending stamp (hung SDK after accept).
  if (!hit && !pending) return null;
  updateChatMessage(open.id, { status: "paid" });
  return {
    messageId: open.id,
    txid: hit?.id ?? `pending:${pending?.at ?? Date.now()}`,
    paymentId: open.paymentId,
  };
}
