/**
 * SQLCipher key for account + engine DBs (all networks).
 * Spec: prototype/docs/activity-storage.md § Encryption
 */

import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const KEY_SLOT = "basic.account.db.key.v1";
/** One-time wipe of possible plaintext account DBs before first cipher open. */
const CIPHER_MIGRATED_SLOT = "basic.account.sqlcipher.v1";

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

let cachedKeyHex: string | null = null;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Load or create 32-byte raw key; cache in memory for sync DB opens. */
export async function ensureAccountDbKey(): Promise<string> {
  if (cachedKeyHex) return cachedKeyHex;

  const existing = await SecureStore.getItemAsync(KEY_SLOT, SECURE_OPTIONS);
  if (existing && /^[0-9a-fA-F]{64}$/.test(existing)) {
    cachedKeyHex = existing.toLowerCase();
    return cachedKeyHex;
  }

  const bytes = await Crypto.getRandomBytesAsync(32);
  const hex = bytesToHex(bytes);
  await SecureStore.setItemAsync(KEY_SLOT, hex, SECURE_OPTIONS);
  cachedKeyHex = hex;
  return hex;
}

/** Sync accessor — throws if ensureAccountDbKey has not run. */
export function requireAccountDbKeyHex(): string {
  if (!cachedKeyHex) {
    throw new Error("Account DB key not initialized — call ensureAccountDbKey first");
  }
  return cachedKeyHex;
}

export async function markSqlCipherMigrated(): Promise<void> {
  await SecureStore.setItemAsync(CIPHER_MIGRATED_SLOT, "1", SECURE_OPTIONS);
  await SecureStore.setItemAsync("basic.account.mainnet.sqlcipher.v1", "1", SECURE_OPTIONS);
}

export async function isSqlCipherMigrated(): Promise<boolean> {
  const v = await SecureStore.getItemAsync(CIPHER_MIGRATED_SLOT, SECURE_OPTIONS);
  return v === "1";
}

/** True if an older mainnet-only cipher migration already ran. */
export async function hadLegacyMainnetCipherMigration(): Promise<boolean> {
  const v = await SecureStore.getItemAsync("basic.account.mainnet.sqlcipher.v1", SECURE_OPTIONS);
  return v === "1";
}
