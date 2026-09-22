/**
 * Unilateral exit jobs: multi-package index + encrypted blobs per jobId.
 * Draft packages for the wizard stay in packageStore (per wallet).
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
  type ExecutorEvent,
} from "@arkade-os/sdk";
import type { ArkadeNetworkId } from "../config/network";

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** Shared with packageStore draft AES key. */
const KEY_STORE = "basic.exit.pkg.aesKey.v1";
const JOBS_INDEX_KEY = "basic.exit.jobs.v1";
const MAX_EVENTS = 80;

export type ExitJobStatus = "running" | "stopped" | "completed" | "failed";

export type ExitJobRecord = {
  jobId: string;
  networkId: ArkadeNetworkId;
  walletId: string;
  createdAt: number;
  status: ExitJobStatus;
  sweepAddress: string;
  recoveredSats: number;
  fundingRequiredSats: number;
  txCount: number;
  esploraUrl?: string;
  events: ExecutorEvent[];
  /** Outpoints covered by this job's package (for prepare exclusion). */
  vtxoOutpoints: string[];
  lastError?: string;
  updatedAt: number;
};

type CipherBlob = {
  ivHex: string;
  ciphertextHex: string;
};

function jobCipherKey(jobId: string): string {
  return `basic.exit.job.cipher.v1.${jobId}`;
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

function safeId(walletId: string): string {
  return walletId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
}

export async function listExitJobs(): Promise<ExitJobRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(JOBS_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ExitJobRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeJobs(jobs: ExitJobRecord[]): Promise<void> {
  await AsyncStorage.setItem(JOBS_INDEX_KEY, JSON.stringify(jobs));
}

export async function getExitJob(jobId: string): Promise<ExitJobRecord | null> {
  const jobs = await listExitJobs();
  return jobs.find((j) => j.jobId === jobId) ?? null;
}

export async function upsertExitJob(job: ExitJobRecord): Promise<void> {
  const jobs = await listExitJobs();
  const i = jobs.findIndex((j) => j.jobId === job.jobId);
  if (i >= 0) jobs[i] = job;
  else jobs.unshift(job);
  await writeJobs(jobs);
}

export async function patchExitJob(
  jobId: string,
  patch: Partial<ExitJobRecord>,
): Promise<ExitJobRecord | null> {
  const jobs = await listExitJobs();
  const i = jobs.findIndex((j) => j.jobId === jobId);
  if (i < 0) return null;
  const next = { ...jobs[i]!, ...patch, updatedAt: Date.now() };
  jobs[i] = next;
  await writeJobs(jobs);
  return next;
}

export async function appendJobEvent(
  jobId: string,
  event: ExecutorEvent,
): Promise<ExitJobRecord | null> {
  const jobs = await listExitJobs();
  const i = jobs.findIndex((j) => j.jobId === jobId);
  if (i < 0) return null;
  const prev = jobs[i]!;
  const events = [...prev.events, event].slice(-MAX_EVENTS);
  const next = { ...prev, events, updatedAt: Date.now() };
  jobs[i] = next;
  await writeJobs(jobs);
  return next;
}

export async function loadJobPackage(jobId: string): Promise<ExitPackage | null> {
  const raw = await AsyncStorage.getItem(jobCipherKey(jobId));
  if (!raw) return null;
  try {
    const blob = JSON.parse(raw) as CipherBlob;
    const json = await decryptJson(blob);
    return deserializeExitPackage(json);
  } catch (e) {
    console.warn("[basic] exit job package decrypt failed", e);
    return null;
  }
}

export async function saveJobPackage(jobId: string, pkg: ExitPackage): Promise<void> {
  const json = serializeExitPackage(pkg);
  const blob = await encryptJson(json);
  await AsyncStorage.setItem(jobCipherKey(jobId), JSON.stringify(blob));
}

export async function deleteJobPackage(jobId: string): Promise<void> {
  await AsyncStorage.removeItem(jobCipherKey(jobId)).catch(() => undefined);
}

export function makeExitJobId(
  networkId: ArkadeNetworkId,
  walletId: string,
  createdAt: number,
): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${networkId}_${safeId(walletId)}_${createdAt}_${rand}`;
}

/** Create a running job from a draft ExitPackage; persists encrypted copy. */
export async function createJobFromPackage(opts: {
  networkId: ArkadeNetworkId;
  walletId: string;
  pkg: ExitPackage;
  esploraUrl?: string;
}): Promise<ExitJobRecord> {
  const jobId = makeExitJobId(opts.networkId, opts.walletId, opts.pkg.createdAt);
  await saveJobPackage(jobId, opts.pkg);
  const job: ExitJobRecord = {
    jobId,
    networkId: opts.networkId,
    walletId: opts.walletId,
    createdAt: opts.pkg.createdAt,
    status: "running",
    sweepAddress: opts.pkg.sweepAddress,
    recoveredSats: opts.pkg.totals.recoveredSats,
    fundingRequiredSats: opts.pkg.totals.fundingRequiredSats,
    txCount: opts.pkg.totals.txCount,
    esploraUrl: opts.esploraUrl,
    events: [],
    vtxoOutpoints: opts.pkg.vtxos.map((v) => v.outpoint).filter(Boolean),
    updatedAt: Date.now(),
  };
  await upsertExitJob(job);
  return job;
}

/** Outpoints locked by active (running/stopped) jobs — exclude from new prepare. */
export async function getActiveJobOutpoints(
  networkId?: ArkadeNetworkId,
  walletId?: string,
): Promise<Set<string>> {
  const jobs = await listExitJobs();
  const set = new Set<string>();
  for (const j of jobs) {
    if (j.status !== "running" && j.status !== "stopped") continue;
    if (networkId && j.networkId !== networkId) continue;
    if (walletId && j.walletId !== walletId) continue;
    for (const o of j.vtxoOutpoints) set.add(o);
  }
  return set;
}

export function isActiveJobStatus(status: ExitJobStatus): boolean {
  return status === "running" || status === "stopped";
}

export async function listActiveExitJobs(
  networkId?: ArkadeNetworkId,
): Promise<ExitJobRecord[]> {
  const jobs = await listExitJobs();
  return jobs.filter((j) => {
    if (!isActiveJobStatus(j.status) && j.status !== "completed" && j.status !== "failed") {
      return false;
    }
    // Hub shows active + recent terminal jobs
    if (networkId && j.networkId !== networkId) return false;
    if (j.status === "completed" || j.status === "failed") {
      // Keep completed/failed for 7 days on hub
      if (Date.now() - j.updatedAt > 7 * 24 * 60 * 60 * 1000) return false;
    }
    return true;
  });
}

export async function clearAllExitJobs(): Promise<void> {
  const jobs = await listExitJobs();
  await AsyncStorage.multiRemove([
    JOBS_INDEX_KEY,
    ...jobs.map((j) => jobCipherKey(j.jobId)),
  ]).catch(() => undefined);
  const keys = await AsyncStorage.getAllKeys();
  const orphan = keys.filter((k) => k.startsWith("basic.exit.job.cipher.v1."));
  if (orphan.length) await AsyncStorage.multiRemove(orphan);
}
