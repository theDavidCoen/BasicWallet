/**
 * Path C encrypted multi-wallet package.
 * wrap_key = PBKDF2(SHA-256, nsec || passphrase, salt, 50_000) → AES-256-GCM.
 * nsec alone must not decrypt (passphrase always required).
 *
 * 50k assumes a high-entropy passphrase (password-manager random). UI must
 * recommend that; weak human passphrases are a user risk at this iter count.
 * pbkdf2Async + salt reuse + session wrap-key cache keep re-pack off the UI path.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { gcm } from "@noble/ciphers/aes.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import * as Crypto from "expo-crypto";
import { applyTxMetaEntries, listAllTxMeta, type TxMeta } from "../account/txMeta";
import { loadMnemonicForCrypto } from "../security/mnemonicStore";
import { listWallets, type WalletRecord } from "../account/walletRegistry";
import { getNetworkConfig } from "../config/network";
import { loadNostrKeyPairForCrypto } from "./identityStore";
import { validateBackupPassphrase } from "./passphrasePolicy";

const PACKAGE_META_KEY = "basic.wallet.nostr.backup.meta.v1";
const PACKAGE_CIPHER_KEY = "basic.wallet.nostr.backup.cipher.v1";

const PBKDF2_ITERS = 50_000;
/** Blobs created before iters was stored used this count. */
const PBKDF2_ITERS_LEGACY = 210_000;
/** Yield to JS event loop every N ms of KDF work (keeps UI alive). */
const PBKDF2_ASYNC_TICK_MS = 48;
const SALT_LEN = 16;
const IV_LEN = 12;

export type CipherBlob = {
  saltHex: string;
  ivHex: string;
  ciphertextHex: string;
  /** PBKDF2 iterations; omit = legacy 210_000. */
  iters?: number;
};

/** RAM-only wrap key for this unlock session (cleared on lock). */
let sessionWrapKey: {
  saltHex: string;
  passphrase: string;
  iters: number;
  key: Uint8Array;
} | null = null;

/** Call when app lock clears the backup passphrase session. */
export function clearSessionWrapKey(): void {
  sessionWrapKey = null;
}

export const DEFAULT_NOSTR_RELAYS = ["wss://relay.damus.io", "wss://nos.lol"];

export const PASSPHRASE_LOSS_CAPTION =
  "Lose this passphrase = lose wallet access.\nSave it offline. Basic cannot recover it.";

export type BackupChannel = "nostr" | "home";

export type BackupPackageMeta = {
  enabled: boolean;
  channel: BackupChannel;
  relays: string[];
  homeUrl: string | null;
  /** @deprecated Prefer SecureStore home creds token; kept for older installs. */
  homeToken: string | null;
  /** Nextcloud / WebDAV username (non-secret). */
  homeUser: string | null;
  npub: string;
  updatedAt: number;
  walletCount: number;
  txMetaCount?: number;
  lastPublishedAt?: number;
  lastPublishOk?: number;
  lastPublishFail?: number;
};

export type WalletPackageEntry = {
  id: string;
  label: string;
  kind: string;
  tag: string | null;
  mnemonic: string;
};

export type TxMetaPackageEntry = {
  walletId: string;
  activityId: string;
  name: string | null;
  notes: string | null;
  category: string | null;
  /** Present only for sends Basic broadcast from a device. */
  sentWith?: string | null;
  updatedAt: number;
};

export type DecryptedBackupPackage = {
  version: 1;
  createdAt: number;
  npub: string;
  wallets: WalletPackageEntry[];
  /** Optional — older packages omit this. */
  txMeta?: TxMetaPackageEntry[];
};

export async function deriveWrapKey(
  nsec: string,
  passphrase: string,
  salt: Uint8Array,
  iters: number = PBKDF2_ITERS,
): Promise<Uint8Array> {
  const saltHex = bytesToHex(salt);
  if (
    sessionWrapKey &&
    sessionWrapKey.saltHex === saltHex &&
    sessionWrapKey.passphrase === passphrase &&
    sessionWrapKey.iters === iters
  ) {
    return sessionWrapKey.key;
  }
  const pass = utf8ToBytes(`${nsec}\n${passphrase}`);
  const key = await pbkdf2Async(sha256, pass, salt, {
    c: iters,
    dkLen: 32,
    asyncTick: PBKDF2_ASYNC_TICK_MS,
  });
  sessionWrapKey = { saltHex, passphrase, iters, key };
  return key;
}

function blobIters(blob: { iters?: number }): number {
  return typeof blob.iters === "number" && blob.iters > 0 ? blob.iters : PBKDF2_ITERS_LEGACY;
}

export async function encryptPackage(
  plaintext: DecryptedBackupPackage,
  nsec: string,
  passphrase: string,
  opts?: { reuseSaltHex?: string },
): Promise<CipherBlob> {
  if (!passphrase.trim()) throw new Error("Backup passphrase required");
  // Refresh reuses salt → session wrap-key cache hits after first KDF at current iters.
  // New salt only on first enable (or passphrase change via re-enable).
  const salt = opts?.reuseSaltHex
    ? hexToBytes(opts.reuseSaltHex)
    : await Crypto.getRandomBytesAsync(SALT_LEN);
  const iv = await Crypto.getRandomBytesAsync(IV_LEN);
  const key = await deriveWrapKey(nsec, passphrase, salt, PBKDF2_ITERS);
  const aes = gcm(key, iv);
  const ct = aes.encrypt(utf8ToBytes(JSON.stringify(plaintext)));
  return {
    saltHex: bytesToHex(salt),
    ivHex: bytesToHex(iv),
    ciphertextHex: bytesToHex(ct),
    iters: PBKDF2_ITERS,
  };
}

export async function decryptPackage(
  blob: CipherBlob,
  nsec: string,
  passphrase: string,
): Promise<DecryptedBackupPackage> {
  if (!passphrase.trim()) throw new Error("Backup passphrase required");
  const salt = hexToBytes(blob.saltHex);
  const iv = hexToBytes(blob.ivHex);
  const key = await deriveWrapKey(nsec, passphrase, salt, blobIters(blob));
  const aes = gcm(key, iv);
  const pt = aes.decrypt(hexToBytes(blob.ciphertextHex));
  const text = new TextDecoder().decode(pt);
  const parsed = JSON.parse(text) as DecryptedBackupPackage;
  if (parsed.version !== 1 || !Array.isArray(parsed.wallets)) {
    throw new Error("Invalid backup package");
  }
  return parsed;
}

export async function readBackupMeta(): Promise<BackupPackageMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(PACKAGE_META_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BackupPackageMeta;
  } catch {
    return null;
  }
}

export async function readCipherBlob(): Promise<CipherBlob | null> {
  try {
    const raw = await AsyncStorage.getItem(PACKAGE_CIPHER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CipherBlob;
  } catch {
    return null;
  }
}

async function collectWalletEntries(wallets: WalletRecord[]): Promise<WalletPackageEntry[]> {
  const out: WalletPackageEntry[] = [];
  for (const w of wallets) {
    if (w.kind !== "arkade") continue;
    const mnemonic = await loadMnemonicForCrypto(w.id);
    if (!mnemonic?.trim()) continue;
    out.push({
      id: w.id,
      label: w.label,
      kind: w.kind,
      tag: w.tag,
      mnemonic: mnemonic.trim(),
    });
  }
  return out;
}

function collectTxMetaEntries(): TxMetaPackageEntry[] {
  const networkId = getNetworkConfig().id;
  return listAllTxMeta(networkId)
    .filter((m) => m.name || m.notes || m.category || m.sentWith)
    .map((m) => ({
      walletId: m.walletId,
      activityId: m.activityId,
      name: m.name,
      notes: m.notes,
      category: m.category,
      sentWith: m.sentWith,
      updatedAt: m.updatedAt,
    }));
}

/** Apply notes/name/category from a decrypted package into local SQLite. */
export function restoreTxMetaFromPackage(pkg: DecryptedBackupPackage): number {
  if (!pkg.txMeta?.length) return 0;
  const networkId = getNetworkConfig().id;
  const entries: TxMeta[] = pkg.txMeta.map((e) => ({
    walletId: e.walletId,
    activityId: e.activityId,
    name: e.name,
    notes: e.notes,
    category: e.category,
    sentWith: e.sentWith ?? null,
    updatedAt: e.updatedAt,
  }));
  return applyTxMetaEntries(networkId, entries);
}

export type EnableBackupInput = {
  channel: BackupChannel;
  passphrase: string;
  relays?: string[];
  homeUrl?: string;
  homeToken?: string | null;
  homeUser?: string | null;
  homePassword?: string | null;
  /** When set (refresh), keep salt so wrap key can stay cached. */
  reuseSaltHex?: string;
};

/**
 * Build + store encrypted package for current network wallets + tx notes.
 * Requires an existing Nostr identity in Keystore.
 */
export async function enableEncryptedBackup(input: EnableBackupInput): Promise<BackupPackageMeta> {
  const pair = await loadNostrKeyPairForCrypto();
  if (!pair) throw new Error("No Nostr identity — create or import nsec first");

  const passphrase = input.passphrase;
  const check = validateBackupPassphrase(passphrase);
  if (!check.ok) throw new Error(check.message);

  const networkId = getNetworkConfig().id;
  const wallets = listWallets(networkId);
  const entries = await collectWalletEntries(wallets);
  if (!entries.length) throw new Error("No seed wallets to back up");
  console.warn(
    "[basic] encrypt backup package",
    entries.length,
    entries.map((e) => e.label),
  );

  const txMeta = collectTxMetaEntries();

  const plaintext: DecryptedBackupPackage = {
    version: 1,
    createdAt: Date.now(),
    npub: pair.npub,
    wallets: entries,
    txMeta,
  };

  const blob = await encryptPackage(plaintext, pair.nsec, check.passphrase, {
    reuseSaltHex: input.reuseSaltHex,
  });
  await AsyncStorage.setItem(PACKAGE_CIPHER_KEY, JSON.stringify(blob));

  const meta: BackupPackageMeta = {
    enabled: true,
    channel: input.channel,
    relays: input.relays?.length ? input.relays : DEFAULT_NOSTR_RELAYS,
    homeUrl: input.homeUrl?.trim() || null,
    homeToken: input.homeToken?.trim() || null,
    homeUser: input.homeUser?.trim() || null,
    npub: pair.npub,
    updatedAt: Date.now(),
    walletCount: entries.length,
    txMetaCount: txMeta.length,
  };
  await AsyncStorage.setItem(PACKAGE_META_KEY, JSON.stringify(meta));

  if (input.channel === "home") {
    const { saveHomeServerCreds } = await import("./homeServerCreds");
    await saveHomeServerCreds({
      token: input.homeToken?.trim() || null,
      username: input.homeUser?.trim() || null,
      password: input.homePassword?.trim() || null,
    });
  }

  const { persistBackupPassphrase, clearBackupPackageDirty } = await import("./backupSync");
  await persistBackupPassphrase(check.passphrase);
  await clearBackupPackageDirty();
  const { clearBackupReminder } = await import("../wallet/backupReminder");
  await clearBackupReminder();
  return meta;
}

/** Re-pack wallets + notes and store locally (same passphrase). */
export async function refreshEncryptedBackup(passphrase: string): Promise<BackupPackageMeta> {
  const meta = await readBackupMeta();
  if (!meta?.enabled) throw new Error("Encrypted backup is not enabled");
  const existing = await readCipherBlob();
  const { loadHomeServerCreds } = await import("./homeServerCreds");
  const homeCreds = await loadHomeServerCreds();
  return enableEncryptedBackup({
    channel: meta.channel,
    passphrase,
    relays: meta.relays,
    homeUrl: meta.homeUrl ?? undefined,
    homeToken: homeCreds.token ?? meta.homeToken,
    homeUser: homeCreds.username ?? meta.homeUser,
    homePassword: homeCreds.password,
    reuseSaltHex: existing?.saltHex,
  });
}

export async function writeBackupMeta(meta: BackupPackageMeta): Promise<void> {
  await AsyncStorage.setItem(PACKAGE_META_KEY, JSON.stringify(meta));
}

export async function disableEncryptedBackup(): Promise<void> {
  await AsyncStorage.multiRemove([PACKAGE_META_KEY, PACKAGE_CIPHER_KEY]);
  const { clearPersistedBackupPassphrase, clearBackupPackageDirty } = await import("./backupSync");
  await clearPersistedBackupPassphrase();
  await clearBackupPackageDirty();
  const { clearHomeServerCreds } = await import("./homeServerCreds");
  await clearHomeServerCreds();
}

/** Persist a cipher blob fetched from relays (still passphrase-wrapped). */
export async function storeCipherBlob(blob: CipherBlob): Promise<void> {
  if (!blob.saltHex || !blob.ivHex || !blob.ciphertextHex) {
    throw new Error("Invalid cipher blob");
  }
  await AsyncStorage.setItem(PACKAGE_CIPHER_KEY, JSON.stringify(blob));
}
