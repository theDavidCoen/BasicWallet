/**
 * Multi-wallet registry (Personal, Savings, Lightning row, …).
 * Spec: ux-ui-spec §2/§5 — Home = selected wallet only.
 */

import type { ArkadeNetworkId } from "../config/network";
import { accountKvGet, accountKvSet, getAccountDb } from "./accountDb";

export type WalletKind = "arkade" | "lightning" | "multisig";

export type WalletRecord = {
  id: string;
  kind: WalletKind;
  label: string;
  networkId: ArkadeNetworkId;
  createdAt: number;
  sortOrder: number;
  /** Switcher tag e.g. main / BTCPay */
  tag: string | null;
  meta: Record<string, unknown> | null;
};

const SELECTED_KEY = "selected_wallet_id";

function newId(): string {
  return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function rowToRecord(row: {
  id: string;
  kind: string;
  label: string;
  network_id: string;
  created_at: number;
  sort_order: number;
  tag: string | null;
  meta_json: string | null;
}): WalletRecord {
  let meta: Record<string, unknown> | null = null;
  if (row.meta_json) {
    try {
      meta = JSON.parse(row.meta_json) as Record<string, unknown>;
    } catch {
      meta = null;
    }
  }
  return {
    id: row.id,
    kind: row.kind as WalletKind,
    label: row.label,
    networkId: row.network_id as ArkadeNetworkId,
    createdAt: row.created_at,
    sortOrder: row.sort_order,
    tag: row.tag,
    meta,
  };
}

export function listWallets(networkId: ArkadeNetworkId): WalletRecord[] {
  const rows = getAccountDb(networkId).getAllSync<{
    id: string;
    kind: string;
    label: string;
    network_id: string;
    created_at: number;
    sort_order: number;
    tag: string | null;
    meta_json: string | null;
  }>(
    `SELECT * FROM wallet_registry WHERE network_id = ? ORDER BY sort_order ASC, created_at ASC`,
    [networkId],
  );
  return rows.map(rowToRecord);
}

export function getWallet(networkId: ArkadeNetworkId, id: string): WalletRecord | null {
  const row = getAccountDb(networkId).getFirstSync<{
    id: string;
    kind: string;
    label: string;
    network_id: string;
    created_at: number;
    sort_order: number;
    tag: string | null;
    meta_json: string | null;
  }>(`SELECT * FROM wallet_registry WHERE id = ? AND network_id = ?`, [id, networkId]);
  return row ? rowToRecord(row) : null;
}

export function insertWallet(
  networkId: ArkadeNetworkId,
  input: {
    id?: string;
    kind: WalletKind;
    label: string;
    tag?: string | null;
    meta?: Record<string, unknown> | null;
  },
): WalletRecord {
  const id = input.id ?? newId();
  const createdAt = Date.now();
  const existing = listWallets(networkId);
  const sortOrder = existing.length;
  getAccountDb(networkId).runSync(
    `INSERT INTO wallet_registry (id, kind, label, network_id, created_at, sort_order, tag, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.kind,
      input.label.trim() || "Wallet",
      networkId,
      createdAt,
      sortOrder,
      input.tag ?? null,
      input.meta ? JSON.stringify(input.meta) : null,
    ],
  );
  return getWallet(networkId, id)!;
}

export function updateWalletLabel(networkId: ArkadeNetworkId, id: string, label: string): void {
  getAccountDb(networkId).runSync(`UPDATE wallet_registry SET label = ? WHERE id = ? AND network_id = ?`, [
    label.trim() || "Wallet",
    id,
    networkId,
  ]);
}

export function updateWalletTag(networkId: ArkadeNetworkId, id: string, tag: string | null): void {
  getAccountDb(networkId).runSync(`UPDATE wallet_registry SET tag = ? WHERE id = ? AND network_id = ?`, [
    tag,
    id,
    networkId,
  ]);
}

export function removeWallet(networkId: ArkadeNetworkId, id: string): void {
  getAccountDb(networkId).runSync(`DELETE FROM wallet_registry WHERE id = ? AND network_id = ?`, [
    id,
    networkId,
  ]);
  getAccountDb(networkId).runSync(`DELETE FROM activity_idx WHERE wallet_id = ?`, [id]);
  getAccountDb(networkId).runSync(`DELETE FROM tx_meta WHERE wallet_id = ?`, [id]);
  getAccountDb(networkId).runSync(`DELETE FROM activity_fts WHERE wallet_id = ?`, [id]);
}

export function getSelectedWalletId(networkId: ArkadeNetworkId): string | null {
  return accountKvGet(networkId, SELECTED_KEY);
}

export function setSelectedWalletId(networkId: ArkadeNetworkId, id: string): void {
  accountKvSet(networkId, SELECTED_KEY, id);
}

/** Ensure at least Personal exists when migrating from single-wallet installs. */
export function ensurePersonalWallet(networkId: ArkadeNetworkId): WalletRecord {
  const all = listWallets(networkId);
  const personal = all.find((w) => w.kind === "arkade" && (w.tag === "main" || w.label === "Personal"));
  if (personal) {
    if (!getSelectedWalletId(networkId)) setSelectedWalletId(networkId, personal.id);
    return personal;
  }
  if (all.length > 0) {
    const first = all[0]!;
    if (!getSelectedWalletId(networkId)) setSelectedWalletId(networkId, first.id);
    return first;
  }
  const created = insertWallet(networkId, {
    kind: "arkade",
    label: "Personal",
    tag: "main",
  });
  setSelectedWalletId(networkId, created.id);
  return created;
}

export function avatarLetter(label: string): string {
  const t = label.trim();
  return (t[0] ?? "?").toUpperCase();
}
