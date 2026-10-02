/**
 * Resolve pay destination for chat Send / Pay.
 * Prefer contact ark → request preferredReceive / reply → else error (honest).
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
      // Also learn locally if ingest missed it (catch-up / older payloads).
      silentlyUpsertContactArkFromChat(opts.contactId, fromReq);
      return { address: fromReq, source: "request" };
    }
  }

  throw new Error(
    "No ark address for this contact. They need to share an ark… address (or include one on the request).",
  );
}

/** Requester shares a fresh HD ark on an outgoing request (round-trip helper). */
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
  /** Skip optimistic spend when reconciling an already-broadcast send. */
  skipLocalSpend?: boolean;
  /** Skip Nostr receipt when caller already published immediately after ASP settle. */
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
      txid: opts.txid,
      rail: "arkade",
      relatedRequestId: opts.requestId ?? undefined,
    });
  }

  opts.bumpActivity?.();
}

export async function executeChatPay(opts: {
  contactId: string;
  amountSats: number;
  memo?: string;
  requestId?: string | null;
  hooks: ChatPayWalletHooks;
  /** Skip presence when caller already gated (chat Send Confirm path). */
  skipPresence?: boolean;
  /** Frozen Fiat caption at send time (viewer history). */
  fiatCaption?: string | null;
  /**
   * Optimistic local payment row already inserted (chat Send leaves the amount
   * screen before convert+send). Updated to paid/failed instead of a new insert.
   */
  localMessageId?: string | null;
  /** Prefer this paymentId when creating/updating the local row. */
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

  // Double-spend guard: prior false-Failed / hung send already settled on-chain.
  const already = findAlreadySettledOutbound({
    networkId,
    walletId,
    contactId: opts.contactId,
    amountSats: amount,
  });
  if (already) {
    console.warn("[basic] chat pay skip (already settled)", {
      amount,
      messageId: already.messageId.slice(0, 12),
      txid: already.txid.slice(0, 16),
    });
    if (opts.localMessageId && opts.localMessageId !== already.messageId) {
      // Collapse the new optimistic bubble; keep the reconciled one paid.
      updateChatMessage(opts.localMessageId, { status: "paid" });
    }
    const settleId = opts.localMessageId ?? already.messageId;
    finalizeChatPayPaid({
      contactId: opts.contactId,
      amountSats: amount,
      memo: opts.memo,
      requestId: opts.requestId,
      fiatCaption: opts.fiatCaption,
      localMessageId: settleId,
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

  // Pause ASP polls before getInfo/vtxo select — Xiaomi starves wallet.send otherwise (α73).
  opts.hooks.beginOutboundSend();
  let payAmount = amount;
  let optimisticPaid = false;
  let prevAvailable: number | null = opts.hooks.spendable;
  try {
    const dust = await readMinVtxoSats(wallet);
    if (amount < dust) {
      throw new Error(`Minimum send is ${dust} sats (ASP dust / min vtxo).`);
    }
    if (opts.hooks.spendable != null && amount > opts.hooks.spendable) {
      throw new Error("Insufficient balance.");
    }
    const recipients: SendRecipient[] = [{ address: dest.address, amount }];
    const plan = await prepareDustSafeSend(wallet, amount, dust);
    payAmount = plan.amount;

    notePendingSendFromThisDevice(
      networkId,
      walletId,
      payAmount,
      dest.address,
      recipients,
    );

    // Prefer vtxo-sum baseline — UI spendable can be stale/null (disables spend-drop).
    prevAvailable =
      plan.totalAvailable != null && plan.totalAvailable > 0
        ? plan.totalAvailable
        : opts.hooks.spendable;

    const settleLate = (txid: string) => {
      const msg = opts.localMessageId
        ? getChatMessage(opts.localMessageId)
        : null;
      if (msg?.status === "paid") {
        if (txid && !txid.startsWith("pending:")) {
          recordSentFromThisDevice(networkId, walletId, txid);
        }
        return;
      }
      console.warn("[basic] chat pay late settle → paid", {
        amount: payAmount,
        txid: txid.slice(0, 16),
        was: msg?.status ?? null,
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
    };

    // Start ASP send, then flip You sent immediately (α73). Xiaomi often holds
    // wallet.send >20s while funds already left; spend-drop vtxo reads also time out.
    const pendingTxid = `pending:${Date.now()}`;
    const sendWait = waitForSendOrSpendDrop(wallet, {
      recipients: [{ address: dest.address, amount: payAmount }],
      selectedVtxos: plan.selectedVtxos,
      prevAvailable,
      timeoutMs: 120_000,
      spendDropStartMs: 0,
      spendPollMs: 800,
      spendHitsRequired: 1,
      txidGraceMs: 300,
      spendReadTimeoutMs: 4_000,
      onRealTxid: (real) => {
        if (real && !real.startsWith("pending:")) {
          recordSentFromThisDevice(networkId, walletId, real);
        }
      },
      onLateSuccess: (r) => {
        settleLate(r.txid);
      },
    });

    finalizeChatPayPaid({
      contactId: opts.contactId,
      amountSats: payAmount,
      memo: opts.memo,
      requestId: opts.requestId,
      fiatCaption: opts.fiatCaption,
      localMessageId: opts.localMessageId,
      paymentId,
      txid: pendingTxid,
      applyLocalSpend: opts.hooks.applyLocalSpend,
      bumpActivity: opts.hooks.bumpActivity,
      networkId,
      walletId,
      skipReceipt: true,
    });
    optimisticPaid = true;
    console.warn("[basic] chat pay optimistic You sent", {
      amount: payAmount,
      prevAvailable,
    });
    // Yield so RN paints "You sent" before more ASP/bridge work.
    await new Promise<void>((r) => setTimeout(r, 0));
    void publishPaymentReceipt({
      contactId: opts.contactId,
      paymentId,
      amountSats: payAmount,
      memo: opts.memo,
      txid: pendingTxid,
      rail: "arkade",
      relatedRequestId: opts.requestId ?? undefined,
    });

    try {
      const { txid } = await sendWait;
      if (txid && !txid.startsWith("pending:")) {
        recordSentFromThisDevice(networkId, walletId, txid);
        // Refresh receipt with real txid (best-effort).
        void publishPaymentReceipt({
          contactId: opts.contactId,
          paymentId,
          amountSats: payAmount,
          memo: opts.memo,
          txid,
          rail: "arkade",
          relatedRequestId: opts.requestId ?? undefined,
        });
      }
      return { txid, paymentId, address: dest.address };
    } catch (sendErr) {
      // Optimistic paid: only fail UI if activity/pending cannot prove settle.
      const recovered = findAlreadySettledOutbound({
        networkId,
        walletId,
        contactId: opts.contactId,
        amountSats: payAmount,
      });
      if (recovered) {
        console.warn("[basic] chat pay kept optimistic after send err", {
          amount: payAmount,
          txid: recovered.txid.slice(0, 16),
        });
        if (recovered.txid && !recovered.txid.startsWith("pending:")) {
          recordSentFromThisDevice(networkId, walletId, recovered.txid);
        }
        return {
          txid: recovered.txid,
          paymentId: recovered.paymentId ?? paymentId,
          address: dest.address,
        };
      }
      throw sendErr;
    }
  } catch (e) {
    // Last chance: activity / pending stamp may already prove success.
    const recovered = findAlreadySettledOutbound({
      networkId,
      walletId,
      contactId: opts.contactId,
      amountSats: payAmount,
    });
    if (recovered) {
      console.warn("[basic] chat pay recovered after error", {
        amount: payAmount,
        txid: recovered.txid.slice(0, 16),
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
        applyLocalSpend: opts.hooks.applyLocalSpend,
        bumpActivity: opts.hooks.bumpActivity,
        networkId,
        walletId,
        skipLocalSpend: true,
      });
      return {
        txid: recovered.txid,
        paymentId: recovered.paymentId ?? paymentId,
        address: dest.address,
      };
    }
    // Optimistic You sent: keep if spendable already dropped; else revert to failed.
    if (optimisticPaid) {
      try {
        const avail = await readSpendableAvailable(wallet, { timeoutMs: 4_000 });
        if (
          prevAvailable != null &&
          avail != null &&
          avail <= prevAvailable - payAmount + 1
        ) {
          console.warn("[basic] chat pay kept optimistic (spend dropped)", {
            prevAvailable,
            avail,
            amount: payAmount,
          });
          return {
            txid: `pending:${Date.now()}`,
            paymentId,
            address: dest.address,
          };
        }
      } catch {
        /* ignore */
      }
      if (opts.localMessageId) {
        updateChatMessage(opts.localMessageId, { status: "failed" });
      }
      console.warn("[basic] chat pay reverted optimistic You sent", e);
    }

    if (opts.localMessageId) {
      updateChatMessage(opts.localMessageId, { status: "failed" });
    }
    throw new Error(formatSendError(e, DEFAULT_MIN_VTXO_SATS));
  } finally {
    opts.hooks.endOutboundSend();
  }
}
