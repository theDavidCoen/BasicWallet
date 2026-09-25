/**
 * SDK 0.5 dropped `virtual_status_json` from vtxos (canonical `expires_at` etc.).
 * Older Basic DBs still have `virtual_status_json TEXT NOT NULL`. When `script` is
 * already NOT NULL, SDK `migrateVtxosTable` returns early and never drops that
 * column, so `saveVtxos` fails with NOT NULL → Home "sync failed".
 *
 * Rebuild any prefixed vtxos table that still carries the legacy column.
 */

import type { SQLExecutor } from "@arkade-os/sdk/repositories/sqlite";

type PragmaCol = { name: string };

const VTXOS_CREATE = (table: string) => `CREATE TABLE ${table} (
  txid TEXT NOT NULL,
  vout INTEGER NOT NULL,
  value INTEGER NOT NULL,
  address TEXT NOT NULL,
  tap_tree TEXT NOT NULL,
  forfeit_cb TEXT NOT NULL,
  forfeit_s TEXT NOT NULL,
  intent_cb TEXT NOT NULL,
  intent_s TEXT NOT NULL,
  status_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  is_unrolled INTEGER NOT NULL DEFAULT 0,
  is_spent INTEGER,
  is_swept INTEGER,
  is_preconfirmed INTEGER,
  commitment_txids_json TEXT,
  expires_at TEXT,
  expires_at_height INTEGER,
  spent_by TEXT,
  settled_by TEXT,
  ark_tx_id TEXT,
  extra_witness_json TEXT,
  assets_json TEXT,
  script TEXT NOT NULL,
  PRIMARY KEY (txid, vout)
)`;

export async function migrateLegacyVtxoVirtualStatus(
  db: SQLExecutor,
  tablePrefix: string,
): Promise<boolean> {
  const table = `${tablePrefix}vtxos`;
  const exists = await db.get<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [table],
  );
  if (!exists) return false;

  const cols = await db.all<PragmaCol>(`PRAGMA table_info(${table})`);
  if (!cols.some((c) => c.name === "virtual_status_json")) return false;

  const nullableCanonical: [string, string][] = [
    ["is_swept", "INTEGER"],
    ["is_preconfirmed", "INTEGER"],
    ["commitment_txids_json", "TEXT"],
    ["expires_at", "TEXT"],
    ["expires_at_height", "INTEGER"],
  ];
  for (const [name, type] of nullableCanonical) {
    if (!cols.some((c) => c.name === name)) {
      await db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }

  const temp = `${table}__drop_virtual_status`;
  await db.run("BEGIN IMMEDIATE");
  try {
    await db.run(`DROP TABLE IF EXISTS ${temp}`);
    await db.run(VTXOS_CREATE(temp));
    await db.run(`
      INSERT INTO ${temp}
        (txid, vout, value, address, tap_tree,
         forfeit_cb, forfeit_s, intent_cb, intent_s,
         status_json, created_at, is_unrolled, is_spent,
         is_swept, is_preconfirmed, commitment_txids_json,
         expires_at, expires_at_height,
         spent_by, settled_by, ark_tx_id, extra_witness_json, assets_json, script)
      SELECT txid, vout, value, address, tap_tree,
             forfeit_cb, forfeit_s, intent_cb, intent_s,
             status_json, created_at, is_unrolled, is_spent,
             is_swept, is_preconfirmed, commitment_txids_json,
             expires_at, expires_at_height,
             spent_by, settled_by, ark_tx_id, extra_witness_json, assets_json,
             COALESCE(script, '')
      FROM ${table}
    `);
    await db.run(`DROP TABLE ${table}`);
    await db.run(`ALTER TABLE ${temp} RENAME TO ${table}`);
    await db.run(
      `CREATE INDEX IF NOT EXISTS idx_${tablePrefix}vtxos_address ON ${table} (address)`,
    );
    await db.run(
      `CREATE INDEX IF NOT EXISTS idx_${tablePrefix}vtxos_script ON ${table} (script)`,
    );
    await db.run("COMMIT");
  } catch (e) {
    try {
      await db.run("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }

  console.warn("[basic] migrated legacy vtxos virtual_status_json off", { table });
  return true;
}
