/**
 * Fiat Mode inbound chat payments: status-only while arriving/converting,
 * then settle with the real post-fee stable amount (never theoretical sats→fiat).
 *
 * All store I/O is best-effort: classic Receive auto-inbound must never fail
 * because a chat DB call threw.
 */

import type { ArkadeNetworkId } from "../config/network";
import { fiatStableForNetwork } from "../fiat/depixAssets";
import { i18n } from "../i18n/i18n";
import {
  listInboundPaymentsByStatus,
  updateChatMessage,
} from "./chatStore";

let autoInboundBusy = false;
let recentSettle: {
  caption: string;
  inboundSats: number;
  at: number;
} | null = null;

export function setAutoInboundBusy(busy: boolean): void {
  autoInboundBusy = Boolean(busy);
}

export function isAutoInboundBusy(): boolean {
  return autoInboundBusy;
}

/** Title while inbound Fiat payment has no settled amount yet. */
export function receivingFiatTitle(networkId: ArkadeNetworkId): string {
  const { displayCode } = fiatStableForNetwork(networkId);
  if (displayCode === "USD") return i18n.t("chat.receivingUsd");
  if (displayCode === "BRL") return i18n.t("chat.receivingBrl");
  return i18n.t("chat.receivingCode", { code: displayCode });
}

export function rememberRecentInboundFiatSettle(
  caption: string,
  inboundSats = 0,
): void {
  const c = caption.trim();
  if (!c) return;
  recentSettle = {
    caption: c,
    inboundSats: Math.floor(inboundSats) || 0,
    at: Date.now(),
  };
}

/** Late payment_receipt after auto-inbound already filled. */
export function consumeRecentInboundFiatSettle(
  withinMs = 120_000,
): string | null {
  if (!recentSettle) return null;
  if (Date.now() - recentSettle.at > withinMs) {
    recentSettle = null;
    return null;
  }
  const caption = recentSettle.caption;
  recentSettle = null;
  return caption;
}

/** Advance pending inbound Fiat payment cards to converting. */
export function markChatInboundFiatConverting(): void {
  try {
    const msgs = listInboundPaymentsByStatus(["arriving"]);
    for (const m of msgs) {
      updateChatMessage(m.id, { status: "converting" });
    }
  } catch (e) {
    console.warn("[basic] markChatInboundFiatConverting failed", e);
  }
}

/** After failed/incomplete auto-inbound, leave cards waiting again. */
export function revertChatInboundFiatConverting(): void {
  try {
    const msgs = listInboundPaymentsByStatus(["converting"]);
    for (const m of msgs) {
      updateChatMessage(m.id, { status: "arriving" });
    }
  } catch (e) {
    console.warn("[basic] revertChatInboundFiatConverting failed", e);
  }
}

/**
 * Settle the oldest (or sats-matched) inbound Fiat payment with the real
 * post-fee stable caption. Remembers settle when no card exists yet.
 */
export function settleChatInboundFiatPaid(
  caption: string,
  opts?: { inboundSats?: number },
): void {
  const c = caption.trim();
  if (!c) return;
  const inboundSats = Math.floor(opts?.inboundSats ?? 0);
  try {
    const msgs = listInboundPaymentsByStatus(["arriving", "converting"]);
    let target = msgs.length > 0 ? msgs[msgs.length - 1] : null;
    if (inboundSats > 0 && msgs.length > 1) {
      const match = msgs.find(
        (m) =>
          m.amountSats != null && Math.abs(m.amountSats - inboundSats) <= 80,
      );
      if (match) target = match;
    }
    if (target) {
      updateChatMessage(target.id, { status: "paid", fiatCaption: c });
      return;
    }
  } catch (e) {
    console.warn("[basic] settleChatInboundFiatPaid failed", e);
  }
  rememberRecentInboundFiatSettle(c, inboundSats);
}
