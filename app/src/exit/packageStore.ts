/**
 * Exit package at rest: AES-256-GCM blob in AsyncStorage, key in SecureStore.
 * SecureStore alone is too small for real packages.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { gcm } from "@noble/ciphers/aes.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  deserializeExitPackage,
  serializeExitPackage,
  type ExitPackage,
} from "@arkade-os/sdk";
import type { ArkadeNetworkId } from "../config/network";

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const KEY_STORE = "basic.exit.pkg.aesKey.v1";
const LEGACY_SECURE_PREFIX = "basic_exit_pkg_";

export type ExitPackageMeta = {
  networkId: ArkadeNetworkId;
  walletId: string;
  createdAt: number;
  sweepAddress: string;
  recoveredSats: number;
  fundingRequiredSats: number;
  txCount: number;
  validUntil?: number;
  mode?: ExitPackage["mode"];
  /** Skip auto-prepare when fingerprint matches and package covers those VTXOs. */
  autoFingerprint?: string;
  source?: "manual" | "auto";
  /** Sum of all VTXO values in the package (included + skipped). Must equal local total. */
  coveredSats?: number;
  /** Number of VTXOs listed in the package. Must equal local count. */
  coveredVtxoCount?: number;
  /** Sum of VTXO values that are actually exitable (not skipped). */
  includedSats?: number;
  /**
   * Skips that are not mere dust/uneconomic (missing path, exit data, etc.).
   * Must be 0 for the package to be considered ready.
   */
  blockingSkipCount?: number;
};

type CipherBlob = {
  ivHex: string;
  ciphertextHex: string;
};

function safeId(walletId: string): string {
  return walletId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
}

function cipherKey(networkId: ArkadeNetworkId, walletId: string): string {
  return `basic.exit.pkg.cipher.v1.${networkId}.${safeId(walletId)}`;
}

function metaKey(networkId: ArkadeNetworkId, walletId: string): string {
  return `basic.exit.pkg.meta.v1.${networkId}.${safeId(walletId)}`;
}

function legacySecurePkgKey(networkId: ArkadeNetworkId, walletId: string): string {
  return `${LEGACY_SECURE_PREFIX}${networkId}_${safeId(walletId)}`;
}

function legacySecureMetaKey(networkId: ArkadeNetworkId, walletId: string): string {
  return `${legacySecurePkgKey(networkId, walletId)}_meta`;
}

async function getOrCreateAesKey(): Promise<Uint8Array> {
  const existing = await SecureStore.getItemAsync(KEY_STORE, SECURE_OPTIONS);
  if (existing && existing.length === 64) {
    return hexToBytes(existing);
  }
  const bytes = await Crypto.getRandomBytesAsync(32);
  await SecureStore.setItemAsync(KEY_STORE, bytesToHex(bytes), SECURE_OPTIONS);
  return bytes;
}

async function encryptJson(json: string): Promise<CipherBlob> {
  const key = await getOrCreateAesKey();
  const iv = await Crypto.getRandomBytesAsync(12);
  const aes = gcm(key, iv);
  const ct = aes.encrypt(utf8ToBytes(json));
  return { ivHex: bytesToHex(iv), ciphertextHex: bytesToHex(ct) };
}

async function decryptJson(blob: CipherBlob): Promise<string> {
  const key = await getOrCreateAesKey();
  const aes = gcm(key, hexToBytes(blob.ivHex));
  const pt = aes.decrypt(hexToBytes(blob.ciphertextHex));
  return new TextDecoder().decode(pt);
}

function isUneconomicSkip(reason: string | undefined): boolean {
  if (!reason) return false;
  return reason.startsWith("uneconomic");
}

/** True when a VTXO was skipped for a reason other than dust / uneconomic. */
export function exitVtxoHasBlockingSkip(v: {
  skipped?: string;
}): boolean {
  return !!v.skipped && !isUneconomicSkip(v.skipped);
}

export function summarizeExitPackageVtxos(pkg: ExitPackage): {
  coveredSats: number;
  coveredVtxoCount: number;
  includedSats: number;
  blockingSkipCount: number;
} {
  let coveredSats = 0;
  let includedSats = 0;
  let blockingSkipCount = 0;
  for (const v of pkg.vtxos) {
    const value = Number(v.value) || 0;
    coveredSats += value;
    if (v.skipped) {
      if (exitVtxoHasBlockingSkip(v)) blockingSkipCount += 1;
    } else {
      includedSats += value;
    }
  }
  return {
    coveredSats,
    coveredVtxoCount: pkg.vtxos.length,
    includedSats,
    blockingSkipCount,
  };
}

function metaFromPackage(
  networkId: ArkadeNetworkId,
  walletId: string,
  pkg: ExitPackage,
  extra?: Partial<Pick<ExitPackageMeta, "autoFingerprint" | "source">>,
): ExitPackageMeta {
  const sums = summarizeExitPackageVtxos(pkg);
  return {
    networkId,
    walletId,
    createdAt: pkg.createdAt,
    sweepAddress: pkg.sweepAddress,
    recoveredSats: pkg.totals.recoveredSats,
    fundingRequiredSats: pkg.totals.fundingRequiredSats,
    txCount: pkg.totals.txCount,
    validUntil: pkg.validUntil,
    mode: pkg.mode,
    autoFingerprint: extra?.autoFingerprint,
    source: extra?.source,
    coveredSats: sums.coveredSats,
    coveredVtxoCount: sums.coveredVtxoCount,
    includedSats: sums.includedSats,
    blockingSkipCount: sums.blockingSkipCount,
  };
}

export async function hasExitPackage(
  networkId: ArkadeNetworkId,
  walletId: string,
): Promise<boolean> {
  const cipher = await AsyncStorage.getItem(cipherKey(networkId, walletId));
  if (cipher) return true;
  const legacy = await SecureStore.getItemAsync(
    legacySecurePkgKey(networkId, walletId),
    SECURE_OPTIONS,
  );
  return !!legacy;
}

export async function readExitPackageMeta(
  networkId: ArkadeNetworkId,
  walletId: string,
): Promise<ExitPackageMeta | null> {
  const raw = await AsyncStorage.getItem(metaKey(networkId, walletId));
  if (raw) {
    try {
      return JSON.parse(raw) as ExitPackageMeta;
    } catch {
      /* fall through */
    }
  }
  const legacy = await SecureStore.getItemAsync(
    legacySecureMetaKey(networkId, walletId),
    SECURE_OPTIONS,
  );
  if (!legacy) return null;
  try {
    return JSON.parse(legacy) as ExitPackageMeta;
  } catch {
    return null;
  }
}

export async function loadExitPackage(
  networkId: ArkadeNetworkId,
  walletId: string,
): Promise<ExitPackage | null> {
  const rawCipher = await AsyncStorage.getItem(cipherKey(networkId, walletId));
  if (rawCipher) {
    try {
      const blob = JSON.parse(rawCipher) as CipherBlob;
      const json = await decryptJson(blob);
      return deserializeExitPackage(json);
    } catch (e) {
      console.warn("[basic] exit package decrypt failed", e);
      return null;
    }
  }

  // Migrate legacy SecureStore packages (often truncated / too large).
  const legacy = await SecureStore.getItemAsync(
    legacySecurePkgKey(networkId, walletId),
    SECURE_OPTIONS,
  );
  if (!legacy) return null;
  try {
    const pkg = deserializeExitPackage(legacy);
    await saveExitPackage(networkId, walletId, pkg, {
      source: "manual",
    });
    await SecureStore.deleteItemAsync(
      legacySecurePkgKey(networkId, walletId),
      SECURE_OPTIONS,
    ).catch(() => undefined);
    await SecureStore.deleteItemAsync(
      legacySecureMetaKey(networkId, walletId),
      SECURE_OPTIONS,
    ).catch(() => undefined);
    return pkg;
  } catch (e) {
    console.warn("[basic] legacy exit package migrate failed", e);
    return null;
  }
}

export async function saveExitPackage(
  networkId: ArkadeNetworkId,
  walletId: string,
  pkg: ExitPackage,
  extra?: Partial<Pick<ExitPackageMeta, "autoFingerprint" | "source">>,
): Promise<void> {
  const json = serializeExitPackage(pkg);
  const blob = await encryptJson(json);
  const meta = metaFromPackage(networkId, walletId, pkg, extra);
  await AsyncStorage.setItem(cipherKey(networkId, walletId), JSON.stringify(blob));
  await AsyncStorage.setItem(metaKey(networkId, walletId), JSON.stringify(meta));
}

export async function clearExitPackage(
  networkId: ArkadeNetworkId,
  walletId: string,
): Promise<void> {
  await AsyncStorage.multiRemove([
    cipherKey(networkId, walletId),
    metaKey(networkId, walletId),
  ]).catch(() => undefined);
  await SecureStore.deleteItemAsync(
    legacySecurePkgKey(networkId, walletId),
    SECURE_OPTIONS,
  ).catch(() => undefined);
  await SecureStore.deleteItemAsync(
    legacySecureMetaKey(networkId, walletId),
    SECURE_OPTIONS,
  ).catch(() => undefined);
}

/** Wipe all exit package blobs + AES key (factory reset). */
export async function clearAllExitPackages(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const drop = keys.filter(
    (k) =>
      k.startsWith("basic.exit.pkg.cipher.v1.") ||
      k.startsWith("basic.exit.pkg.meta.v1."),
  );
  if (drop.length) await AsyncStorage.multiRemove(drop);
  const { clearAllExitJobs } = await import("./jobStore");
  await clearAllExitJobs();
  await SecureStore.deleteItemAsync(KEY_STORE, SECURE_OPTIONS).catch(() => undefined);
}

export function exitAutoFingerprint(
  sweepAddress: string,
  vtxoCount: number,
  totalSats: number,
): string {
  return `${sweepAddress.trim()}|${vtxoCount}|${totalSats}`;
}

/**
 * Package is current when:
 * - sweep + VTXO fingerprint match
 * - package lists every local VTXO (exact count + sat total)
 * - no blocking skips (missing exit path / data) — uneconomic dust skips OK
 *
 * recoveredSats is after sweep fees on included VTXOs; it is not compared with %.
 */
export function exitPackageIsCurrent(
  meta: Pick<
    ExitPackageMeta,
    | "sweepAddress"
    | "autoFingerprint"
    | "coveredSats"
    | "coveredVtxoCount"
    | "recoveredSats"
    | "blockingSkipCount"
    | "includedSats"
  >,
  sweepAddress: string,
  vtxoCount: number,
  totalSats: number,
): boolean {
  if (!sweepAddress.trim() || meta.sweepAddress.trim() !== sweepAddress.trim()) {
    return false;
  }
  if (vtxoCount <= 0 || totalSats <= 0 || meta.recoveredSats <= 0) {
    return false;
  }
  if (meta.coveredSats == null || meta.coveredVtxoCount == null) {
    return false;
  }
  // Legacy / partial packages without quality fields are never "ready".
  if (meta.blockingSkipCount == null || meta.includedSats == null) {
    return false;
  }
  if (meta.blockingSkipCount !== 0) {
    return false;
  }
  if (meta.includedSats <= 0) {
    return false;
  }
  if (meta.coveredVtxoCount !== vtxoCount || meta.coveredSats !== totalSats) {
    return false;
  }
  const fp = exitAutoFingerprint(sweepAddress, vtxoCount, totalSats);
  return meta.autoFingerprint === fp;
}
