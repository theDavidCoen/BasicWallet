/**
 * Account activity_idx — materialize from Arkade SDK (or LN adapter).
 * UI reads here first; pull-to-refresh rematerializes from engine.
 */

import type { ArkadeNetworkId } from "../config/network";
import type {
  ActivityRow,
  ActivityStatus,
  SendRecipientSnapshot,
} from "../wallet/activity";
import {
  activityDepixAtomic,
  deriveActivityStatus,
  loadActivityRows,
} from "../wallet/activity";
import {
  filterUnmatchedLocalReceives,
  matchOptimisticReceive,
  type OptimisticReceiveSource,
} from "../wallet/activityRefresh";
import { depixAtomicToDisplay } from "../fiat/depixAssets";
import type { BasicWallet } from "../wallet/hdWallet";
import { getAccountDb } from "./accountDb";
import { enqueueFiatCoverage } from "./fiatRate";
import {
  looksLikePaymentAddress,
  normalizeSendRecipients,
  recallSendRecipients,
  rememberSendRecipients,
  takePendingSendDestinations,
} from "./sendDestinations";
import { getTxMeta, recordSentFromThisDevice, setTxMeta, syncActivityFts, applyPendingSendStamps } from "./txMeta";

export {
  looksLikePaymentAddress,
  recallSendRecipients,
  rememberSendRecipients,
} from "./sendDestinations";

/** Recipients from txs_json, then account_kv, then a single destination address subtitle. */
export function resolveActivityRecipients(
  networkId: ArkadeNetworkId,
  walletId: string,
  row: ActivityRow,
): SendRecipientSnapshot[] {
  for (const t of row.txs) {
    const fromTx = normalizeSendRecipients(t.recipients);
    if (fromTx.length > 0) return fromTx;
  }
  const fromKv = recallSendRecipients(
    networkId,
    walletId,
    row.id,
    ...row.txs.map((t) => t.arkTxid),
    ...row.txs.map((t) => t.boardingTxid),
    ...row.txs.map((t) => t.commitmentTxid),
  );
  if (fromKv.length > 0) return fromKv;
  const sub = row.subtitle?.trim() ?? "";
  if (looksLikePaymentAddress(sub)) {
    return [{ address: sub, amount: Math.abs(row.amount) }];
  }
  return [];
}

function destinationKeysForRow(row: ActivityRow): string[] {
  return [
    row.id,
    ...row.txs.map((t) => t.arkTxid),
    ...row.txs.map((t) => t.boardingTxid),
    ...row.txs.map((t) => t.commitmentTxid),
  ]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
}

/** Index outbound destinations currently stored for this wallet (before a wipe). */
function harvestDestinationIndex(
  networkId: ArkadeNetworkId,
  walletId: string,
): Map<string, SendRecipientSnapshot[]> {
  const map = new Map<string, SendRecipientSnapshot[]>();
  try {
    const rows = readActivityFromDb(networkId, { walletId, limit: 500 });
    for (const row of rows) {
      if (!(row.amount < 0)) continue;
      const list = resolveActivityRecipients(networkId, walletId, row);
      if (list.length === 0) continue;
      for (const key of destinationKeysForRow(row)) {
        map.set(key.toLowerCase(), list);
        rememberSendRecipients(networkId, walletId, key, list);
      }
    }
  } catch {
    /* empty */
  }
  return map;
}

function withDestinations(
  networkId: ArkadeNetworkId,
  walletId: string,
  rows: ActivityRow[],
  harvested?: Map<string, SendRecipientSnapshot[]>,
): ActivityRow[] {
  const index = harvested ?? new Map<string, SendRecipientSnapshot[]>();
  return rows.map((row) => {
    if (!(row.amount < 0)) return row;
    if (row.txs.some((t) => (t.recipients?.length ?? 0) > 0)) {
      const list = normalizeSendRecipients(row.txs[0]?.recipients);
      if (list.length > 0) {
        for (const key of destinationKeysForRow(row)) {
          rememberSendRecipients(networkId, walletId, key, list);
        }
      }
      return row;
    }
    let list: SendRecipientSnapshot[] = [];
    for (const key of destinationKeysForRow(row)) {
      list = index.get(key.toLowerCase()) ?? [];
      if (list.length > 0) break;
    }
    if (list.length === 0) {
      list = recallSendRecipients(
        networkId,
        walletId,
        ...destinationKeysForRow(row),
      );
    }
    if (list.length === 0) {
      list = takePendingSendDestinations(networkId, walletId, Math.abs(row.amount));
    }
    if (list.length === 0 && looksLikePaymentAddress(row.subtitle ?? "")) {
      list = [{ address: row.subtitle!.trim(), amount: Math.abs(row.amount) }];
    }
    if (list.length === 0 || !row.txs[0]) return row;
    for (const key of destinationKeysForRow(row)) {
      rememberSendRecipients(networkId, walletId, key, list);
    }
    return {
      ...row,
      subtitle:
        list.length > 1 ? `${list.length} recipients` : list[0]!.address,
      txs: [{ ...row.txs[0], recipients: list }, ...row.txs.slice(1)],
    };
  });
}

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

function isLocalPendingReceiveId(activityId: string): boolean {
  return activityId.startsWith("local-recv:");
}

function isLocalOptimisticId(activityId: string): boolean {
  return isLocalPendingSendId(activityId) || isLocalPendingReceiveId(activityId);
}

function inboundHistoryHints(rows: ActivityRow[]) {
  return rows.map((r) => ({
    amount: r.amount,
    createdAt: r.createdAt,
    id: r.id,
    arkTxid: r.txs[0]?.arkTxid,
  }));
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
  opts: {
    amountSats: number;
    txid: string;
    address?: string;
    /** When length > 1, list subtitle becomes "N recipients"; details show addresses. */
    recipients?: Array<{ address: string; amount: number }>;
    /** Designated fiat asset legs (DePix/USDT). */
    assets?: Array<{ assetId: string; amount: bigint | number | string }>;
  },
): string {
  const amount = Math.abs(Math.floor(opts.amountSats));
  const raw = opts.txid.trim();
  const address = opts.address?.trim() ?? "";
  const recipients = normalizeSendRecipients(
    opts.recipients ?? (address ? [{ address, amount }] : undefined),
  );
  const nRecipients = recipients.length || (address ? 1 : 0);
  const isPending = !raw || raw.startsWith("pending:");
  const id = isPending
    ? raw.startsWith("pending:")
      ? raw
      : `local-send:${Date.now()}`
    : raw;
  const arkTxid = isPending ? "" : raw;
  const now = Date.now();
  const subtitle =
    nRecipients > 1
      ? `${nRecipients} recipients`
      : address || recipients[0]?.address || "Outgoing";
  const assetRows =
    opts.assets?.map((a) => ({
      assetId: String(a.assetId),
      amount: String(a.amount),
    })) ?? undefined;
  const hasFiatAsset = Boolean(assetRows?.length);
  const row: ActivityRow = {
    id,
    title: "Send",
    subtitle,
    // Pure asset sends use amount 0 (carrier dust stays off the list fill).
    amount: amount > 0 ? -amount : 0,
    settled: !isPending,
    status: isPending ? "preconfirmed" : "preconfirmed",
    createdAt: now,
    tags: hasFiatAsset ? ["offchain", "brl"] : ["offchain"],
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
        recipients: recipients.length > 0 ? recipients : undefined,
        assets: assetRows,
      },
    ],
  };
  upsertActivityRows(networkId, walletId, [row]);
  recordSentFromThisDevice(networkId, walletId, id);
  if (recipients.length > 0) {
    rememberSendRecipients(networkId, walletId, id, recipients);
    if (arkTxid && arkTxid !== id) {
      rememberSendRecipients(networkId, walletId, arkTxid, recipients);
    }
  }
  console.warn("[basic] optimistic send activity", {
    walletId: walletId.slice(0, 8),
    id: id.slice(0, 16),
    amount: amount > 0 ? -amount : 0,
  });
  return id;
}

/**
 * When spend-drop finished with `pending:…` and SDK later returns the real txid,
 * rewrite the optimistic row so Activity details show Txid.
 */
export function upgradeOptimisticSendTxid(
  networkId: ArkadeNetworkId,
  walletId: string,
  pendingOrLocalId: string,
  realTxid: string,
): string | null {
  const from = pendingOrLocalId.trim();
  const to = realTxid.trim();
  if (!walletId || !from || !to) return null;
  if (!from.startsWith("pending:") && !from.startsWith("local-send:")) return null;
  if (to.startsWith("pending:") || to.startsWith("local-send:")) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(to)) return null;

  const existing = getStoredActivity(networkId, walletId, from);
  if (!existing) return null;

  const recipients =
    resolveActivityRecipients(networkId, walletId, existing) ||
    normalizeSendRecipients(existing.txs[0]?.recipients);
  const now = Date.now();
  const subtitle =
    recipients.length > 1
      ? `${recipients.length} recipients`
      : recipients[0]?.address ||
        existing.subtitle ||
        to.slice(0, 16);
  const row: ActivityRow = {
    ...existing,
    id: to,
    subtitle,
    settled: true,
    status: "preconfirmed",
    createdAt: existing.createdAt > 0 ? existing.createdAt : now,
    txs: existing.txs.map((t, i) =>
      i === 0
        ? {
            ...t,
            settled: true,
            arkTxid: to,
            recipients: recipients.length > 0 ? recipients : t.recipients,
          }
        : t,
    ),
  };

  const db = getAccountDb(networkId);
  db.runSync(`DELETE FROM activity_idx WHERE wallet_id = ? AND activity_id = ?`, [
    walletId,
    from,
  ]);
  upsertActivityRows(networkId, walletId, [row]);
  recordSentFromThisDevice(networkId, walletId, to);
  if (recipients.length > 0) {
    rememberSendRecipients(networkId, walletId, to, recipients);
  }
  // Move sent_with / notes under the real id when present.
  try {
    const meta = getTxMeta(networkId, walletId, from);
    if (meta && (meta.sentWith || meta.notes || meta.name || meta.category)) {
      setTxMeta(networkId, walletId, to, {
        sentWith: meta.sentWith,
        notes: meta.notes,
        name: meta.name,
        category: meta.category,
      });
    }
  } catch {
    /* best-effort */
  }
  return to;
}

/** Upgrade the newest pending/local-send row once the real ark txid is known. */
export function upgradeLatestPendingSendTxid(
  networkId: ArkadeNetworkId,
  walletId: string,
  realTxid: string,
): string | null {
  const to = realTxid.trim();
  if (!walletId || !to || !/^[0-9a-fA-F]{64}$/.test(to)) return null;
  const rows = readActivityFromDb(networkId, { walletId, limit: 30 });
  const pending = rows.find(
    (r) =>
      (r.id.startsWith("pending:") || r.id.startsWith("local-send:")) &&
      r.amount < 0,
  );
  if (!pending) return null;
  return upgradeOptimisticSendTxid(networkId, walletId, pending.id, to);
}

/**
 * Immediate inbound row so Activity updates with FundsNotice before SDK history
 * (materializeFromArkadeWallet often times out on Expo).
 */
export function recordOptimisticArkadeReceive(
  networkId: ArkadeNetworkId,
  walletId: string,
  opts: {
    amountSats: number;
    txid?: string;
    /** Designated fiat asset legs (DePix/USDT display → atomic). */
    assets?: Array<{ assetId: string; amount: bigint | number | string }>;
    source?: OptimisticReceiveSource;
  },
): string {
  const amount = Math.abs(Math.floor(opts.amountSats));
  const raw = opts.txid?.trim() ?? "";
  const source: OptimisticReceiveSource = opts.source ?? "notify-credit";
  const recent = readActivityFromDb(networkId, { walletId, limit: 40 });
  const dup = matchOptimisticReceive(
    recent.map((r) => ({
      id: r.id,
      amount: r.amount,
      createdAt: r.createdAt,
      arkTxid: r.txs[0]?.arkTxid,
    })),
    { amountSats: amount, txid: raw, now: Date.now(), source },
  );
  if (dup) {
    console.warn("[basic] optimistic receive activity", {
      walletId: walletId.slice(0, 8),
      id: dup.slice(0, 16),
      amount,
      source,
      deduped: true,
    });
    return dup;
  }
  const id =
    raw && /^[0-9a-fA-F]{64}$/.test(raw) ? raw : `local-recv:${Date.now()}`;
  const arkTxid = id.startsWith("local-recv:") ? "" : id;
  const now = Date.now();
  const assetRows =
    opts.assets?.map((a) => ({
      assetId: String(a.assetId),
      amount: String(a.amount),
    })) ?? undefined;
  const hasFiatAsset = Boolean(assetRows?.length);
  const row: ActivityRow = {
    id,
    title: "Receive",
    subtitle: arkTxid
      ? arkTxid.slice(0, 16)
      : hasFiatAsset
        ? "Converted"
        : "Receive",
    amount: amount > 0 ? amount : 0,
    settled: false,
    status: "preconfirmed",
    createdAt: now,
    tags: hasFiatAsset ? ["offchain", "brl"] : ["offchain"],
    txs: [
      {
        type: "RECEIVED",
        amount: amount > 0 ? amount : 0,
        settled: false,
        createdAt: now,
        tag: "offchain",
        boardingTxid: "",
        commitmentTxid: "",
        arkTxid,
        assets: assetRows,
      },
    ],
  };
  upsertActivityRows(networkId, walletId, [row]);
  console.warn("[basic] optimistic receive activity", {
    walletId: walletId.slice(0, 8),
    id: id.slice(0, 16),
    amount,
    source,
    deduped: false,
  });
  return id;
}

/** Snapshot optimistic / pending receives so rematerialize does not wipe them. */
function readLocalPendingReceiveRows(
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
         AND activity_id LIKE 'local-recv:%'`,
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
        title: r.title || "Receive",
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
  const localReceives = readLocalPendingReceiveRows(networkId, walletId);
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

  const withoutDupLocals = withDestinations(
    networkId,
    walletId,
    rows.filter((r) => !isLocalExitActivityId(r.id) && !isLocalOptimisticId(r.id)),
    harvestDestinationIndex(networkId, walletId),
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
    const receivesToKeep = filterUnmatchedLocalReceives(
      localReceives.map((p) => ({
        ...p,
        arkTxid: p.txs[0]?.arkTxid || "",
      })),
      inboundHistoryHints(withoutDupLocals),
    );
    if (receivesToKeep.length > 0) {
      upsertActivityRows(networkId, walletId, receivesToKeep, preserved);
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
  const receivesToKeep = filterUnmatchedLocalReceives(
    localReceives.map((p) => ({
      ...p,
      arkTxid: p.txs[0]?.arkTxid || "",
    })),
    inboundHistoryHints(withoutDupLocals),
  );
  if (receivesToKeep.length > 0) {
    upsertActivityRows(networkId, walletId, receivesToKeep, preserved);
  }
}

export function upsertActivityRows(
  networkId: ArkadeNetworkId,
  walletId: string,
  rows: ActivityRow[],
  preservedCreatedAt?: Map<string, number>,
): void {
  const db = getAccountDb(networkId);
  for (const incoming of rows) {
    // Re-attach remembered destinations so SDK rematerialize keeps them in txs_json.
    let row = incoming;
    if (!row.txs.some((t) => (t.recipients?.length ?? 0) > 0)) {
      const remembered = recallSendRecipients(
        networkId,
        walletId,
        row.id,
        ...row.txs.map((t) => t.arkTxid),
        ...row.txs.map((t) => t.boardingTxid),
        ...row.txs.map((t) => t.commitmentTxid),
      );
      if (remembered.length > 0 && row.txs[0]) {
        row = {
          ...row,
          txs: [{ ...row.txs[0], recipients: remembered }, ...row.txs.slice(1)],
        };
      }
    } else if (row.amount < 0) {
      // Refresh kv index from txs_json (covers upgrades pending → real txid).
      const list = normalizeSendRecipients(row.txs[0]?.recipients);
      if (list.length > 0) {
        rememberSendRecipients(networkId, walletId, row.id, list);
        const ark = row.txs[0]?.arkTxid?.trim();
        if (ark && ark !== row.id) {
          rememberSendRecipients(networkId, walletId, ark, list);
        }
      }
    }
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
        // Keep list compact for multi-send; never put a raw txid in subtitle when we have destinations.
        row.txs[0]?.recipients && row.txs[0].recipients.length > 1
          ? `${row.txs[0].recipients.length} recipients`
          : row.txs[0]?.recipients?.length === 1
            ? row.txs[0].recipients[0]!.address
            : row.subtitle,
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

export function commitArkadeActivityRows(
  networkId: ArkadeNetworkId,
  walletId: string,
  rows: ActivityRow[],
): ActivityRow[] {
  replaceActivityRows(networkId, walletId, rows);
  applyPendingSendStamps(networkId, walletId, rows);
  const withDest = withDestinations(networkId, walletId, rows);
  if (withDest.some((r, i) => r !== rows[i])) {
    upsertActivityRows(networkId, walletId, withDest.filter((r) => r.amount < 0));
  }
  return withDest;
}

export async function materializeFromArkadeWallet(
  networkId: ArkadeNetworkId,
  walletId: string,
  wallet: BasicWallet,
): Promise<ActivityRow[]> {
  const rows = await loadActivityRows(wallet);
  return commitArkadeActivityRows(networkId, walletId, rows);
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
  // Re-attach destinations after SDK rematerialize wiped optimistic txs_json fields.
  if (!txs.some((t) => (t.recipients?.length ?? 0) > 0)) {
    const remembered = recallSendRecipients(
      networkId,
      r.wallet_id,
      r.activity_id,
      r.primary_txid,
      ...txs.map((t) => t.arkTxid),
    );
    if (remembered.length > 0 && txs[0]) {
      txs = [{ ...txs[0], recipients: remembered }, ...txs.slice(1)];
    }
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
function activityRowHasDesignatedAsset(
  row: ActivityRow,
  networkId: ArkadeNetworkId,
): boolean {
  return activityDepixAtomic(row, networkId) != null;
}

function activityDepixSignedDisplay(
  row: ActivityRow,
  networkId: ArkadeNetworkId,
): number | null {
  const atomic = activityDepixAtomic(row, networkId);
  if (atomic == null) return null;
  const abs = atomic < 0n ? -atomic : atomic;
  const display = depixAtomicToDisplay(abs, networkId);
  return atomic < 0n ? -display : display;
}

export function findRecentReceiveActivityId(
  networkId: ArkadeNetworkId,
  walletId: string,
  amountSats: number,
  kind?: "boarding" | "arkade" | "lightning" | "brl",
): string | null {
  const abs = Math.abs(amountSats);
  if (!(abs > 0)) return null;
  const rows = readActivityFromDb(networkId, { walletId, limit: 40 });
  const now = Date.now();
  const windowMs = 15 * 60_000;

  const inbound = rows.filter((r) => {
    if (r.createdAt > 0 && now - r.createdAt > windowMs) return false;
    if (kind === "brl") {
      // BRL notice amount is display units (e.g. 2.00), not sats.
      if (!r.tags.includes("brl") && !activityRowHasDesignatedAsset(r, networkId)) {
        return false;
      }
      // Prefer positive / inbound rows (receive).
      const depix = activityDepixSignedDisplay(r, networkId);
      if (depix != null) return depix > 0;
      return r.amount >= 0;
    }
    if (!(r.amount > 0)) return false;
    if (kind === "boarding") {
      if (!r.tags.includes("boarding") && !r.tags.includes("batch")) return false;
    } else if (kind === "lightning") {
      if (!r.tags.includes("lightning") && !r.tags.includes("ln")) return false;
    } else if (kind === "arkade") {
      if (r.tags.includes("lightning") || r.tags.includes("ln")) return false;
      if (r.tags.includes("boarding") || r.tags.includes("batch")) return false;
      if (r.tags.includes("brl")) return false;
    }
    return true;
  });
  if (!inbound.length) return null;

  if (kind === "brl") {
    const exact = inbound.find((r) => {
      const d = activityDepixSignedDisplay(r, networkId);
      return d != null && Math.abs(d - abs) < 0.005;
    });
    if (exact) return exact.id;
    return inbound[0]?.id ?? null;
  }

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
