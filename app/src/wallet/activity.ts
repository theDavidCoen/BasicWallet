/**
 * Activity list — prefer SDK history (arkade.money uses getTransactionHistory),
 * fall back to VTXO snapshot when boarding Esplora hangs (common on RN mutinynet).
 *
 * Boarding lifecycle is one list row (status advances); phase txs live in details.
 */

import type { Activity, ArkTransaction } from "@arkade-os/sdk";
import { offchainTxUrl, onchainTxUrl } from "../config/explorers";
import type { BasicWallet } from "./hdWallet";

/** User-facing status — aligned with arkade.money Transaction.tsx labels. */
export type ActivityStatus =
  | "unconfirmed"
  | "pending_boarding"
  | "preconfirmed"
  | "confirmed";

export type ActivityRow = {
  id: string;
  title: string;
  subtitle: string;
  amount: number;
  settled: boolean;
  status: ActivityStatus;
  createdAt: number;
  tags: string[];
  txs: ArkTxRow[];
};

export type ArkTxRow = {
  type: string;
  amount: number;
  settled: boolean;
  createdAt: number;
  tag?: string;
  boardingTxid: string;
  commitmentTxid: string;
  arkTxid: string;
  /** Lightning payment preimage (hex), when known from payinvoice / history. */
  preimage?: string;
  /** Lightning routing fee in sats, when known. */
  feeSats?: number;
  /**
   * Unilateral exit: sats actually paid to the recovery address onchain.
   * May be lower than `amount` when delivery is partial / still catching up.
   */
  deliveredSats?: number;
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function midEllipsis(s: string, left = 10, right = 6): string {
  if (!s || s.length <= left + right + 1) return s || "";
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

function primaryTxId(tx: ArkTransaction): string {
  return tx.key.arkTxid || tx.key.commitmentTxid || tx.key.boardingTxid || "";
}

export function statusLabel(status: ActivityStatus): string {
  switch (status) {
    case "unconfirmed":
      return "Unconfirmed";
    case "pending_boarding":
      return "Pending boarding";
    case "preconfirmed":
      return "Preconfirmed";
    case "confirmed":
      return "Confirmed";
  }
}

export function phaseCardTitle(tx: ArkTxRow): string {
  if (tx.tag === "boarding") return "Boarding (onchain)";
  if (tx.tag === "batch") return "Batch settlement";
  if (tx.tag === "exit") return "Exit";
  if (tx.tag === "offchain") return tx.type === "SENT" || tx.amount < 0 ? "Send (offchain)" : "Receive (offchain)";
  return tx.tag || tx.type || "Transaction";
}

function titleForActivity(a: Activity): string {
  const label = a.intent?.label?.trim();
  if (label) return label;
  const tags = a.txs.map((t) => t.tag).filter(Boolean) as string[];
  if (tags.includes("boarding") || tags.includes("batch")) return "Deposit";
  if (tags.includes("exit")) return "Exit";
  if (tags.includes("offchain")) return a.amount >= 0 ? "Received" : "Sent";
  if (a.amount > 0) return "Received";
  if (a.amount < 0) return "Sent";
  return "Activity";
}

function subtitleForActivity(a: Activity): string {
  const boarding = a.txs.map((t) => t.key.boardingTxid).find(Boolean);
  if (boarding) return midEllipsis(boarding, 12, 8);
  const ids = a.txs.map(primaryTxId).filter(Boolean);
  if (ids[0]) return midEllipsis(ids[0], 12, 8);
  return "";
}

function toTxRow(tx: ArkTransaction): ArkTxRow {
  return {
    type: String(tx.type),
    amount: tx.amount,
    settled: tx.settled,
    createdAt: normalizeActivityCreatedAt(tx.createdAt),
    tag: tx.tag,
    boardingTxid: tx.key.boardingTxid || "",
    commitmentTxid: tx.key.commitmentTxid || "",
    arkTxid: tx.key.arkTxid || "",
  };
}

/** Unconfirmed boarding often arrives with createdAt 0 — keep 0 so upsert can
 * preserve a prior DB timestamp instead of inventing a new "now" each rematerialize. */
export function normalizeActivityCreatedAt(ms: number | null | undefined): number {
  if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) {
    return ms > 1e12 ? ms : ms * 1000;
  }
  return 0;
}

/** Derive list status (arkade.money Transaction status). */
export function deriveActivityStatus(row: {
  settled: boolean;
  tags: string[];
  txs: ArkTxRow[];
  createdAt: number;
}): ActivityStatus {
  const tags = row.tags;
  const isLightning =
    tags.includes("lightning") ||
    tags.includes("ln") ||
    row.txs.some((t) => t.tag === "lightning");
  // Lightning has no Arkade preconfirm layer — paid or not yet.
  if (isLightning) {
    const allSettled = row.settled || (row.txs.length > 0 && row.txs.every((t) => t.settled));
    return allSettled ? "confirmed" : "unconfirmed";
  }

  const hasBoarding = tags.includes("boarding") || row.txs.some((t) => t.boardingTxid);
  const hasBatch = tags.includes("batch") || row.txs.some((t) => t.tag === "batch");
  const allSettled = row.settled || (row.txs.length > 0 && row.txs.every((t) => t.settled));

  if (allSettled || (hasBatch && row.txs.some((t) => t.tag === "batch" && t.settled))) {
    return "confirmed";
  }

  if (tags.includes("exit")) {
    return allSettled ? "confirmed" : "unconfirmed";
  }

  // Boarding with no usable timestamp ≈ unconfirmed onchain (arkade.money).
  if (hasBoarding && !hasBatch && (!row.createdAt || row.createdAt <= 0)) {
    return "unconfirmed";
  }
  if (hasBoarding && !hasBatch) {
    return "pending_boarding";
  }
  if (hasBoarding && hasBatch && !allSettled) {
    return "pending_boarding";
  }
  return "preconfirmed";
}

export function activityToRow(a: Activity): ActivityRow {
  const tags = [...new Set(a.txs.map((t) => t.tag).filter(Boolean) as string[])];
  const createdAt = normalizeActivityCreatedAt(a.createdAt);
  const txs = a.txs.map(toTxRow);
  const base = {
    id: a.id,
    title: titleForActivity(a),
    subtitle: subtitleForActivity(a),
    amount: a.amount,
    settled: a.settled,
    createdAt,
    tags,
    txs,
  };
  return { ...base, status: deriveActivityStatus(base) };
}

/**
 * One Deposit row per boarding txid: merge boarding + batch phases.
 * Offchain rows stay as-is.
 */
export function coalesceActivityRows(rows: ActivityRow[]): ActivityRow[] {
  const byBoarding = new Map<string, ActivityRow[]>();
  const rest: ActivityRow[] = [];

  for (const row of rows) {
    const boardingTxid =
      row.txs.map((t) => t.boardingTxid).find((id) => id.length > 0) ||
      (row.tags.includes("boarding") || row.tags.includes("batch") ? row.id : "");
    const isBoardingFlow =
      row.tags.includes("boarding") ||
      row.tags.includes("batch") ||
      row.txs.some((t) => t.tag === "boarding" || t.tag === "batch");

    if (isBoardingFlow && boardingTxid) {
      const key = boardingTxid.startsWith("board:") ? boardingTxid.slice(6) : boardingTxid;
      const list = byBoarding.get(key) ?? [];
      list.push(row);
      byBoarding.set(key, list);
    } else {
      rest.push(row);
    }
  }

  const merged: ActivityRow[] = [];
  for (const [boardingTxid, group] of byBoarding) {
    const txs = group
      .flatMap((g) => g.txs)
      .sort((a, b) => a.createdAt - b.createdAt);
    // Dedupe identical phase keys
    const seen = new Set<string>();
    const uniqueTxs: ArkTxRow[] = [];
    for (const tx of txs) {
      const k = `${tx.tag}|${tx.boardingTxid}|${tx.commitmentTxid}|${tx.arkTxid}|${tx.amount}`;
      if (seen.has(k)) continue;
      seen.add(k);
      uniqueTxs.push(tx);
    }

    const tags = [...new Set(group.flatMap((g) => g.tags))];
    const boardingRow = group.find((g) => g.tags.includes("boarding")) ?? group[0]!;
    const amount =
      boardingRow.amount !== 0
        ? boardingRow.amount
        : group.reduce((best, g) => (Math.abs(g.amount) > Math.abs(best) ? g.amount : best), 0);
    const positiveTimes = group.map((g) => g.createdAt).filter((t) => t > 0);
    const createdAt = positiveTimes.length > 0 ? Math.min(...positiveTimes) : 0;
    const settled = group.some((g) => g.settled && g.tags.includes("batch")) || group.every((g) => g.settled);
    const base = {
      id: `board:${boardingTxid}`,
      title: "Deposit",
      subtitle: midEllipsis(boardingTxid, 12, 8),
      amount,
      settled,
      createdAt,
      tags,
      txs: uniqueTxs,
    };
    merged.push({ ...base, status: deriveActivityStatus(base) });
  }

  const enrichedRest = rest.map((row) => ({
    ...row,
    title:
      row.tags.includes("boarding") || row.tags.includes("batch")
        ? "Deposit"
        : row.title === "Batch settlement" || row.title === "Boarding"
          ? "Deposit"
          : row.title,
    status: deriveActivityStatus(row),
  }));

  return [...merged, ...enrichedRest].sort((a, b) => b.createdAt - a.createdAt);
}

function createdAtMs(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    return v > 1e12 ? v : v * 1000;
  }
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) && t > 0 ? t : 0;
  }
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) && t > 0 ? t : 0;
  }
  return 0;
}

type VtxoLike = {
  txid?: string;
  vout?: number;
  value?: number;
  amount?: number | bigint;
  createdAt?: unknown;
  isSpent?: boolean;
  spentBy?: string;
  settledBy?: string;
  isPreconfirmed?: boolean;
  arkTxId?: string;
  outpoint?: { txid?: string; vout?: number };
};

function vtxoId(v: VtxoLike): string {
  const txid = v.txid || v.outpoint?.txid || "";
  const vout = v.vout ?? v.outpoint?.vout ?? 0;
  return txid ? `${txid}:${vout}` : `vtxo-${createdAtMs(v.createdAt)}`;
}

function vtxoValue(v: VtxoLike): number {
  if (typeof v.value === "number") return v.value;
  if (typeof v.amount === "number") return v.amount;
  if (typeof v.amount === "bigint") return Number(v.amount);
  return 0;
}

async function rowsFromVtxos(wallet: BasicWallet): Promise<ActivityRow[]> {
  const anyW = wallet as BasicWallet & {
    getVtxos?: (filter?: unknown) => Promise<VtxoLike[]>;
    getSpendableVtxos?: () => Promise<VtxoLike[]>;
  };

  let list: VtxoLike[] = [];
  try {
    if (typeof anyW.getVtxos === "function") {
      list = await withTimeout(anyW.getVtxos(), 8_000, "getVtxos");
    } else if (typeof anyW.getSpendableVtxos === "function") {
      list = await withTimeout(anyW.getSpendableVtxos(), 8_000, "getSpendableVtxos");
    }
  } catch {
    return [];
  }

  const rows: ActivityRow[] = [];
  for (const v of list ?? []) {
    const value = vtxoValue(v);
    if (value <= 0) continue;
    const id = vtxoId(v);
    const spent = Boolean(v.isSpent || (v.spentBy && v.spentBy.length > 0));
    const settled = Boolean(v.settledBy && v.settledBy.length > 0) || !v.isPreconfirmed;
    const createdAt = createdAtMs(v.createdAt);
    const txid = v.txid || v.outpoint?.txid || v.arkTxId || "";
    const base = {
      id,
      title: spent ? "Sent" : "Received",
      subtitle: midEllipsis(txid || id, 12, 8),
      amount: spent ? -value : value,
      settled,
      createdAt,
      tags: ["offchain"] as string[],
      txs: [
        {
          type: spent ? "SENT" : "RECEIVED",
          amount: spent ? -value : value,
          settled,
          createdAt,
          tag: "offchain",
          boardingTxid: "",
          commitmentTxid: "",
          arkTxid: v.arkTxId || txid,
        },
      ],
    };
    rows.push({ ...base, status: deriveActivityStatus(base) });
  }

  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Prefer SDK activity/tx history (same as arkade.money getTxHistory).
 * Coalesce boarding phases into one Deposit row.
 * Merge activity + transaction history — a short getActivityHistory alone used to
 * wipe the local DB on rematerialize (one recent receive → Activity empties).
 */
export async function loadActivityRows(wallet: BasicWallet): Promise<ActivityRow[]> {
  const byId = new Map<string, ActivityRow>();

  const absorb = (rows: ActivityRow[]) => {
    for (const r of rows) {
      const prev = byId.get(r.id);
      if (!prev || (r.txs?.length ?? 0) >= (prev.txs?.length ?? 0)) {
        byId.set(r.id, r);
      }
    }
  };

  try {
    const activities = await withTimeout(wallet.getActivityHistory(), 10_000, "getActivityHistory");
    if (Array.isArray(activities) && activities.length > 0) {
      absorb(coalesceActivityRows(activities.map(activityToRow)));
    }
  } catch {
    /* fall through */
  }

  try {
    const txs = await withTimeout(wallet.getTransactionHistory(), 10_000, "getTransactionHistory");
    if (Array.isArray(txs) && txs.length > 0) {
      absorb(
        coalesceActivityRows(
          txs.map((tx) =>
            activityToRow({
              id: primaryTxId(tx) || `${tx.createdAt}:${tx.amount}`,
              amount: tx.type === "RECEIVED" ? Math.abs(tx.amount) : -Math.abs(tx.amount),
              createdAt: tx.createdAt,
              settled: tx.settled,
              txs: [tx],
            }),
          ),
        ),
      );
    }
  } catch {
    /* fall through */
  }

  if (byId.size === 0) {
    return coalesceActivityRows(await rowsFromVtxos(wallet));
  }

  // Thin history: still fold in vtxo snapshot so older settles are not dropped.
  if (byId.size < 4) {
    try {
      absorb(coalesceActivityRows(await rowsFromVtxos(wallet)));
    } catch {
      /* keep what we have */
    }
  }

  return coalesceActivityRows([...byId.values()]);
}

export function formatSatsSigned(amount: number): string {
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}${Math.abs(amount).toLocaleString("en-US")} sats`;
}

export function formatWhen(ms: number): string {
  if (!ms || ms <= 0) return "—";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "—";
  }
}

export function explorerTxUrl(networkId: "mutinynet" | "mainnet", txid: string): string | null {
  if (!txid) return null;
  return offchainTxUrl(networkId, txid) ?? onchainTxUrl(networkId, txid);
}

export function explorerUrlForTxKind(
  networkId: "mutinynet" | "mainnet",
  txid: string,
  kind: "boarding" | "commitment" | "ark",
): string | null {
  if (!txid) return null;
  if (kind === "ark") return offchainTxUrl(networkId, txid) ?? onchainTxUrl(networkId, txid);
  return onchainTxUrl(networkId, txid);
}
