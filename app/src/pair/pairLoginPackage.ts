/**
 * Assemble / apply Bluetooth fast-login package.
 * Same wallet upsert rules as Path C restore; optionally re-arm Home/Nostr backup.
 *
 * Hard rule: never pack or persist the backup AEAD passphrase (no SecureStore,
 * AsyncStorage, or login-package field). Device 2 gets channel meta + home
 * server auth + optional cipher blob; uploads need an ephemeral passphrase
 * entry later (same as a locked Path C session).
 */

import {
  insertWallet,
  listWallets,
  removeWallet,
  setSelectedWalletId,
  type WalletKind,
  type WalletRecord,
} from "../account/walletRegistry";
import { getNetworkConfig } from "../config/network";
import { listContacts } from "../contacts/contactStore";
import {
  armBackupMetaAfterRestore,
  readBackupMeta,
  readCipherBlob,
  restoreContactsFromPackage,
  restorePrefsFromPackage,
  restoreTxMetaFromPackage,
  storeCipherBlob,
  type BackupChannel,
  type BackupPackageMeta,
  type CipherBlob,
  type DecryptedBackupPackage,
  type WalletPackageEntry,
} from "../nostr/backupPackage";
import { loadHomeServerCreds } from "../nostr/homeServerCreds";
import { importAndStoreNsec, loadNostrKeyPairForCrypto } from "../nostr/identityStore";
import { hasMnemonic, loadMnemonicForCrypto, storeMnemonic } from "../security/mnemonicStore";
import {
  clearBackupReminder,
  setBackupReminderPending,
} from "../wallet/backupReminder";
import { setMnemonicSource } from "../wallet/mnemonicMeta";

export type PairBackupArm = {
  channel: BackupChannel;
  relays?: string[];
  homeUrl?: string | null;
  homeToken?: string | null;
  homeUser?: string | null;
  homePassword?: string | null;
  /** Passphrase-wrapped AEAD blob (ciphertext only — never the passphrase). */
  cipher?: CipherBlob | null;
};

/** Plaintext login package (encrypted on the wire via pairProtocol). */
export type PairLoginPackage = {
  version: 1;
  createdAt: number;
  /** Nostr nsec bech32 for Device 2 identity. */
  nsec: string;
  npub: string;
  wallets: WalletPackageEntry[];
  txMeta?: DecryptedBackupPackage["txMeta"];
  contacts?: DecryptedBackupPackage["contacts"];
  prefs?: DecryptedBackupPackage["prefs"];
  /** Present only when Device 1 already had encrypted backup enabled. */
  backupArm?: PairBackupArm;
};

export type ApplyPairResult = {
  walletIds: string[];
  preferredWalletId: string;
  backupReArmed: boolean;
  channel: BackupChannel | null;
};

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

/** Build login package on Device 1 (approver). Throws if no wallets / no nsec. */
export async function assemblePairLoginPackage(): Promise<PairLoginPackage> {
  const pair = await loadNostrKeyPairForCrypto();
  if (!pair?.nsec) throw new Error("No Nostr identity on this device");

  const networkId = getNetworkConfig().id;
  const wallets = await collectWalletEntries(listWallets(networkId));
  if (!wallets.length) throw new Error("No seed wallets to pair");

  // Reuse Path C collectors via a temporary DecryptedBackupPackage shape.
  const { listAllTxMeta } = await import("../account/txMeta");
  const txMeta = listAllTxMeta(networkId)
    .filter((m) => m.name || m.notes || m.category || m.sentWith)
    .map((m) => ({
      walletId: m.walletId,
      activityId: m.activityId,
      name: m.name,
      notes: m.notes,
      category: m.category,
      sentWith: m.sentWith ?? null,
      updatedAt: m.updatedAt,
    }));
  const contacts = listContacts();

  // Prefs: read via restore-compatible rows by packing through backupPackage internals.
  // Call enable path collectors by reading fiat stores per wallet.
  const prefs: NonNullable<DecryptedBackupPackage["prefs"]> = [];
  const { readFiatModeState } = await import("../fiat/fiatModeStore");
  const { readBitcoinMaxiMode } = await import("../fiat/bitcoinMaxiStore");
  const { fiatStableForNetwork } = await import("../fiat/depixAssets");
  const stableId = fiatStableForNetwork(networkId).kind;
  for (const w of wallets) {
    const [fiat, maxiOn] = await Promise.all([
      readFiatModeState(networkId, w.id),
      readBitcoinMaxiMode(networkId, w.id),
    ]);
    prefs.push({
      walletId: w.id,
      networkId,
      fiatMode: fiat.fiatMode === true,
      bitcoinMaxiMode: maxiOn !== false,
      stableId,
      updatedAt: typeof fiat.updatedAt === "number" ? fiat.updatedAt : Date.now(),
    });
  }

  let backupArm: PairBackupArm | undefined;
  const meta = await readBackupMeta();
  if (meta?.enabled && meta.channel) {
    const homeCreds = await loadHomeServerCreds();
    const cipher = await readCipherBlob();
    if (meta.channel === "home" && !meta.homeUrl?.trim()) {
      throw new Error("Home backup is enabled but server URL is missing");
    }
    // Channel ON on Device 1 → always pack arm (meta + home auth + cipher).
    // Never include the backup AEAD passphrase.
    backupArm = {
      channel: meta.channel,
      relays: meta.relays,
      homeUrl: meta.homeUrl,
      homeToken: homeCreds.token ?? meta.homeToken,
      homeUser: homeCreds.username ?? meta.homeUser,
      homePassword: homeCreds.password,
      cipher,
    };
  }

  return {
    version: 1,
    createdAt: Date.now(),
    nsec: pair.nsec,
    npub: pair.npub,
    wallets,
    txMeta,
    contacts,
    prefs,
    backupArm,
  };
}

export function encodePairLoginPackage(pkg: PairLoginPackage): Uint8Array {
  // Defense: strip any legacy passphrase field before wire encode.
  const safe: PairLoginPackage = pkg.backupArm
    ? {
        ...pkg,
        backupArm: sanitizeBackupArm(pkg.backupArm),
      }
    : pkg;
  return new TextEncoder().encode(JSON.stringify(safe));
}

function sanitizeBackupArm(arm: PairBackupArm & { passphrase?: unknown }): PairBackupArm {
  const { passphrase: _drop, ...rest } = arm;
  void _drop;
  return rest;
}

export function decodePairLoginPackage(raw: Uint8Array): PairLoginPackage {
  const parsed = JSON.parse(new TextDecoder().decode(raw)) as PairLoginPackage & {
    backupArm?: PairBackupArm & { passphrase?: unknown };
  };
  if (parsed.version !== 1 || !Array.isArray(parsed.wallets) || !parsed.nsec) {
    throw new Error("Invalid pair login package");
  }
  if (parsed.backupArm) {
    parsed.backupArm = sanitizeBackupArm(parsed.backupArm);
  }
  return parsed;
}

/**
 * Apply package on Device 2 (requester).
 * Does not navigate; caller selects wallet + Home.
 * Re-arms backup meta like Path C `armBackupMetaAfterRestore` — no passphrase persist.
 */
export async function applyPairLoginPackage(pkg: PairLoginPackage): Promise<ApplyPairResult> {
  await importAndStoreNsec(pkg.nsec);
  const networkId = getNetworkConfig().id;

  const restoredIds = new Set<string>();
  for (let i = 0; i < pkg.wallets.length; i++) {
    const entry = pkg.wallets[i]!;
    const kind = (entry.kind as WalletKind) || "arkade";
    const existing = entry.id
      ? listWallets(networkId).find((w) => w.id === entry.id)
      : undefined;
    const record =
      existing ??
      insertWallet(networkId, {
        id: entry.id,
        kind,
        label: entry.label || (i === 0 ? "Personal" : `Wallet ${i + 1}`),
        tag: entry.tag,
      });
    await storeMnemonic(record.id, entry.mnemonic);
    restoredIds.add(record.id);
  }

  for (const w of listWallets(networkId)) {
    if (w.kind !== "arkade") continue;
    if (restoredIds.has(w.id)) continue;
    if (await hasMnemonic(w.id)) continue;
    removeWallet(networkId, w.id);
  }

  const asBackup: DecryptedBackupPackage = {
    version: 1,
    createdAt: pkg.createdAt,
    npub: pkg.npub,
    wallets: pkg.wallets,
    txMeta: pkg.txMeta,
    contacts: pkg.contacts,
    prefs: pkg.prefs,
  };
  restoreTxMetaFromPackage(asBackup);
  restoreContactsFromPackage(asBackup);
  await restorePrefsFromPackage(asBackup);

  let backupReArmed = false;
  let channel: BackupChannel | null = null;
  if (pkg.backupArm?.channel) {
    if (pkg.backupArm.cipher?.saltHex && pkg.backupArm.cipher.ciphertextHex) {
      await storeCipherBlob(pkg.backupArm.cipher);
    }
    await armBackupMetaAfterRestore({
      channel: pkg.backupArm.channel,
      npub: pkg.npub,
      walletCount: pkg.wallets.length,
      txMetaCount: pkg.txMeta?.length,
      contactsCount: pkg.contacts?.length,
      prefsCount: pkg.prefs?.length,
      relays: pkg.backupArm.relays,
      homeUrl: pkg.backupArm.homeUrl,
      homeToken: pkg.backupArm.homeToken,
      homeUser: pkg.backupArm.homeUser,
      homePassword: pkg.backupArm.homePassword,
    });
    await clearBackupReminder();
    backupReArmed = true;
    channel = pkg.backupArm.channel;
  } else {
    // Pairing does not move the passkey — require cloud backup or seed export.
    await setBackupReminderPending();
  }

  await setMnemonicSource("device-only");

  const wallets = listWallets(networkId).filter((w) => restoredIds.has(w.id));
  if (!wallets.length) throw new Error("Package had no wallets");

  const preferred =
    wallets.find((w) => w.kind === "arkade" && (w.tag === "main" || w.label === "Personal")) ??
    wallets.find((w) => w.kind === "arkade") ??
    wallets[0]!;
  const packagePreferred =
    (pkg.wallets[0]?.id && wallets.find((w) => w.id === pkg.wallets[0]!.id)) || preferred;

  setSelectedWalletId(networkId, packagePreferred.id);

  return {
    walletIds: [...restoredIds],
    preferredWalletId: packagePreferred.id,
    backupReArmed,
    channel,
  };
}

export async function readApproverBackupMeta(): Promise<BackupPackageMeta | null> {
  return readBackupMeta();
}
