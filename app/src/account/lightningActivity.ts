/**
 * Lightning node activity adapter — writes into the same activity_idx shape.
 * LNDHub or BTCPay LND REST history sync. Payment upserts from Send/Receive.
 */

import type { ArkadeNetworkId } from "../config/network";
import { replaceActivityRows, readActivityFromDb, upsertActivityRows } from "./activityStore";
import type { ActivityRow } from "../wallet/activity";
import { deriveActivityStatus } from "../wallet/activity";
import {
  insertWallet,
  listWallets,
  type WalletRecord,
} from "./walletRegistry";
import { loadLndHubCredentials } from "../lightning/lndhubCredentials";
import { loadLndRestCredentials } from "../lightning/lndCredentials";
import {
  lndhubListHistory,
  type LightningPaymentInput,
} from "../lightning/lndhub";
import { lndListHistory } from "../lightning/lndRest";

export type { LightningPaymentInput };

/** How long a local LN upsert can outlive a lagging history sync. */
const LOCAL_LN_KEEP_MS = 2 * 60 * 60 * 1000;

function uniqueLightningLabel(networkId: ArkadeNetworkId, base: string): string {
  const wanted = base.trim() || "Lightning";
  const taken = new Set(
    listWallets(networkId)
      .filter((w) => w.kind === "lightning")
      .map((w) => w.label),
  );
  if (!taken.has(wanted)) return wanted;
  let n = 2;
  while (taken.has(`${wanted} ${n}`)) n += 1;
  return `${wanted} ${n}`;
}

/** Always insert a new Lightning switcher row (multi-node). */
export function insertLightningWalletRow(
  networkId: ArkadeNetworkId,
  label = "Lightning",
  tag = "BTCPay",
): WalletRecord {
  return insertWallet(networkId, {
    kind: "lightning",
    label: uniqueLightningLabel(networkId, label),
    tag,
  });
}

/** @deprecated use insertLightningWalletRow — kept for call-site clarity during rename. */
export function ensureLightningWalletRow(
  networkId: ArkadeNetworkId,
  label = "Lightning",
  tag = "BTCPay",
): WalletRecord {
  return insertLightningWalletRow(networkId, label, tag);
}

function paymentToRow(p: LightningPaymentInput): ActivityRow {
  const amount = p.direction === "in" ? Math.abs(p.amountSats) : -Math.abs(p.amountSats);
  const memo = p.memo?.trim() || undefined;
  const base = {
    id: p.id,
    // Keep a stable type title; memo lives on the tx for Activity detail.
    title: p.direction === "in" ? "Lightning received" : "Lightning sent",
    subtitle: p.paymentHash ? p.paymentHash.slice(0, 16) : "lightning",
    amount,
    settled: p.settled,
    createdAt: p.createdAt,
    tags: ["lightning", "ln"],
    txs: [
      {
        type: p.direction === "in" ? "RECEIVED" : "SENT",
        amount,
        settled: p.settled,
        createdAt: p.createdAt,
        tag: "lightning",
        boardingTxid: "",
        commitmentTxid: "",
        arkTxid: p.paymentHash || p.id,
        preimage: p.preimage || undefined,
        feeSats: p.feeSats,
        ...(memo ? { memo } : {}),
      },
    ],
  };
  return { ...base, status: deriveActivityStatus(base) };
}

function memoFromRow(row: ActivityRow): string | undefined {
  const fromTx = row.txs.map((t) => t.memo?.trim()).find(Boolean);
  if (fromTx) return fromTx;
  const title = row.title?.trim();
  if (
    title &&
    title !== "Lightning sent" &&
    title !== "Lightning received" &&
    title !== "Lightning payment"
  ) {
    return title;
  }
  return undefined;
}

/** Upsert settled (or just-paid) Lightning rows — do not write unpaid invoices. */
export function upsertLightningPayments(
  networkId: ArkadeNetworkId,
  walletId: string,
  payments: LightningPaymentInput[],
): void {
  const settled = payments.filter((p) => p.settled);
  if (settled.length === 0) return;
  upsertActivityRows(networkId, walletId, settled.map(paymentToRow));
}

/** Pull LNDHub or LND REST history; replace wallet activity so unpaid/ghost LN rows disappear. */
export async function syncLightningHistory(
  networkId: ArkadeNetworkId,
  walletId: string,
): Promise<number> {
  const hub = await loadLndHubCredentials(walletId);
  const rest = hub ? null : await loadLndRestCredentials(walletId);
  if (!hub && !rest) return 0;
  const payments = hub
    ? await lndhubListHistory(hub, { limit: 50 })
    : await lndListHistory(
        {
          restUrl: rest!.restUrl,
          macaroonHex: rest!.macaroonHex,
          certThumbprint: rest!.certThumbprint,
          allowInsecure: rest!.allowInsecure,
          source: rest!.source,
        },
        { limit: 50 },
      );
  const settled = payments.filter((p) => p.settled);
  const byHash = new Map<string, LightningPaymentInput>();
  for (const p of settled) {
    const key = (p.paymentHash || p.id).toLowerCase();
    const prev = byHash.get(key);
    if (!prev || p.createdAt >= prev.createdAt) byHash.set(key, p);
  }

  // Keep preimage / fee / memo from a local pay if hub history omits them.
  // Also re-attach recent local-only rows when history lags (inbound settle race).
  const local = readActivityFromDb(networkId, { walletId, limit: 200 });
  const now = Date.now();
  for (const row of local) {
    if (!row.tags.includes("lightning") && !row.tags.includes("ln")) continue;
    if (!row.id.startsWith("ln-in-") && !row.id.startsWith("ln-out-")) continue;
    const tx = row.txs[0];
    const key = (tx?.arkTxid || row.id.replace(/^ln-(in|out)-/, "")).toLowerCase();
    const hit = byHash.get(key) ?? byHash.get(row.id.toLowerCase());
    const localMemo = memoFromRow(row);
    if (hit) {
      byHash.set(key, {
        ...hit,
        preimage: hit.preimage || tx?.preimage,
        feeSats: hit.feeSats ?? tx?.feeSats,
        memo: hit.memo?.trim() || localMemo || hit.memo,
      });
      continue;
    }
    // History omitted this payment (stale window / reversed lag). Keep recent locals.
    if (now - row.createdAt > LOCAL_LN_KEEP_MS) continue;
    const direction = row.amount >= 0 ? "in" : "out";
    byHash.set(key, {
      id: row.id,
      amountSats: Math.abs(row.amount),
      direction,
      createdAt: row.createdAt,
      settled: row.settled,
      memo: localMemo,
      paymentHash: key,
      preimage: tx?.preimage,
      feeSats: tx?.feeSats,
    });
  }

  const unique = [...byHash.values()];
  replaceActivityRows(networkId, walletId, unique.map(paymentToRow));
  return unique.length;
}
