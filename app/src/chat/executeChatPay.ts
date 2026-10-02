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
} from "./chatStore";
import { publishPaymentReceipt, replyPayRequestWithAddress } from "./chatActions";
import { newChatId } from "./types";

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

export async function executeChatPay(opts: {
  contactId: string;
  amountSats: number;
  memo?: string;
  requestId?: string | null;
  hooks: ChatPayWalletHooks;
  /** Skip presence when caller already gated (should stay false for MVP honesty). */
  skipPresence?: boolean;
  /** Frozen Fiat caption at send time (viewer history). */
  fiatCaption?: string | null;
}): Promise<{ txid: string; paymentId: string; address: string }> {
  const amount = Math.floor(opts.amountSats);
  if (!(amount > 0)) throw new Error("Enter a positive amount.");

  const dest = resolveChatPayDestination({
    contactId: opts.contactId,
    requestId: opts.requestId,
  });

  const { wallet, walletId, networkId } = opts.hooks;
  const dust = await readMinVtxoSats(wallet);
  if (amount < dust) {
    throw new Error(`Minimum send is ${dust} sats (ASP dust / min vtxo).`);
  }
  if (opts.hooks.spendable != null && amount > opts.hooks.spendable) {
    throw new Error("Insufficient balance.");
  }

  if (!opts.skipPresence) {
    const auth = await requireUserPresence("Confirm send");
    if (!auth.ok) {
      throw new Error(auth.reason || "Authentication required");
    }
  }

  const recipients: SendRecipient[] = [{ address: dest.address, amount }];
  const plan = await prepareDustSafeSend(wallet, amount, dust);
  const payAmount = plan.amount;

  opts.hooks.beginOutboundSend();
  try {
    notePendingSendFromThisDevice(
      networkId,
      walletId,
      payAmount,
      dest.address,
      recipients,
    );

    const { txid } = await waitForSendOrSpendDrop(wallet, {
      recipients: [{ address: dest.address, amount: payAmount }],
      selectedVtxos: plan.selectedVtxos,
      prevAvailable: opts.hooks.spendable,
      timeoutMs: 45_000,
      onRealTxid: (real) => {
        if (real && !real.startsWith("pending:")) {
          recordSentFromThisDevice(networkId, walletId, real);
        }
      },
    });

    opts.hooks.applyLocalSpend(payAmount);
    if (txid) {
      recordSentFromThisDevice(networkId, walletId, txid);
    }

    const paymentId = newChatId("pay");
    insertChatMessage({
      contactId: opts.contactId,
      kind: "payment",
      direction: "out",
      amountSats: payAmount,
      memo: opts.memo?.trim() || null,
      status: "paid",
      paymentId,
      requestId: opts.requestId ?? null,
      fiatCaption: opts.fiatCaption ?? null,
    });

    if (opts.requestId) {
      const req = findMessageByRequestId(opts.contactId, opts.requestId);
      if (req) updateChatMessage(req.id, { status: "paid" });
    }

    void publishPaymentReceipt({
      contactId: opts.contactId,
      paymentId,
      amountSats: payAmount,
      memo: opts.memo,
      txid,
      rail: "arkade",
      relatedRequestId: opts.requestId ?? undefined,
    });

    opts.hooks.bumpActivity?.();
    return { txid, paymentId, address: dest.address };
  } catch (e) {
    throw new Error(formatSendError(e, DEFAULT_MIN_VTXO_SATS));
  } finally {
    opts.hooks.endOutboundSend();
  }
}
