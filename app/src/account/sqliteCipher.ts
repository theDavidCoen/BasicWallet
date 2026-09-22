/**
 * Open expo-sqlite DBs with SQLCipher for every network.
 * Spec: prototype/docs/activity-storage.md
 *
 * Header probe via sync XHR is not available on React Native — we rely on
 * PRAGMA cipher_version + a page read, then fail closed / wipe+retry.
 */

import * as SQLite from "expo-sqlite";
import type { ArkadeNetworkId } from "../config/network";
import { requireAccountDbKeyHex } from "../security/accountDbKey";

function pragmaKeySql(keyHex: string): string {
  return `PRAGMA key = "x'${keyHex}'"`;
}

function assertCipherEngaged(db: SQLite.SQLiteDatabase): void {
  const ver = db.getFirstSync<{ cipher_version: string | null }>("PRAGMA cipher_version");
  if (!ver?.cipher_version) {
    throw new Error(
      "SQLCipher not available — rebuild native app with expo-sqlite useSQLCipher: true",
    );
  }
  // Touch a page — wrong key / plaintext-with-key fails here.
  db.getFirstSync<{ c: number }>("SELECT count(*) AS c FROM sqlite_master");
}

function applyCommonPragmas(db: SQLite.SQLiteDatabase): void {
  db.execSync("PRAGMA journal_mode = WAL;");
  db.execSync("PRAGMA foreign_keys = ON;");
  db.execSync("PRAGMA busy_timeout = 5000;");
}

function openWithKey(databaseName: string, keyHex: string): SQLite.SQLiteDatabase {
  const db = SQLite.openDatabaseSync(databaseName);
  db.execSync(pragmaKeySql(keyHex));
  assertCipherEngaged(db);
  applyCommonPragmas(db);
  // Ensure at least one write so the on-disk file is encrypted (empty DBs stay empty).
  db.execSync("CREATE TABLE IF NOT EXISTS __basic_cipher_probe (i INTEGER PRIMARY KEY);");
  db.execSync("INSERT OR IGNORE INTO __basic_cipher_probe (i) VALUES (1);");
  return db;
}

/**
 * Open a DB with SQLCipher (all networks).
 * On open failure (leftover plaintext), delete and retry once.
 */
export function openNetworkDatabase(
  _networkId: ArkadeNetworkId,
  databaseName: string,
): SQLite.SQLiteDatabase {
  const keyHex = requireAccountDbKeyHex();
  try {
    return openWithKey(databaseName, keyHex);
  } catch (e) {
    console.warn("[basic] DB open failed — wipe + rematerialize", databaseName, e);
    try {
      SQLite.deleteDatabaseSync(databaseName);
    } catch (delErr) {
      console.warn("[basic] deleteDatabaseSync failed", databaseName, delErr);
    }
    return openWithKey(databaseName, keyHex);
  }
}

/** Wipe leftover plaintext account DBs once (all networks, or mutinynet-only after legacy mainnet cipher). */
export function wipePlaintextAccountDbsIfNeeded(opts: {
  fullyMigrated: boolean;
  legacyMainnetOnly: boolean;
}): void {
  if (opts.fullyMigrated) return;
  const names = opts.legacyMainnetOnly
    ? ["basic-account-mutinynet.db"]
    : ["basic-account-mainnet.db", "basic-account-mutinynet.db"];
  for (const name of names) {
    try {
      SQLite.deleteDatabaseSync(name);
    } catch (e) {
      console.warn("[basic] account wipe skipped", name, e);
    }
  }
}
