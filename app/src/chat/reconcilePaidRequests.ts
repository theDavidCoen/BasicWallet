/**
 * One-time heal: when an outbound payment is already paid for a requestId,
 * settle the linked request card (pre-rc.9 left Request · pending + Pay/Decline).
 */

import {
  listChatMessages,
  markPayRequestPaid,
} from "./chatStore";

export function reconcilePaidPayRequests(contactId: string): number {
  const id = contactId.trim();
  if (!id) return 0;
  const msgs = listChatMessages(id, 200);
  const paidRequestIds = new Set<string>();
  for (const m of msgs) {
    if (
      m.kind === "payment" &&
      m.direction === "out" &&
      m.status === "paid" &&
      m.requestId?.trim()
    ) {
      paidRequestIds.add(m.requestId.trim());
    }
  }
  if (paidRequestIds.size === 0) return 0;
  let n = 0;
  for (const requestId of paidRequestIds) {
    const req = msgs.find(
      (m) =>
        m.kind === "request" &&
        m.requestId === requestId &&
        m.status !== "paid" &&
        m.status !== "declined" &&
        m.status !== "expired",
    );
    if (!req) continue;
    markPayRequestPaid(id, requestId);
    n += 1;
  }
  if (n > 0) {
    console.warn("[basic] reconcile paid pay-requests", {
      contactId: id.slice(0, 10),
      n,
    });
  }
  return n;
}
