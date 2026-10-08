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
  const base = {
    id: p.id,
    title: p.memo?.trim() || (p.direction === "in" ? "Lightning received" : "Lightning sent"),
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
      },
    ],
  };
  return { ...base, status: deriveActivityStatus(base) };
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

  // Keep preimage / fee from a local pay if hub history omits them.
  const local = readActivityFromDb(networkId, { walletId, limit: 200 });
  for (const row of local) {
    const tx = row.txs[0];
    if (!tx?.preimage && tx?.feeSats == null) continue;
    const key = (tx.arkTxid || row.id.replace(/^ln-(in|out)-/, "")).toLowerCase();
    const hit = byHash.get(key) ?? byHash.get(row.id.toLowerCase());
    if (!hit) continue;
    byHash.set(key, {
      ...hit,
      preimage: hit.preimage || tx.preimage,
      feeSats: hit.feeSats ?? tx.feeSats,
    });
  }

  const unique = [...byHash.values()];
  replaceActivityRows(networkId, walletId, unique.map(paymentToRow));
  return unique.length;
}
