/**
 * Resolve pay destination for chat Send / Pay.
 * Prefer contact ark → request preferredReceive / reply → else error (honest).
 *
 * α75: confirm before You sent (no optimistic lie). Fast spend-drop while ASP
 * polls are paused. One NIP-17 receipt after settle. Dust/send-max via plan.
 */

import { isValidArkAddress } from "@arkade-os/sdk";
import type { ArkadeNetworkId } from "../config/network";
import { getContact } from "../contacts/contactStore";
import { requireUserPresence } from "../security/userPresence";
import {
  DEFAULT_MIN_VTXO_SATS,
  formatSendError,
  prepareDustSafeSend,
  readMinVtxoSats,
  readSpendableAvailable,
  waitForSendOrSpendDrop,
  type SendRecipient,
} from "../wallet/arkMultiSend";
import type { BasicWallet } from "../wallet/hdWallet";
import {
  notePendingSendFromThisDevice,
  recordSentFromThisDevice,
} from "../account/txMeta";
import {
  recordOptimisticArkadeSend,
  upgradeLatestPendingSendTxid,
} from "../account/activityStore";
import { contactArkAddress, silentlyUpsertContactArkFromChat } from "./contactPeer";
import {
  insertChatMessage,
  findMessageByRequestId,
  updateChatMessage,
  getChatMessage,
} from "./chatStore";
import { publishPaymentReceipt, replyPayRequestWithAddress } from "./chatActions";
import { newChatId } from "./types";
import { findAlreadySettledOutbound } from "./reconcileOutboundChat";
import { shouldRecordChatPayOptimisticActivity } from "./chatPaySettle";

export type ChatPayWalletHooks = {
  wallet: BasicWallet;
  walletId: string;
  networkId: ArkadeNetworkId;
  spendable: number | null;
  beginOutboundSend: () => void;
  endOutboundSend: () => void;
  applyLocalSpend: (sats: number) => void;
  getFreshArkAddress: () => Promise<string>;
  bumpActivity?: () => void;
  /** Optional: rematerialize history after ASP pause clears (classic Send parity). */
  refreshActivity?: () => Promise<void>;
};

function parsePayToArk(json: string | null | undefined): string | null {
  if (!json) return null;
  try {
    const payTo = JSON.parse(json) as { kind?: string; value?: string };
    if (payTo.kind === "ark" && payTo.value && isValidArkAddress(payTo.value)) {
      return payTo.value;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function parsePayToBolt11(json: string | null | undefined): string | null {
  if (!json) return null;
  try {
    const payTo = JSON.parse(json) as { kind?: string; value?: string };
    if (payTo.kind === "bolt11" && typeof payTo.value === "string") {
      const v = payTo.value.trim();
      if (v.length > 0) return v;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export type ChatPayTarget =
  | { kind: "ark"; address: string; source: "contact" | "request" }
  | { kind: "bolt11"; invoice: string; source: "request" };

/**
 * Resolve pay destination for chat Send / Pay.
 * Request-attached bolt11 (bot Bitrefill invoices) wins over contact ark.
 */
export function resolveChatPayTarget(opts: {
  contactId: string;
  requestId?: string | null;
}): ChatPayTarget {
  const contact = getContact(opts.contactId);
  if (!contact) throw new Error("Contact not found.");

  if (opts.requestId) {
    const msg = findMessageByRequestId(opts.contactId, opts.requestId);
    const bolt11 = parsePayToBolt11(msg?.payToJson);
    if (bolt11) {
      return { kind: "bolt11", invoice: bolt11, source: "request" };
    }
    const fromReq = parsePayToArk(msg?.payToJson);
    if (fromReq) {
      silentlyUpsertContactArkFromChat(opts.contactId, fromReq);
      return { kind: "ark", address: fromReq, source: "request" };
    }
  }

  const stored = contactArkAddress(contact);
  if (stored && isValidArkAddress(stored)) {
    return { kind: "ark", address: stored, source: "contact" };
  }

  throw new Error(
    "No ark address or Lightning invoice for this request. They need to share an ark… address (or include one on the request).",
  );
}

export function resolveChatPayDestination(opts: {
  contactId: string;
  requestId?: string | null;
}): { address: string; source: "contact" | "request" } {
  const target = resolveChatPayTarget(opts);
  if (target.kind !== "ark") {
    throw new Error(
      "This request is a Lightning invoice. Pay it from the request card.",
    );
  }
  return { address: target.address, source: target.source };
}

export async function shareFreshArkForRequest(opts: {
  contactId: string;
  requestId: string;
  getFreshArkAddress: () => Promise<string>;
}): Promise<string> {
  const addr = await opts.getFreshArkAddress();
  if (!isValidArkAddress(addr)) throw new Error("Could not get a receive address.");
  await replyPayRequestWithAddress({
    contactId: opts.contactId,
    requestId: opts.requestId,
    arkAddress: addr,
  });
  const existing = findMessageByRequestId(opts.contactId, opts.requestId);
  if (existing) {
    updateChatMessage(existing.id, {
      payToJson: JSON.stringify({ kind: "ark", value: addr }),
    });
  }
  return addr;
}

function finalizeChatPayPaid(opts: {
  contactId: string;
  amountSats: number;
  memo?: string;
  requestId?: string | null;
  fiatCaption?: string | null;
  localMessageId?: string | null;
  paymentId: string;
  txid: string;
  address?: string;
  applyLocalSpend?: (sats: number) => void;
  bumpActivity?: () => void;
  networkId: ArkadeNetworkId;
  walletId: string;
  skipLocalSpend?: boolean;
  skipReceipt?: boolean;
}): void {
  if (!opts.skipLocalSpend) {
    opts.applyLocalSpend?.(opts.amountSats);
  }
  if (opts.txid && !opts.txid.startsWith("pending:")) {
    recordSentFromThisDevice(opts.networkId, opts.walletId, opts.txid);
  }

  // Classic SendScreen parity: instant wallet-scoped Activity row after a real
  // spend. skipLocalSpend gates already-settled / prior-bubble hang recovery.
  if (
    shouldRecordChatPayOptimisticActivity({
      skipLocalSpend: opts.skipLocalSpend,
    })
  ) {
    try {
      const activityId = recordOptimisticArkadeSend(
        opts.networkId,
        opts.walletId,
        {
          amountSats: opts.amountSats,
          txid: opts.txid,
          address: opts.address,
          recipients: opts.address
            ? [{ address: opts.address, amount: opts.amountSats }]
            : undefined,
        },
      );
      if (
        (activityId.startsWith("pending:") ||
          activityId.startsWith("local-send:")) &&
        /^[0-9a-fA-F]{64}$/.test(opts.txid)
      ) {
        upgradeLatestPendingSendTxid(
          opts.networkId,
          opts.walletId,
          opts.txid,
        );
      }
    } catch (e) {
      console.warn("[basic] chat optimistic send activity failed", e);
    }
  }

  if (opts.localMessageId) {
    updateChatMessage(opts.localMessageId, {
      amountSats: opts.amountSats,
      memo: opts.memo?.trim() || null,
      status: "paid",
      paymentId: opts.paymentId,
      fiatCaption: opts.fiatCaption ?? null,
    });
  } else {
    insertChatMessage({
      contactId: opts.contactId,
      kind: "payment",
      direction: "out",
      amountSats: opts.amountSats,
      memo: opts.memo?.trim() || null,
      status: "paid",
      paymentId: opts.paymentId,
      requestId: opts.requestId ?? null,
      fiatCaption: opts.fiatCaption ?? null,
    });
  }

  if (opts.requestId) {
    const req = findMessageByRequestId(opts.contactId, opts.requestId);
    if (req) updateChatMessage(req.id, { status: "paid" });
  }

  if (!opts.skipReceipt) {
    void publishPaymentReceipt({
      contactId: opts.contactId,
      paymentId: opts.paymentId,
      amountSats: opts.amountSats,
      memo: opts.memo,
      txid: opts.txid.startsWith("pending:") ? undefined : opts.txid,
      rail: "arkade",
      relatedRequestId: opts.requestId ?? undefined,
    });
  }

  opts.bumpActivity?.();
}

async function proveSpendDropped(
  wallet: BasicWallet,
  prevAvailable: number | null,
  payAmount: number,
): Promise<boolean> {
  if (prevAvailable == null || !(prevAvailable > 0)) return false;
  // Xiaomi often times out short vtxo reads during ASP pause — retry (α77).
  for (const ms of [5_000, 10_000]) {
    const avail = await readSpendableAvailable(wallet, { timeoutMs: ms });
    if (avail == null) continue;
    if (avail <= prevAvailable - payAmount + 1) return true;
  }
  return false;
}

export async function executeChatPay(opts: {
  contactId: string;
  amountSats: number;
  memo?: string;
  requestId?: string | null;
  hooks: ChatPayWalletHooks;
  skipPresence?: boolean;
  fiatCaption?: string | null;
  localMessageId?: string | null;
  paymentId?: string | null;
}): Promise<{ txid: string; paymentId: string; address: string }> {
  const amount = Math.floor(opts.amountSats);
  if (!(amount > 0)) throw new Error("Enter a positive amount.");

  const destTarget = resolveChatPayTarget({
    contactId: opts.contactId,
    requestId: opts.requestId,
  });
  if (destTarget.kind !== "ark") {
    throw new Error(
      "This request is a Lightning invoice. Use the Lightning pay path.",
    );
  }
  const dest = {
    address: destTarget.address,
    source: destTarget.source,
  };

  const { wallet, walletId, networkId } = opts.hooks;

  if (!opts.skipPresence) {
    const auth = await requireUserPresence("Confirm send");
    if (!auth.ok) {
      throw new Error(auth.reason || "Authentication required");
    }
  }

  const paymentId = opts.paymentId?.trim() || newChatId("pay");

  // Exclude the brand-new bubble — historical −amount Activity must not
  // false-skip a deliberate send (Xiaomi α92: chat paid, Home/Activity not).
  const already = findAlreadySettledOutbound({
    networkId,
    walletId,
    contactId: opts.contactId,
    amountSats: amount,
    excludeMessageId: opts.localMessageId,
  });
  if (already) {
    console.warn("[basic] chat pay skip (already settled)", {
      amount,
      messageId: already.messageId.slice(0, 12),
      txid: already.txid.slice(0, 16),
    });
    if (opts.localMessageId && opts.localMessageId !== already.messageId) {
      updateChatMessage(opts.localMessageId, { status: "paid" });
    }
    finalizeChatPayPaid({
      contactId: opts.contactId,
      amountSats: amount,
      memo: opts.memo,
      requestId: opts.requestId,
      fiatCaption: opts.fiatCaption,
      localMessageId: opts.localMessageId ?? already.messageId,
      paymentId: already.paymentId ?? paymentId,
      txid: already.txid,
      address: dest.address,
      applyLocalSpend: opts.hooks.applyLocalSpend,
      bumpActivity: opts.hooks.bumpActivity,
      networkId,
      walletId,
      skipLocalSpend: true,
    });
    return {
      txid: already.txid,
      paymentId: already.paymentId ?? paymentId,
      address: dest.address,
    };
  }

  if (opts.localMessageId) {
    updateChatMessage(opts.localMessageId, { status: "sending" });
  }

  opts.hooks.beginOutboundSend();
  let payAmount = amount;
  let prevAvailable: number | null = opts.hooks.spendable;
  let sendStarted = false;
  let settledTxid: string | null = null;
  let recordedOptimistic = false;
  try {
    const dust = await readMinVtxoSats(wallet);
    if (amount < dust) {
      throw new Error(`Minimum send is ${dust} sats (ASP dust / min vtxo).`);
    }
    if (opts.hooks.spendable != null && amount > opts.hooks.spendable) {
      throw new Error("Insufficient balance.");
    }

    // Must have vtxo plan — never blind-send (Xiaomi dust errors after success).
    const plan = await prepareDustSafeSend(wallet, amount, dust, {
      timeoutMs: 5_000,
      requireVtxos: true,
    });
    payAmount = plan.amount;
    prevAvailable =
      plan.totalAvailable != null && plan.totalAvailable > 0
        ? plan.totalAvailable
        : opts.hooks.spendable;

    if (plan.amountBumped && opts.localMessageId) {
      updateChatMessage(opts.localMessageId, { amountSats: payAmount });
      console.warn("[basic] chat pay amount bumped for dust-safe change", {
        from: plan.originalAmount,
        to: payAmount,
      });
    }

    const recipients: SendRecipient[] = [
      { address: dest.address, amount: payAmount },
    ];
    notePendingSendFromThisDevice(
      networkId,
      walletId,
      payAmount,
      dest.address,
      recipients,
    );

    sendStarted = true;
    const markPaid = (txid: string, skipReceipt?: boolean) => {
      if (settledTxid) {
        if (txid && !txid.startsWith("pending:") && txid !== settledTxid) {
          recordSentFromThisDevice(networkId, walletId, txid);
          if (
            settledTxid.startsWith("pending:") ||
            settledTxid.startsWith("local-send:")
          ) {
            const upgraded = upgradeLatestPendingSendTxid(
              networkId,
              walletId,
              txid,
            );
            if (upgraded) {
              settledTxid = upgraded;
              opts.hooks.bumpActivity?.();
            }
          }
        }
        return;
      }
      settledTxid = txid;
      recordedOptimistic = shouldRecordChatPayOptimisticActivity({});
      finalizeChatPayPaid({
        contactId: opts.contactId,
        amountSats: payAmount,
        memo: opts.memo,
        requestId: opts.requestId,
        fiatCaption: opts.fiatCaption,
        localMessageId: opts.localMessageId,
        paymentId,
        txid,
        address: dest.address,
        applyLocalSpend: opts.hooks.applyLocalSpend,
        bumpActivity: opts.hooks.bumpActivity,
        networkId,
        walletId,
        skipReceipt,
      });
    };

    const { txid } = await waitForSendOrSpendDrop(wallet, {
      recipients,
      selectedVtxos: plan.selectedVtxos,
      prevAvailable,
      timeoutMs: 90_000,
      spendDropStartMs: 0,
      spendPollMs: 600,
      spendHitsRequired: 1,
      txidGraceMs: 400,
      spendReadTimeoutMs: 5_000,
      onRealTxid: (real) => {
        if (!real || real.startsWith("pending:")) return;
        recordSentFromThisDevice(networkId, walletId, real);
        const upgraded = upgradeLatestPendingSendTxid(
          networkId,
          walletId,
          real,
        );
        if (upgraded) {
          settledTxid = settledTxid?.startsWith("pending:")
            ? upgraded
            : settledTxid ?? upgraded;
          opts.hooks.bumpActivity?.();
        }
      },
      onLateSuccess: (r) => {
        const msg = opts.localMessageId
          ? getChatMessage(opts.localMessageId)
          : null;
        if (msg?.status === "paid") return;
        markPaid(r.txid);
      },
    });

    markPaid(txid);
    return { txid: settledTxid ?? txid, paymentId, address: dest.address };
  } catch (e) {
    if (opts.localMessageId) {
      const already = getChatMessage(opts.localMessageId);
      if (already?.status === "paid") {
        return {
          txid: settledTxid ?? `pending:${Date.now()}`,
          paymentId,
          address: dest.address,
        };
      }
    }

    const recovered = findAlreadySettledOutbound({
      networkId,
      walletId,
      contactId: opts.contactId,
      amountSats: payAmount,
      preferMessageId: opts.localMessageId,
    });
    if (recovered) {
      console.warn("[basic] chat pay recovered after error", {
        amount: payAmount,
        txid: recovered.txid.slice(0, 16),
      });
      // This attempt's bubble: apply spend (hang often skipped it). A prior
      // bubble match: spend was probably already applied — do not double.
      const thisBubble =
        !!opts.localMessageId && recovered.messageId === opts.localMessageId;
      recordedOptimistic = shouldRecordChatPayOptimisticActivity({
        skipLocalSpend: !thisBubble,
      });
      finalizeChatPayPaid({
        contactId: opts.contactId,
        amountSats: payAmount,
        memo: opts.memo,
        requestId: opts.requestId,
        fiatCaption: opts.fiatCaption,
        localMessageId: opts.localMessageId ?? recovered.messageId,
        paymentId: recovered.paymentId ?? paymentId,
        txid: recovered.txid,
        address: dest.address,
        applyLocalSpend: opts.hooks.applyLocalSpend,
        bumpActivity: opts.hooks.bumpActivity,
        networkId,
        walletId,
        skipLocalSpend: !thisBubble,
      });
      settledTxid = recovered.txid;
      return {
        txid: recovered.txid,
        paymentId: recovered.paymentId ?? paymentId,
        address: dest.address,
      };
    }

    // ASP may have succeeded while SDK threw dust/timeout — prove via spend-drop.
    if (sendStarted && (await proveSpendDropped(wallet, prevAvailable, payAmount))) {
      const txid = `pending:${Date.now()}`;
      console.warn("[basic] chat pay confirmed via spend after error", {
        amount: payAmount,
        err: e instanceof Error ? e.message : String(e),
      });
      recordedOptimistic = true;
      finalizeChatPayPaid({
        contactId: opts.contactId,
        amountSats: payAmount,
        memo: opts.memo,
        requestId: opts.requestId,
        fiatCaption: opts.fiatCaption,
        localMessageId: opts.localMessageId,
        paymentId,
        txid,
        address: dest.address,
        applyLocalSpend: opts.hooks.applyLocalSpend,
        bumpActivity: opts.hooks.bumpActivity,
        networkId,
        walletId,
      });
      settledTxid = txid;
      return { txid, paymentId, address: dest.address };
    }

    if (opts.localMessageId) {
      const cur = getChatMessage(opts.localMessageId);
      if (cur?.status !== "paid") {
        updateChatMessage(opts.localMessageId, { status: "failed" });
      }
    }
    throw new Error(formatSendError(e, DEFAULT_MIN_VTXO_SATS));
  } finally {
    opts.hooks.endOutboundSend();
    // ChatThread/ChatAmount may still hold the outer ASP pause; delay past it.
    // α93 Xiaomi: chat send waited ~2m for merge upsert because history never
    // rematerialized immediately after Pay in Chat.
    if (recordedOptimistic && opts.hooks.refreshActivity) {
      const refresh = opts.hooks.refreshActivity;
      setTimeout(() => {
        void refresh().catch(() => {});
      }, 300);
    }
  }
}
