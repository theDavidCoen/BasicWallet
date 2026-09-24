/**
 * User metadata for activities (notes / name / category / sent_with).
 * Local SQLite authoritative; also packed into Nostr Path C backup.
 *
 * `sent_with` is set only when Basic itself broadcasts a send — never invent
 * it for history synced from LNbits / SDK.
 */

import type { ArkadeNetworkId } from "../config/network";
import { deviceSendLabel } from "../util/deviceSendLabel";
import { getAccountDb } from "./accountDb";
import {
  rememberPendingSendDestinations,
  rememberSendRecipients,
  takePendingSendDestinations,
} from "./sendDestinations";

export type TxMeta = {
  walletId: string;
  activityId: string;
  name: string | null;
  notes: string | null;
  category: string | null;
  /** Device label recorded at Basic send time, e.g. "Samsung SM-S942B". */
  sentWith: string | null;
  updatedAt: number;
};

type TxMetaRow = {
  wallet_id: string;
  activity_id: string;
  name: string | null;
  notes: string | null;
  category: string | null;
  sent_with: string | null;
  updated_at: number;
};

function mapRow(row: TxMetaRow, walletId = row.wallet_id): TxMeta {
  return {
    walletId,
    activityId: row.activity_id,
    name: row.name,
    notes: row.notes,
    category: row.category,
    sentWith: row.sent_with ?? null,
    updatedAt: row.updated_at,
  };
}

export function getTxMeta(
  networkId: ArkadeNetworkId,
  walletId: string,
  activityId: string,
): TxMeta | null {
  const db = getAccountDb(networkId);
  const row = db.getFirstSync<TxMetaRow>(
    `SELECT wallet_id, activity_id, name, notes, category, sent_with, updated_at
     FROM tx_meta WHERE wallet_id = ? AND activity_id = ?`,
    [walletId, activityId],
  );
  if (row) return mapRow(row);

  // After factory reset, wallet ids change but tx_meta rows survive. Claim by activity_id.
  const orphan = db.getFirstSync<TxMetaRow>(
    `SELECT wallet_id, activity_id, name, notes, category, sent_with, updated_at
     FROM tx_meta WHERE activity_id = ? ORDER BY updated_at DESC LIMIT 1`,
    [activityId],
  );
  if (!orphan) return null;
  if (!orphan.name && !orphan.notes && !orphan.category && !orphan.sent_with) return null;

  db.runSync(`UPDATE tx_meta SET wallet_id = ? WHERE wallet_id = ? AND activity_id = ?`, [
    walletId,
    orphan.wallet_id,
    activityId,
  ]);
  return mapRow(orphan, walletId);
}

export function listAllTxMeta(networkId: ArkadeNetworkId): TxMeta[] {
  const rows = getAccountDb(networkId).getAllSync<TxMetaRow>(
    `SELECT wallet_id, activity_id, name, notes, category, sent_with, updated_at FROM tx_meta`,
  );
  return rows.map((row) => mapRow(row));
}

/** Upsert package rows (Nostr restore). Skips empty meta. */
export function applyTxMetaEntries(networkId: ArkadeNetworkId, entries: TxMeta[]): number {
  let n = 0;
  for (const e of entries) {
    if (!e.walletId || !e.activityId) continue;
    if (!e.name && !e.notes && !e.category && !e.sentWith) continue;
    getAccountDb(networkId).runSync(
      `INSERT OR REPLACE INTO tx_meta
        (wallet_id, activity_id, name, notes, category, sent_with, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        e.walletId,
        e.activityId,
        e.name,
        e.notes,
        e.category,
        e.sentWith ?? null,
        e.updatedAt || Date.now(),
      ],
    );
    const titleRow = getAccountDb(networkId).getFirstSync<{ title: string }>(
      `SELECT title FROM activity_idx WHERE wallet_id = ? AND activity_id = ?`,
      [e.walletId, e.activityId],
    );
    syncActivityFts(
      networkId,
      e.walletId,
      e.activityId,
      titleRow?.title ?? "",
      e.notes,
      e.category,
    );
    n += 1;
  }
  return n;
}

function queueBackupAfterMetaChange(): void {
  void import("../nostr/backupSync")
    .then(async (m) => {
      await m.markBackupPackageDirty();
      if (m.hasSessionBackupPassphrase()) {
        m.scheduleEncryptedBackupSync("tx-meta", 8_000);
      }
    })
    .catch((e) => console.warn("[basic] tx-meta dirty mark failed", e));
}

export function setTxMeta(
  networkId: ArkadeNetworkId,
  walletId: string,
  activityId: string,
  patch: {
    name?: string | null;
    notes?: string | null;
    category?: string | null;
    sentWith?: string | null;
  },
): void {
  const prev = getTxMeta(networkId, walletId, activityId);
  const name = patch.name !== undefined ? patch.name : (prev?.name ?? null);
  const notes = patch.notes !== undefined ? patch.notes : (prev?.notes ?? null);
  const category = patch.category !== undefined ? patch.category : (prev?.category ?? null);
  const sentWith = patch.sentWith !== undefined ? patch.sentWith : (prev?.sentWith ?? null);
  const updatedAt = Date.now();
  getAccountDb(networkId).runSync(
    `INSERT OR REPLACE INTO tx_meta
      (wallet_id, activity_id, name, notes, category, sent_with, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [walletId, activityId, name, notes, category, sentWith, updatedAt],
  );
  const titleRow = getAccountDb(networkId).getFirstSync<{ title: string }>(
    `SELECT title FROM activity_idx WHERE wallet_id = ? AND activity_id = ?`,
    [walletId, activityId],
  );
  const ftsTitle = (name?.trim() || titleRow?.title || "").trim();
  syncActivityFts(networkId, walletId, activityId, ftsTitle, notes, category);
  queueBackupAfterMetaChange();
}

/** Stamp current device on a send Basic just broadcast (not for synced history). */
export function recordSentFromThisDevice(
  networkId: ArkadeNetworkId,
  walletId: string,
  activityId: string,
): void {
  const label = deviceSendLabel().trim();
  if (!label || !activityId) return;
  setTxMeta(networkId, walletId, activityId, { sentWith: label });
}

type PendingSendStamp = {
  networkId: ArkadeNetworkId;
  walletId: string;
  amountSats: number;
  address?: string;
  recipients?: Array<{ address: string; amount: number }>;
  label: string;
  at: number;
};

/** In-memory: send may hang after ASP accepts — still attach device meta on rematerialize. */
const pendingSends: PendingSendStamp[] = [];
const PENDING_SEND_TTL_MS = 15 * 60_000;

function prunePendingSends(now = Date.now()): void {
  for (let i = pendingSends.length - 1; i >= 0; i--) {
    if (now - pendingSends[i].at > PENDING_SEND_TTL_MS) pendingSends.splice(i, 1);
  }
}

/**
 * Call right before wallet.send — survives hung send promises so rematerialize
 * can still attach “Sent with …” and destinations to the outbound activity row.
 */
export function notePendingSendFromThisDevice(
  networkId: ArkadeNetworkId,
  walletId: string,
  amountSats: number,
  address?: string,
  recipients?: Array<{ address: string; amount: number }>,
): void {
  const label = deviceSendLabel().trim();
  if (!label || !walletId || !(amountSats > 0)) return;
  prunePendingSends();
  const abs = Math.abs(amountSats);
  const dests =
    recipients && recipients.length > 0
      ? recipients
      : address?.trim()
        ? [{ address: address.trim(), amount: abs }]
        : [];
  pendingSends.push({
    networkId,
    walletId,
    amountSats: abs,
    address: address?.trim() || dests[0]?.address,
    recipients: dests.length > 0 ? dests : undefined,
    label,
    at: Date.now(),
  });
  if (dests.length > 0) {
    rememberPendingSendDestinations(networkId, walletId, abs, dests);
  }
  console.warn("[basic] pendingSend stamp", {
    walletId: walletId.slice(0, 8),
    amountSats: abs,
    nDest: dests.length,
  });
}

function attachPendingDestinations(
  networkId: ArkadeNetworkId,
  walletId: string,
  row: {
    id: string;
    amount: number;
    txs: Array<{
      arkTxid?: string;
      boardingTxid?: string;
      commitmentTxid?: string;
    }>;
  },
  pending?: PendingSendStamp,
): void {
  const abs = Math.abs(row.amount);
  const list =
    (pending?.recipients && pending.recipients.length > 0
      ? pending.recipients
      : null) ??
    (pending?.address
      ? [{ address: pending.address, amount: abs }]
      : null) ??
    takePendingSendDestinations(networkId, walletId, abs);
  if (!list || list.length === 0) return;
  const related = [
    row.id,
    ...row.txs.map((t) => t.arkTxid),
    ...row.txs.map((t) => t.boardingTxid),
    ...row.txs.map((t) => t.commitmentTxid),
  ].filter((s): s is string => !!s && s.trim().length > 0);
  for (const id of related) {
    rememberSendRecipients(networkId, walletId, id, list);
  }
}

/**
 * After activity rematerialize: attach pending / txid-keyed sent_with onto
 * canonical activity ids (and related ark/boarding/commitment ids).
 */
export function applyPendingSendStamps(
  networkId: ArkadeNetworkId,
  walletId: string,
  rows: {
    id: string;
    amount: number;
    subtitle?: string | null;
    txs: Array<{
      arkTxid?: string;
      boardingTxid?: string;
      commitmentTxid?: string;
    }>;
  }[],
): void {
  prunePendingSends();

  for (const row of rows) {
    if (!(row.amount < 0)) continue;
    const abs = Math.abs(row.amount);
    const related = [
      row.id,
      ...row.txs.map((t) => t.arkTxid),
      ...row.txs.map((t) => t.boardingTxid),
      ...row.txs.map((t) => t.commitmentTxid),
    ].filter((s): s is string => !!s && s.trim().length > 0);

    const pendingIdx = pendingSends.findIndex(
      (p) =>
        p.networkId === networkId &&
        p.walletId === walletId &&
        p.amountSats === abs,
    );
    const pending = pendingIdx >= 0 ? pendingSends[pendingIdx] : undefined;

    // Destinations first — even when sent_with already exists.
    attachPendingDestinations(networkId, walletId, row, pending);

    // Already have meta under activity id or a related txid → migrate onto row.id.
    const existing = resolveSentWithForActivity(networkId, walletId, row.id, related);
    if (existing) {
      if (pendingIdx >= 0) pendingSends.splice(pendingIdx, 1);
      continue;
    }

    if (pendingIdx < 0 || !pending) continue;
    setTxMeta(networkId, walletId, row.id, { sentWith: pending.label });
    for (const id of related) {
      if (id !== row.id) setTxMeta(networkId, walletId, id, { sentWith: pending.label });
    }
    pendingSends.splice(pendingIdx, 1);
    console.warn("[basic] pendingSend attached", {
      activityId: row.id.slice(0, 16),
      amount: abs,
    });
  }
}

/**
 * Resolve “Sent with …” for an activity. Send stamps often use a raw txid
 * before the final activity id is known — also try related txids and migrate.
 */
export function resolveSentWithForActivity(
  networkId: ArkadeNetworkId,
  walletId: string,
  activityId: string,
  relatedIds: string[] = [],
): string | null {
  const db = getAccountDb(networkId);
  const ids = [
    activityId,
    ...relatedIds,
  ]
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();

  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);

    // Prefer wallet-scoped row.
    const scoped = getTxMeta(networkId, walletId, id);
    if (scoped?.sentWith?.trim()) {
      if (id !== activityId) {
        setTxMeta(networkId, walletId, activityId, {
          sentWith: scoped.sentWith.trim(),
        });
      }
      return scoped.sentWith.trim();
    }

    // Any wallet row stamped under this id (factory reset / id remap).
    const any = db.getFirstSync<{ sent_with: string | null }>(
      `SELECT sent_with FROM tx_meta
       WHERE activity_id = ? AND sent_with IS NOT NULL AND TRIM(sent_with) != ''
       ORDER BY updated_at DESC LIMIT 1`,
      [id],
    );
    const label = any?.sent_with?.trim() || null;
    if (label) {
      setTxMeta(networkId, walletId, activityId, { sentWith: label });
      return label;
    }
  }
  return null;
}

export function syncActivityFts(
  networkId: ArkadeNetworkId,
  walletId: string,
  activityId: string,
  title: string,
  notes: string | null,
  category: string | null,
): void {
  try {
    const db = getAccountDb(networkId);
    db.runSync(`DELETE FROM activity_fts WHERE wallet_id = ? AND activity_id = ?`, [
      walletId,
      activityId,
    ]);
    db.runSync(
      `INSERT INTO activity_fts (wallet_id, activity_id, title, notes, category) VALUES (?, ?, ?, ?, ?)`,
      [walletId, activityId, title || "", notes || "", category || ""],
    );
  } catch {
    /* FTS optional */
  }
}
