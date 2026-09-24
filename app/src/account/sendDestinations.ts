/**
 * Persist outbound send destinations (single or multi) keyed by activity / txid.
 * Shared by activityStore + txMeta so rematerialize can re-attach after SDK history
 * replaces optimistic rows.
 */

import type { ArkadeNetworkId } from "../config/network";
import type { SendRecipientSnapshot } from "../wallet/activity";
import { accountKvGet, accountKvSet } from "./accountDb";

function walletKey(walletId: string, activityOrTxid: string): string {
  return `send-recipients:${walletId}:${activityOrTxid}`;
}

function txidKey(txid: string): string {
  return `send-recipients:txid:${txid.trim().toLowerCase()}`;
}

export function pendingSendDestKey(walletId: string, amountSats: number): string {
  return `pending-send-dest:${walletId}:${Math.abs(Math.floor(amountSats))}`;
}

export function normalizeSendRecipients(
  list: Array<{ address: string; amount: number }> | undefined,
): SendRecipientSnapshot[] {
  if (!list?.length) return [];
  const out: SendRecipientSnapshot[] = [];
  for (const r of list) {
    const address = (r.address ?? "").trim();
    if (!address) continue;
    const amount = Math.abs(Math.floor(Number(r.amount) || 0));
    out.push({ address, amount });
  }
  return out;
}

/** True for ark/onchain/LN payment addresses — never for hex txids or "N recipients". */
export function looksLikePaymentAddress(raw: string): boolean {
  const t = raw.trim();
  if (!t || t.length < 14) return false;
  if (t.includes("…") || t.includes("...")) return false;
  if (/^\d+\s+recipients$/i.test(t)) return false;
  if (/^[0-9a-fA-F]{32,}$/.test(t)) return false;
  const lower = t.toLowerCase();
  return (
    lower.startsWith("ark") ||
    lower.startsWith("bc1") ||
    lower.startsWith("tb1") ||
    lower.startsWith("bcrt") ||
    lower.startsWith("lnbc") ||
    lower.startsWith("lntb") ||
    lower.startsWith("lightning:")
  );
}

export function rememberSendRecipients(
  networkId: ArkadeNetworkId,
  walletId: string,
  activityOrTxid: string,
  recipients: Array<{ address: string; amount: number }>,
): void {
  const id = activityOrTxid.trim();
  const list = normalizeSendRecipients(recipients);
  if (!id || list.length === 0) return;
  const blob = JSON.stringify(list);
  if (walletId) {
    accountKvSet(networkId, walletKey(walletId, id), blob);
  }
  if (/^[0-9a-fA-F]{64}$/.test(id)) {
    accountKvSet(networkId, txidKey(id), blob);
  }
}

export function recallSendRecipients(
  networkId: ArkadeNetworkId,
  walletId: string,
  ...activityOrTxids: Array<string | undefined | null>
): SendRecipientSnapshot[] {
  const seen = new Set<string>();
  for (const raw of activityOrTxids) {
    const id = (raw ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const keys: string[] = [];
    if (walletId) keys.push(walletKey(walletId, id));
    if (/^[0-9a-fA-F]{64}$/.test(id)) keys.push(txidKey(id));
    for (const key of keys) {
      const blob = accountKvGet(networkId, key);
      if (!blob) continue;
      try {
        const parsed = JSON.parse(blob) as Array<{ address?: string; amount?: number }>;
        const list = normalizeSendRecipients(
          parsed.map((p) => ({ address: p.address ?? "", amount: Number(p.amount) || 0 })),
        );
        if (list.length > 0) return list;
      } catch {
        /* ignore */
      }
    }
  }
  return [];
}

export function rememberPendingSendDestinations(
  networkId: ArkadeNetworkId,
  walletId: string,
  amountSats: number,
  recipients: Array<{ address: string; amount: number }>,
): void {
  const list = normalizeSendRecipients(recipients);
  if (!walletId || list.length === 0 || !(amountSats > 0)) return;
  accountKvSet(networkId, pendingSendDestKey(walletId, amountSats), JSON.stringify(list));
}

export function takePendingSendDestinations(
  networkId: ArkadeNetworkId,
  walletId: string,
  amountSats: number,
): SendRecipientSnapshot[] {
  if (!walletId || !(amountSats > 0)) return [];
  const key = pendingSendDestKey(walletId, amountSats);
  const blob = accountKvGet(networkId, key);
  if (!blob) return [];
  try {
    return normalizeSendRecipients(
      (JSON.parse(blob) as Array<{ address?: string; amount?: number }>).map((p) => ({
        address: p.address ?? "",
        amount: Number(p.amount) || 0,
      })),
    );
  } catch {
    return [];
  }
}
