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
};

function parsePayTo(json: string | null | undefined): string | null {
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

export function resolveChatPayDestination(opts: {
  contactId: string;
  requestId?: string | null;
}): { address: string; source: "contact" | "request" } {
  const contact = getContact(opts.contactId);
  if (!contact) throw new Error("Contact not found.");

  const stored = contactArkAddress(contact);
  if (stored && isValidArkAddress(stored)) {
    return { address: stored, source: "contact" };
  }

  if (opts.requestId) {
    const msg = findMessageByRequestId(opts.contactId, opts.requestId);
    const fromReq = parsePayTo(msg?.payToJson);
    if (fromReq) {
      silentlyUpsertContactArkFromChat(opts.contactId, fromReq);
      return { address: fromReq, source: "request" };
    }
  }

  throw new Error(
    "No ark address for this contact. They need to share an ark… address (or include one on the request).",
  );
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

  const dest = resolveChatPayDestination({
    contactId: opts.contactId,
    requestId: opts.requestId,
  });

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
        if (txid && !txid.startsWith("pending:") && opts.localMessageId) {
          // Upgrade pending → real txid without a second receipt.
          if (txid !== settledTxid) {
            recordSentFromThisDevice(networkId, walletId, txid);
          }
        }
        return;
      }
      settledTxid = txid;
      finalizeChatPayPaid({
        contactId: opts.contactId,
        amountSats: payAmount,
        memo: opts.memo,
        requestId: opts.requestId,
        fiatCaption: opts.fiatCaption,
        localMessageId: opts.localMessageId,
        paymentId,
        txid,
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
        if (real && !real.startsWith("pending:")) {
          recordSentFromThisDevice(networkId, walletId, real);
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
      finalizeChatPayPaid({
        contactId: opts.contactId,
        amountSats: payAmount,
        memo: opts.memo,
        requestId: opts.requestId,
        fiatCaption: opts.fiatCaption,
        localMessageId: opts.localMessageId ?? recovered.messageId,
        paymentId: recovered.paymentId ?? paymentId,
        txid: recovered.txid,
        applyLocalSpend: opts.hooks.applyLocalSpend,
        bumpActivity: opts.hooks.bumpActivity,
        networkId,
        walletId,
        skipLocalSpend: !thisBubble,
      });
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
      finalizeChatPayPaid({
        contactId: opts.contactId,
        amountSats: payAmount,
        memo: opts.memo,
        requestId: opts.requestId,
        fiatCaption: opts.fiatCaption,
        localMessageId: opts.localMessageId,
        paymentId,
        txid,
        applyLocalSpend: opts.hooks.applyLocalSpend,
        bumpActivity: opts.hooks.bumpActivity,
        networkId,
        walletId,
      });
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
  }
}
