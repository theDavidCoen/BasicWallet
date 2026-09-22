/**
 * Factory reset — wipe device wallet secrets and disposable account data.
 * Preserves:
 * - passkey child labels (PRF rematerialize)
 * - `tx_meta` (notes / name / category) in SQLite — only gone on uninstall
 * - local Path C AEAD cipher + meta in AsyncStorage (still needs nsec+passphrase to open)
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { listWallets } from "../account/walletRegistry";
import { getAccountDb } from "../account/accountDb";
import { getNetworkConfig, type ArkadeNetworkId } from "../config/network";
import { clearNostrIdentity } from "../nostr/identityStore";
import { deleteMnemonic, hasLegacyMnemonic } from "../security/mnemonicStore";
import { clearExitPackage, clearAllExitPackages } from "../exit/packageStore";
import { clearAllRecoveryAddresses } from "../exit/recoveryAddress";
import { clearRecoveryReminderDismissed } from "../exit/recoveryReminder";

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** Survive factory reset (uninstall still wipes the app sandbox). */
const PRESERVE_ASYNC_KEYS = [
  "basic.wallet.passkey.childLabels.v1",
  "basic.wallet.nostr.backup.meta.v1",
  "basic.wallet.nostr.backup.cipher.v1",
];

const SECURE_KEYS_ALWAYS = [
  "basic.wallet.mnemonic.v1",
  "basic.wallet.nostr.nsec.v1",
  "basic.wallet.backup.passphrase.v1",
  "basic.wallet.appPin.v1",
  "basic.wallet.lnd.rest.v1",
  "basic.wallet.lndhub.v1",
  // Clear passkey link so next onboarding uses discoverable get (password manager picker),
  // never a silent create of a brand-new passkey.
  "basic.wallet.passkey.credentialId.v1",
  "basic.wallet.passkey.userId.v1",
];

function wipeAccountTables(networkId: ArkadeNetworkId): void {
  const db = getAccountDb(networkId);
  db.execSync(`DELETE FROM activity_idx;`);
  // Keep tx_meta — notes/name/category rematch by activity_id after restore.
  db.execSync(`DELETE FROM fiat_rate;`);
  db.execSync(`DELETE FROM wallet_registry;`);
  db.execSync(`DELETE FROM account_kv;`);
  try {
    db.execSync(`DELETE FROM activity_fts;`);
  } catch {
    /* fts may be missing */
  }
}

async function clearAsyncPreservingLabels(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const drop = keys.filter((k) => {
    if (PRESERVE_ASYNC_KEYS.includes(k)) return false;
    return (
      k.startsWith("basic.wallet.") ||
      k === "basic.wallet.mnemonic.source" ||
      k === "basic.wallet.nostr.profile.v1"
    );
  });
  if (drop.length) await AsyncStorage.multiRemove(drop);
}

async function clearSecureSlots(walletIds: string[]): Promise<void> {
  const networkId = getNetworkConfig().id;
  for (const id of walletIds) {
    try {
      await deleteMnemonic(id);
    } catch {
      /* missing ok */
    }
    try {
      await clearExitPackage(networkId, id);
    } catch {
      /* missing ok */
    }
  }
  try {
    await clearAllExitPackages();
  } catch {
    /* */
  }
  try {
    await clearAllRecoveryAddresses();
  } catch {
    /* */
  }
  try {
    await clearRecoveryReminderDismissed();
  } catch {
    /* */
  }
  for (const key of SECURE_KEYS_ALWAYS) {
    try {
      await SecureStore.deleteItemAsync(key, SECURE_OPTIONS);
    } catch {
      /* missing ok */
    }
  }
  if (await hasLegacyMnemonic()) {
    try {
      await SecureStore.deleteItemAsync("basic.wallet.mnemonic.v1", SECURE_OPTIONS);
    } catch {
      /* */
    }
  }
  await clearNostrIdentity();
}

/**
 * Wipe seeds, Nostr nsec, caches, and registry.
 * Keeps tx_meta + local AEAD package blob + passkey child labels.
 */
export async function factoryResetWipeDevice(): Promise<void> {
  const networkId = getNetworkConfig().id;
  const wallets = listWallets(networkId);
  const ids = wallets.map((w) => w.id);

  await clearSecureSlots(ids);
  wipeAccountTables(networkId);
  await clearAsyncPreservingLabels();
}

/** @deprecated Use factoryResetWipeDevice */
export const factoryResetKeepBackupPackage = factoryResetWipeDevice;
