/**
 * Per-wallet mnemonic slots in SecureStore.
 * Migrates legacy single key `basic.wallet.mnemonic.v1` → Personal wallet id.
 */

import * as SecureStore from "expo-secure-store";

const LEGACY_KEY = "basic.wallet.mnemonic.v1";

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function keyFor(walletId: string): string {
  return `basic.wallet.mnemonic.v2.${walletId}`;
}

export async function hasMnemonic(walletId: string): Promise<boolean> {
  const v = await SecureStore.getItemAsync(keyFor(walletId), SECURE_OPTIONS);
  return typeof v === "string" && v.length > 0;
}

/** True if any known mnemonic exists (legacy or any v2 slot we can check via registry caller). */
export async function hasLegacyMnemonic(): Promise<boolean> {
  const v = await SecureStore.getItemAsync(LEGACY_KEY, SECURE_OPTIONS);
  return typeof v === "string" && v.length > 0;
}

export async function storeMnemonic(walletId: string, mnemonic: string): Promise<void> {
  const trimmed = mnemonic.trim();
  if (!trimmed) throw new Error("Refusing to store empty mnemonic");
  await SecureStore.setItemAsync(keyFor(walletId), trimmed, SECURE_OPTIONS);
}

export async function loadMnemonicForCrypto(walletId: string): Promise<string | null> {
  return SecureStore.getItemAsync(keyFor(walletId), SECURE_OPTIONS);
}

export async function deleteMnemonic(walletId: string): Promise<void> {
  await SecureStore.deleteItemAsync(keyFor(walletId), SECURE_OPTIONS);
}

/**
 * Move legacy single mnemonic into the given wallet id slot (once).
 * Returns true if a mnemonic is available for walletId after migration.
 */
export async function migrateLegacyMnemonicIfNeeded(walletId: string): Promise<boolean> {
  if (await hasMnemonic(walletId)) return true;
  const legacy = await SecureStore.getItemAsync(LEGACY_KEY, SECURE_OPTIONS);
  if (!legacy) return false;
  await SecureStore.setItemAsync(keyFor(walletId), legacy, SECURE_OPTIONS);
  // Keep legacy key until we're confident; still readable for old code paths.
  // Prefer delete to avoid dual source of truth:
  await SecureStore.deleteItemAsync(LEGACY_KEY, SECURE_OPTIONS);
  return true;
}

/** @deprecated Prefer hasMnemonic(walletId) */
export async function hasAnyMnemonic(walletIds: string[]): Promise<boolean> {
  if (await hasLegacyMnemonic()) return true;
  for (const id of walletIds) {
    if (await hasMnemonic(id)) return true;
  }
  return false;
}
