/**
 * Account activity_idx — materialize from Arkade SDK (or LN adapter).
 * UI reads here first; pull-to-refresh rematerializes from engine.
 */

import type { ArkadeNetworkId } from "../config/network";
import type { ActivityRow, ActivityStatus } from "../wallet/activity";
import { deriveActivityStatus, loadActivityRows } from "../wallet/activity";
import type { BasicWallet } from "../wallet/hdWallet";
import { getAccountDb } from "./accountDb";
import { enqueueFiatCoverage } from "./fiatRate";
import { getTxMeta, recordSentFromThisDevice, syncActivityFts, applyPendingSendStamps } from "./txMeta";

export type ActivityKind = "arkade" | "boarding" | "lightning" | "other";

export type StoredActivity = ActivityRow & {
  walletId: string;
  kind: ActivityKind;
  fiatAmount: number | null;
  fiatCode: string | null;
};

function kindFromRow(row: ActivityRow): ActivityKind {
  if (row.tags.includes("boarding") || row.tags.includes("batch") || row.id.startsWith("board:")) {
    return "boarding";
  }
  if (row.tags.includes("lightning") || row.tags.includes("ln")) return "lightning";
  if (row.tags.includes("exit") || row.id.startsWith("exit:")) return "other";
  return "arkade";
}

function isLocalExitActivityId(activityId: string): boolean {
  return activityId.startsWith("exit:");
}

function isLocalPendingSendId(activityId: string): boolean {
  return activityId.startsWith("pending:") || activityId.startsWith("local-send:");
}

/** Snapshot optimistic / pending sends so rematerialize does not wipe them. */
function readLocalPendingSendRows(
  networkId: ArkadeNetworkId,
  walletId: string,
): ActivityRow[] {
  const db = getAccountDb(networkId);
  try {
    const rows = db.getAllSync<{
      activity_id: string;
      amount_sats: number;
      created_at: number;
      settled: number;
      title: string;
      subtitle: string | null;
      tags_json: string | null;
      txs_json: string | null;
      status: string | null;
    }>(
      `SELECT activity_id, amount_sats, created_at, settled, title, subtitle, tags_json, txs_json, status
       FROM activity_idx WHERE wallet_id = ?
         AND (activity_id LIKE 'pending:%' OR activity_id LIKE 'local-send:%')`,
      [walletId],
    );
    return rows.map((r) => {
      let tags: string[] = ["offchain"];
      let txs: ActivityRow["txs"] = [];
      try {
        tags = r.tags_json ? (JSON.parse(r.tags_json) as string[]) : ["offchain"];
      } catch {
        tags = ["offchain"];
      }
      try {
        txs = r.txs_json ? (JSON.parse(r.txs_json) as ActivityRow["txs"]) : [];
      } catch {
        txs = [];
      }
      const base = {
        id: r.activity_id,
        title: r.title || "Send",
        subtitle: r.subtitle ?? "",
        amount: r.amount_sats,
        settled: r.settled === 1,
        createdAt: r.created_at,
        tags,
        txs,
      };
      return {
        ...base,
        status: (r.status as ActivityStatus) || deriveActivityStatus(base),
      };
    });
  } catch {
    return [];
  }
}

/**
 * Immediate outbound row so Activity / View details work before SDK history catches up.
 * Uses real txid when known; otherwise `pending:…` / `local-send:…`.
 */
export function recordOptimisticArkadeSend(
  networkId: ArkadeNetworkId,
  walletId: string,
  opts: { amountSats: number; txid: string; address?: string },
): string {
  const amount = Math.abs(Math.floor(opts.amountSats));
  const raw = opts.txid.trim();
  const address = opts.address?.trim() ?? "";
  const isPending = !raw || raw.startsWith("pending:");
  const id = isPending
    ? raw.startsWith("pending:")
      ? raw
      : `local-send:${Date.now()}`
    : raw;
  const arkTxid = isPending ? "" : raw;
  const now = Date.now();
  const row: ActivityRow = {
    id,
    title: "Send",
    subtitle: address || (arkTxid ? arkTxid.slice(0, 16) : "Outgoing"),
    amount: amount > 0 ? -amount : 0,
    settled: !isPending,
    status: isPending ? "preconfirmed" : "preconfirmed",
    createdAt: now,
    tags: ["offchain"],
    txs: [
      {
        type: "SENT",
        amount: amount > 0 ? -amount : 0,
        settled: !isPending,
        createdAt: now,
        tag: "offchain",
        boardingTxid: "",
        commitmentTxid: "",
        arkTxid,
      },
    ],
  };
  upsertActivityRows(networkId, walletId, [row]);
  recordSentFromThisDevice(networkId, walletId, id);
  return id;
}

/** Snapshot local unilateral-exit rows so SDK rematerialize does not wipe them. */
function readLocalExitRows(
  networkId: ArkadeNetworkId,
  walletId: string,
): ActivityRow[] {
  const db = getAccountDb(networkId);
  try {
    const rows = db.getAllSync<{
      activity_id: string;
      amount_sats: number;
      created_at: number;
      settled: number;
      title: string;
      subtitle: string | null;
      tags_json: string | null;
      txs_json: string | null;
      status: string | null;
    }>(
      `SELECT activity_id, amount_sats, created_at, settled, title, subtitle, tags_json, txs_json, status
       FROM activity_idx WHERE wallet_id = ? AND activity_id LIKE 'exit:%'`,
      [walletId],
    );
    return rows.map((r) => {
      let tags: string[] = ["exit"];
      let txs: ActivityRow["txs"] = [];
      try {
        tags = r.tags_json ? (JSON.parse(r.tags_json) as string[]) : ["exit"];
      } catch {
        tags = ["exit"];
      }
      try {
        txs = r.txs_json ? (JSON.parse(r.txs_json) as ActivityRow["txs"]) : [];
      } catch {
        txs = [];
      }
      const base = {
        id: r.activity_id,
        title: r.title || "Unilateral exit",
        subtitle: r.subtitle ?? "",
        amount: r.amount_sats,
        settled: r.settled === 1,
        createdAt: r.created_at,
        tags: tags.includes("exit") ? tags : [...tags, "exit"],
        txs,
      };
      return {
        ...base,
        status: (r.status as ActivityStatus) || deriveActivityStatus(base),
      };
    });
  } catch {
    return [];
  }
}

/** Full replace for a wallet so coalesced/removed phases do not linger.
 * Preserves prior created_at per activity_id so rematerialize does not look like
 * brand-new receives (SDK often sends createdAt 0 → Date.now()).
 * Also preserves local `exit:*` rows (unilateral exit is not in SDK history).
 * Skips wipe when SDK returns empty but we already have rows (indexer lag after send).
 */
export function replaceActivityRows(
  networkId: ArkadeNetworkId,
  walletId: string,
  rows: ActivityRow[],
): void {
  const db = getAccountDb(networkId);
  let existingCount = 0;
  try {
    const existing = db.getFirstSync<{ c: number }>(
      `SELECT COUNT(*) AS c FROM activity_idx WHERE wallet_id = ?`,
      [walletId],
    );
    existingCount = existing?.c ?? 0;
  } catch {
    existingCount = 0;
  }

  if (rows.length === 0 && existingCount > 0) {
    console.warn("[basic] skip empty activity rematerialize (keeping local rows)");
    return;
  }

  const preserved = new Map<string, number>();
  const localExits = readLocalExitRows(networkId, walletId);
  const localPending = readLocalPendingSendRows(networkId, walletId);
  try {
    const prev = db.getAllSync<{ activity_id: string; created_at: number }>(
      `SELECT activity_id, created_at FROM activity_idx WHERE wallet_id = ?`,
      [walletId],
    );
    for (const p of prev) {
      if (p.created_at > 0) preserved.set(p.activity_id, p.created_at);
    }
  } catch {
    /* empty */
  }

  const withoutDupLocals = rows.filter(
    (r) => !isLocalExitActivityId(r.id) && !isLocalPendingSendId(r.id),
  );

  // Partial SDK history must not wipe older local rows (seen: 1 receive → empty list).
  if (existingCount > 0 && withoutDupLocals.length > 0 && withoutDupLocals.length < existingCount) {
    console.warn("[basic] merge activity upsert (SDK returned fewer rows)", {
      incoming: withoutDupLocals.length,
      existing: existingCount,
    });
    upsertActivityRows(networkId, walletId, withoutDupLocals, preserved);
    if (localExits.length > 0) {
      upsertActivityRows(networkId, walletId, localExits, preserved);
    }
    return;
  }

  db.runSync(`DELETE FROM activity_idx WHERE wallet_id = ?`, [walletId]);
  try {
    db.runSync(`DELETE FROM activity_fts WHERE wallet_id = ?`, [walletId]);
  } catch {
    /* FTS optional */
  }
  upsertActivityRows(networkId, walletId, withoutDupLocals, preserved);
  if (localExits.length > 0) {
    upsertActivityRows(networkId, walletId, localExits, preserved);
  }
  // Drop pending:* once SDK history includes the same ark txid or matching amount.
  const pendingToKeep = localPending.filter((p) => {
    const abs = Math.abs(p.amount);
    const ark = (p.txs[0]?.arkTxid || "").toLowerCase();
    const matched = withoutDupLocals.some((r) => {
      if (!(r.amount < 0)) return false;
      if (Math.abs(Math.abs(r.amount) - abs) > 1) return false;
      if (ark && r.id.toLowerCase() === ark) return true;
      if (ark && r.txs.some((t) => (t.arkTxid || "").toLowerCase() === ark)) return true;
      return Math.abs(r.createdAt - p.createdAt) < 120_000;
    });
    return !matched;
  });
  if (pendingToKeep.length > 0) {
    upsertActivityRows(networkId, walletId, pendingToKeep, preserved);
  }
}

export function upsertActivityRows(
  networkId: ArkadeNetworkId,
  walletId: string,
  rows: ActivityRow[],
  preservedCreatedAt?: Map<string, number>,
): void {
  const db = getAccountDb(networkId);
  for (const row of rows) {
    const kind = kindFromRow(row);
    const prev = db.getFirstSync<{
      fiat_amount: number | null;
      fiat_code: string | null;
      created_at: number;
    }>(
      `SELECT fiat_amount, fiat_code, created_at FROM activity_idx WHERE wallet_id = ? AND activity_id = ?`,
      [walletId, row.id],
    );
    const preserved = preservedCreatedAt?.get(row.id);
    // Prefer stable timestamps: preserved (pre-replace) → existing row → SDK → now.
    const createdAt =
      preserved && preserved > 0
        ? preserved
        : prev?.created_at && prev.created_at > 0
          ? prev.created_at
          : row.createdAt > 0
            ? row.createdAt
            : Date.now();
    const status = row.status || deriveActivityStatus(row);
    db.runSync(
      `INSERT OR REPLACE INTO activity_idx
        (wallet_id, activity_id, amount_sats, created_at, settled, kind, title, subtitle,
         primary_txid, tags_json, txs_json, fiat_amount, fiat_code, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        walletId,
        row.id,
        row.amount,
        createdAt,
        row.settled ? 1 : 0,
        kind,
        row.title,
        row.subtitle,
        row.txs.find((t) => t.boardingTxid)?.boardingTxid ||
          row.txs[0]?.arkTxid ||
          row.txs[0]?.commitmentTxid ||
          null,
        JSON.stringify(row.tags),
        JSON.stringify(row.txs),
        prev?.fiat_amount ?? null,
        prev?.fiat_code ?? null,
        status,
      ],
    );
    const meta = getTxMeta(networkId, walletId, row.id);
    syncActivityFts(networkId, walletId, row.id, row.title, meta?.notes ?? null, meta?.category ?? null);
    enqueueFiatCoverage(networkId, "btc", createdAt);
  }
}

export async function materializeFromArkadeWallet(
  networkId: ArkadeNetworkId,
  walletId: string,
  wallet: BasicWallet,
): Promise<ActivityRow[]> {
  const rows = await loadActivityRows(wallet);
  replaceActivityRows(networkId, walletId, rows);
  applyPendingSendStamps(networkId, walletId, rows);
  return rows;
}

/**
 * Record a completed unilateral exit in activity_idx.
 * Survives SDK rematerialize (id prefix `exit:`).
 * Amount = package recoverable (expected onchain to recovery), not fee-wallet spend.
 */
export function recordUnilateralExitActivity(
  networkId: ArkadeNetworkId,
  walletId: string,
  opts: {
    packageCreatedAt: number;
    /** Package recoverable sats (expected at recovery address). */
    recoveredSats: number;
    /** Sats actually paid to recovery onchain (may be lower if under-delivered). */
    deliveredSats?: number;
    /** Fee-wallet spend for bumps/sweeps (shown as exit fees). */
    fundingRequiredSats?: number;
    sweepAddress: string;
    /** Onchain sweep txid when known. */
    sweepTxid?: string;
    txCount?: number;
    /** Unix seconds or ms; defaults to now. */
    completedAt?: number;
  },
): string {
  const createdAtMs =
    opts.completedAt != null && opts.completedAt > 0
      ? opts.completedAt > 1e12
        ? opts.completedAt
        : opts.completedAt * 1000
      : Date.now();
  const pkgKey =
    opts.packageCreatedAt > 1e12
      ? Math.floor(opts.packageCreatedAt / 1000)
      : opts.packageCreatedAt;
  const id = `exit:${pkgKey}`;
  const recovered = Math.max(0, Math.floor(opts.recoveredSats));
  const delivered =
    opts.deliveredSats != null && opts.deliveredSats >= 0
      ? Math.floor(opts.deliveredSats)
      : undefined;
  const feeSats =
    opts.fundingRequiredSats != null && opts.fundingRequiredSats > 0
      ? Math.floor(opts.fundingRequiredSats)
      : undefined;
  const rawSweep = opts.sweepTxid?.trim() || "";
  const sweepTxid = /^[0-9a-fA-F]{64}$/.test(rawSweep) ? rawSweep : "";
  const sweepAddress = opts.sweepAddress.trim();
  const row: ActivityRow = {
    id,
    title: "Unilateral exit",
    // Full address so Activity detail can show To + enrich from Esplora.
    subtitle: sweepAddress,
    amount: recovered > 0 ? -recovered : 0,
    settled: true,
    status: "confirmed",
    createdAt: createdAtMs,
    tags: ["exit"],
    txs: [
      {
        type: "SENT",
        amount: recovered > 0 ? -recovered : 0,
        settled: true,
        createdAt: createdAtMs,
        tag: "exit",
        boardingTxid: sweepTxid,
        commitmentTxid: "",
        arkTxid: "",
        ...(feeSats != null ? { feeSats } : {}),
        ...(delivered != null ? { deliveredSats: delivered } : {}),
      },
    ],
  };
  upsertActivityRows(networkId, walletId, [row]);
  recordSentFromThisDevice(networkId, walletId, id);
  return id;
}

function mapDbRow(
  networkId: ArkadeNetworkId,
  r: {
    wallet_id: string;
    activity_id: string;
    amount_sats: number;
    created_at: number;
    settled: number;
    kind: string;
    title: string;
    subtitle: string | null;
    primary_txid: string | null;
    tags_json: string | null;
    txs_json: string | null;
    fiat_amount: number | null;
    fiat_code: string | null;
    status: string | null;
  },
): StoredActivity {
  let tags: string[] = [];
  let txs: ActivityRow["txs"] = [];
  try {
    tags = r.tags_json ? (JSON.parse(r.tags_json) as string[]) : [];
  } catch {
    tags = [];
  }
  try {
    txs = r.txs_json ? (JSON.parse(r.txs_json) as ActivityRow["txs"]) : [];
  } catch {
    txs = [];
  }
  const meta = getTxMeta(networkId, r.wallet_id, r.activity_id);
  const title = meta?.name?.trim() || r.title;
  const base = {
    id: r.activity_id,
    title,
    subtitle: r.subtitle ?? "",
    amount: r.amount_sats,
    settled: r.settled === 1,
    createdAt: r.created_at,
    tags,
    txs,
  };
  const status = (r.status as ActivityStatus) || deriveActivityStatus(base);
  return {
    walletId: r.wallet_id,
    ...base,
    status,
    kind: r.kind as ActivityKind,
    fiatAmount: r.fiat_amount,
    fiatCode: r.fiat_code,
  };
}

export function readActivityFromDb(
  networkId: ArkadeNetworkId,
  opts: { walletId?: string | null; limit?: number } = {},
): StoredActivity[] {
  const limit = opts.limit ?? 200;
  const db = getAccountDb(networkId);
  const rows = opts.walletId
    ? db.getAllSync<{
        wallet_id: string;
        activity_id: string;
        amount_sats: number;
        created_at: number;
        settled: number;
        kind: string;
        title: string;
        subtitle: string | null;
        primary_txid: string | null;
        tags_json: string | null;
        txs_json: string | null;
        fiat_amount: number | null;
        fiat_code: string | null;
        status: string | null;
      }>(
        `SELECT * FROM activity_idx WHERE wallet_id = ? ORDER BY
          CASE WHEN created_at <= 0 THEN 1 ELSE 0 END DESC,
          created_at DESC
         LIMIT ?`,
        [opts.walletId, limit],
      )
    : db.getAllSync<{
        wallet_id: string;
        activity_id: string;
        amount_sats: number;
        created_at: number;
        settled: number;
        kind: string;
        title: string;
        subtitle: string | null;
        primary_txid: string | null;
        tags_json: string | null;
        txs_json: string | null;
        fiat_amount: number | null;
        fiat_code: string | null;
        status: string | null;
      }>(
        `SELECT * FROM activity_idx ORDER BY
          CASE WHEN created_at <= 0 THEN 1 ELSE 0 END DESC,
          created_at DESC
         LIMIT ?`,
        [limit],
      );

  return rows.map((r) => mapDbRow(networkId, r));
}

export function getStoredActivity(
  networkId: ArkadeNetworkId,
  walletId: string,
  activityId: string,
): StoredActivity | null {
  return (
    readActivityFromDb(networkId, { walletId, limit: 500 }).find((r) => r.id === activityId) ?? null
  );
}

/**
 * Best-effort match for FundsReceived "View details" — recent inbound row
 * whose amount matches the notice (then closest / most recent of that kind).
 */
export function findRecentReceiveActivityId(
  networkId: ArkadeNetworkId,
  walletId: string,
  amountSats: number,
  kind?: "boarding" | "arkade" | "lightning",
): string | null {
  const abs = Math.abs(amountSats);
  if (!(abs > 0)) return null;
  const rows = readActivityFromDb(networkId, { walletId, limit: 40 });
  const now = Date.now();
  const windowMs = 15 * 60_000;

  const inbound = rows.filter((r) => {
    if (!(r.amount > 0)) return false;
    if (r.createdAt > 0 && now - r.createdAt > windowMs) return false;
    if (kind === "boarding") {
      if (!r.tags.includes("boarding") && !r.tags.includes("batch")) return false;
    } else if (kind === "lightning") {
      if (!r.tags.includes("lightning") && !r.tags.includes("ln")) return false;
    } else if (kind === "arkade") {
      if (r.tags.includes("lightning") || r.tags.includes("ln")) return false;
      if (r.tags.includes("boarding") || r.tags.includes("batch")) return false;
    }
    return true;
  });
  if (!inbound.length) return null;

  const exact = inbound.find((r) => Math.abs(r.amount - abs) <= 1);
  if (exact) return exact.id;

  // Amount can lag (fees / partial settle) — pick closest within 5% or 50 sats.
  let best: (typeof inbound)[0] | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const r of inbound) {
    const d = Math.abs(r.amount - abs);
    if (d < bestDelta) {
      bestDelta = d;
      best = r;
    }
  }
  if (best && (bestDelta <= 50 || bestDelta <= abs * 0.05)) return best.id;

  // Last resort: newest inbound of that kind (still a specific tx page, not the list modal).
  return inbound[0]?.id ?? null;
}

/** Match FundsSent "View details" by raw/sdk txid or payment hash. */
export function findActivityIdByTxid(
  networkId: ArkadeNetworkId,
  walletId: string,
  txid: string,
): string | null {
  const raw = txid.trim();
  if (!raw) return null;
  const needle = raw.toLowerCase();
  const rows = readActivityFromDb(networkId, { walletId, limit: 60 });
  for (const r of rows) {
    if (r.id === raw || r.id.toLowerCase() === needle) return r.id;
    if (r.id.toLowerCase() === `ln-out-${needle}` || r.id.toLowerCase() === `ln-in-${needle}`) {
      return r.id;
    }
    for (const t of r.txs) {
      const keys = [t.arkTxid, t.boardingTxid, t.commitmentTxid]
        .filter(Boolean)
        .map((x) => String(x).toLowerCase());
      if (keys.includes(needle)) return r.id;
    }
  }
  return null;
}

/** Newest outbound row (FundsSent fallback when txid not materialized yet). */
export function findRecentSendActivityId(
  networkId: ArkadeNetworkId,
  walletId: string,
  amountSats: number,
  rail?: "arkade" | "lightning",
): string | null {
  const abs = Math.abs(amountSats);
  const rows = readActivityFromDb(networkId, { walletId, limit: 40 });
  const now = Date.now();
  const outbound = rows.filter((r) => {
    if (!(r.amount < 0)) return false;
    if (r.createdAt > 0 && now - r.createdAt > 15 * 60_000) return false;
    if (rail === "lightning") {
      if (!r.tags.includes("lightning") && !r.tags.includes("ln")) return false;
    } else if (rail === "arkade") {
      if (r.tags.includes("lightning") || r.tags.includes("ln")) return false;
    }
    return true;
  });
  if (!outbound.length) return null;
  if (abs > 0) {
    const exact = outbound.find((r) => Math.abs(Math.abs(r.amount) - abs) <= 1);
    if (exact) return exact.id;
  }
  return outbound[0]?.id ?? null;
}

export function searchActivity(
  networkId: ArkadeNetworkId,
  query: string,
  opts: { walletId?: string | null; limit?: number } = {},
): StoredActivity[] {
  const q = query.trim();
  if (!q) return readActivityFromDb(networkId, opts);
  const limit = opts.limit ?? 100;
  const db = getAccountDb(networkId);
  const ftsQuery = buildFtsPrefixQuery(q);
  try {
    if (!ftsQuery) return readActivityFromDb(networkId, opts);
    const ftsRows = opts.walletId
      ? db.getAllSync<{ activity_id: string; wallet_id: string }>(
          `SELECT activity_id, wallet_id FROM activity_fts
           WHERE activity_fts MATCH ? AND wallet_id = ?
           LIMIT ?`,
          [ftsQuery, opts.walletId, limit],
        )
      : db.getAllSync<{ activity_id: string; wallet_id: string }>(
          `SELECT activity_id, wallet_id FROM activity_fts WHERE activity_fts MATCH ? LIMIT ?`,
          [ftsQuery, limit],
        );
    const out: StoredActivity[] = [];
    for (const hit of ftsRows) {
      const row = getStoredActivity(networkId, hit.wallet_id, hit.activity_id);
      if (row) out.push(row);
    }
    // FTS may miss substring-in-middle cases; merge LIKE-style fallback.
    if (out.length === 0) {
      return filterActivitySubstring(networkId, q, opts);
    }
    return out;
  } catch {
    return filterActivitySubstring(networkId, q, opts);
  }
}

/** FTS5 prefix query: "test" → "test*" so notes like test12aa match. */
function buildFtsPrefixQuery(raw: string): string {
  const cleaned = raw.replace(/["*():^]/g, " ").trim();
  if (!cleaned) return "";
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `${token}*`)
    .join(" ");
}

function filterActivitySubstring(
  networkId: ArkadeNetworkId,
  q: string,
  opts: { walletId?: string | null; limit?: number },
): StoredActivity[] {
  const needle = q.toLowerCase();
  const limit = opts.limit ?? 100;
  const out: StoredActivity[] = [];
  for (const r of readActivityFromDb(networkId, { ...opts, limit: 500 })) {
    const meta = getTxMeta(networkId, r.walletId, r.id);
    const hay = [r.title, r.subtitle, meta?.notes ?? "", meta?.name ?? "", meta?.category ?? ""]
      .join("\n")
      .toLowerCase();
    if (hay.includes(needle)) {
      out.push(r);
      if (out.length >= limit) break;
    }
  }
  return out;
}
