/**
 * Account-scoped SQLite (registry, activity_idx, tx_meta, fiat_rate).
 * Disposable: rebuildable from engine caches + Nostr meta package.
 * Never stores mnemonics.
 *
 * Keep one open connection per network — do not closeSync when switching
 * (expo-sqlite abort on close with pending work; SIGABRT on device).
 */

import * as SQLite from "expo-sqlite";
import type { ArkadeNetworkId } from "../config/network";
import { openNetworkDatabase } from "./sqliteCipher";

const dbs = new Map<ArkadeNetworkId, SQLite.SQLiteDatabase>();

function dbName(networkId: ArkadeNetworkId): string {
  return `basic-account-${networkId}.db`;
}

export function getAccountDb(networkId: ArkadeNetworkId): SQLite.SQLiteDatabase {
  const hit = dbs.get(networkId);
  if (hit) return hit;

  const next = openNetworkDatabase(networkId, dbName(networkId));
  migrate(next);
  dbs.set(networkId, next);
  return next;
}

function migrate(database: SQLite.SQLiteDatabase): void {
  database.execSync(`
    CREATE TABLE IF NOT EXISTS wallet_registry (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      network_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      tag TEXT,
      meta_json TEXT
    );
  `);

  database.execSync(`
    CREATE TABLE IF NOT EXISTS activity_idx (
      wallet_id TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      amount_sats INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      settled INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      primary_txid TEXT,
      tags_json TEXT,
      txs_json TEXT,
      fiat_amount REAL,
      fiat_code TEXT,
      status TEXT,
      PRIMARY KEY (wallet_id, activity_id)
    );
  `);
  try {
    database.execSync(`ALTER TABLE activity_idx ADD COLUMN status TEXT`);
  } catch {
    /* already present */
  }
  database.execSync(
    `CREATE INDEX IF NOT EXISTS idx_activity_wallet_date ON activity_idx (wallet_id, created_at DESC);`,
  );
  database.execSync(
    `CREATE INDEX IF NOT EXISTS idx_activity_date ON activity_idx (created_at DESC);`,
  );

  database.execSync(`
    CREATE TABLE IF NOT EXISTS tx_meta (
      wallet_id TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      name TEXT,
      notes TEXT,
      category TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (wallet_id, activity_id)
    );
  `);
  try {
    database.execSync(`ALTER TABLE tx_meta ADD COLUMN sent_with TEXT`);
  } catch {
    /* already present */
  }

  database.execSync(`
    CREATE TABLE IF NOT EXISTS fiat_rate (
      asset TEXT NOT NULL,
      fiat_code TEXT NOT NULL,
      bucket INTEGER NOT NULL,
      rate REAL NOT NULL,
      PRIMARY KEY (asset, fiat_code, bucket)
    );
  `);

  // FTS is optional — never crash the app if the build lacks FTS5.
  try {
    database.execSync(`
      CREATE VIRTUAL TABLE IF NOT EXISTS activity_fts USING fts5(
        wallet_id UNINDEXED,
        activity_id UNINDEXED,
        title,
        notes,
        category,
        tokenize = 'porter'
      );
    `);
  } catch (e) {
    console.warn("[basic] activity_fts unavailable", e);
  }

  database.execSync(`
    CREATE TABLE IF NOT EXISTS account_kv (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);

  // Private contacts directory (account-scoped; app uses mainnet DB as canonical).
  database.execSync(`
    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      surname TEXT,
      note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  try {
    database.execSync(`ALTER TABLE contacts ADD COLUMN surname TEXT`);
  } catch {
    /* already present */
  }
  database.execSync(`
    CREATE TABLE IF NOT EXISTS contact_identifiers (
      id TEXT PRIMARY KEY NOT NULL,
      contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      label TEXT,
      custom_kind_label TEXT,
      last_resolved_json TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);
  database.execSync(`
    CREATE TABLE IF NOT EXISTS contact_fields (
      id TEXT PRIMARY KEY NOT NULL,
      contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);
  database.execSync(
    `CREATE INDEX IF NOT EXISTS idx_contact_idents_value ON contact_identifiers (value);`,
  );
  database.execSync(
    `CREATE INDEX IF NOT EXISTS idx_contact_idents_contact ON contact_identifiers (contact_id);`,
  );
}

export function accountKvGet(networkId: ArkadeNetworkId, key: string): string | null {
  const row = getAccountDb(networkId).getFirstSync<{ value: string }>(
    `SELECT value FROM account_kv WHERE key = ?`,
    [key],
  );
  return row?.value ?? null;
}

export function accountKvSet(networkId: ArkadeNetworkId, key: string, value: string): void {
  getAccountDb(networkId).runSync(
    `INSERT OR REPLACE INTO account_kv (key, value) VALUES (?, ?)`,
    [key, value],
  );
}
