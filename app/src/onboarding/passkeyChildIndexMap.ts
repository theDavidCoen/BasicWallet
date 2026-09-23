/**
 * Passkey child index ↔ label map (active + archived).
 * Survives factory reset; wiped on uninstall. Source of truth for rematerialize
 * is merged with the Nostr label directory after Continue with passkey.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { isPersonalLabel, normalizeWalletLabel } from "./passkeyChildWallets";

export const PASSKEY_CHILD_INDEX_MAP_KEY = "basic.wallet.passkey.childIndexMap.v1";

export type PasskeyChildStatus = "active" | "archived";

export type PasskeyChildEntry = {
  index: number;
  label: string;
  status: PasskeyChildStatus;
  archivedAt?: string;
};

export type PasskeyChildIndexMap = {
  version: 1;
  nextIndex: number;
  entries: PasskeyChildEntry[];
};

function emptyMap(): PasskeyChildIndexMap {
  return { version: 1, nextIndex: 0, entries: [] };
}

function normalizeEntry(raw: unknown): PasskeyChildEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const index = typeof e.index === "number" && Number.isInteger(e.index) ? e.index : -1;
  if (index < 0) return null;
  const label = typeof e.label === "string" ? normalizeWalletLabel(e.label) : "";
  if (!label || isPersonalLabel(label)) return null;
  const status: PasskeyChildStatus = e.status === "archived" ? "archived" : "active";
  const archivedAt = typeof e.archivedAt === "string" ? e.archivedAt : undefined;
  return { index, label, status, ...(archivedAt ? { archivedAt } : {}) };
}

export async function readPasskeyChildIndexMap(): Promise<PasskeyChildIndexMap> {
  try {
    const raw = await AsyncStorage.getItem(PASSKEY_CHILD_INDEX_MAP_KEY);
    if (!raw) return emptyMap();
    const parsed = JSON.parse(raw) as Partial<PasskeyChildIndexMap>;
    const entries: PasskeyChildEntry[] = [];
    const seen = new Set<number>();
    if (Array.isArray(parsed.entries)) {
      for (const item of parsed.entries) {
        const entry = normalizeEntry(item);
        if (!entry || seen.has(entry.index)) continue;
        seen.add(entry.index);
        entries.push(entry);
      }
    }
    entries.sort((a, b) => a.index - b.index);
    const maxIdx = entries.reduce((m, e) => Math.max(m, e.index), -1);
    const nextIndex =
      typeof parsed.nextIndex === "number" && Number.isInteger(parsed.nextIndex)
        ? Math.max(parsed.nextIndex, maxIdx + 1)
        : maxIdx + 1;
    return { version: 1, nextIndex: Math.max(0, nextIndex), entries };
  } catch {
    return emptyMap();
  }
}

export async function writePasskeyChildIndexMap(map: PasskeyChildIndexMap): Promise<void> {
  const cleaned: PasskeyChildIndexMap = {
    version: 1,
    nextIndex: Math.max(0, map.nextIndex),
    entries: [...map.entries].sort((a, b) => a.index - b.index),
  };
  await AsyncStorage.setItem(PASSKEY_CHILD_INDEX_MAP_KEY, JSON.stringify(cleaned));
}

export async function listActivePasskeyChildren(): Promise<PasskeyChildEntry[]> {
  const map = await readPasskeyChildIndexMap();
  return map.entries.filter((e) => e.status === "active");
}

export async function listArchivedPasskeyChildren(): Promise<PasskeyChildEntry[]> {
  const map = await readPasskeyChildIndexMap();
  return map.entries.filter((e) => e.status === "archived");
}

/** Allocate next index and append an active entry. */
export async function allocatePasskeyChild(label: string): Promise<PasskeyChildEntry> {
  const norm = normalizeWalletLabel(label);
  if (!norm || isPersonalLabel(norm)) {
    throw new Error("Invalid child wallet label");
  }
  const map = await readPasskeyChildIndexMap();
  if (map.entries.some((e) => e.status === "active" && e.label.toLowerCase() === norm.toLowerCase())) {
    throw new Error("A passkey wallet with this label already exists");
  }
  const entry: PasskeyChildEntry = {
    index: map.nextIndex,
    label: norm,
    status: "active",
  };
  map.entries.push(entry);
  map.nextIndex = map.nextIndex + 1;
  await writePasskeyChildIndexMap(map);
  return entry;
}

export async function renamePasskeyChildByIndex(index: number, label: string): Promise<PasskeyChildEntry> {
  const norm = normalizeWalletLabel(label);
  if (!norm || isPersonalLabel(norm)) {
    throw new Error("Invalid child wallet label");
  }
  const map = await readPasskeyChildIndexMap();
  const entry = map.entries.find((e) => e.index === index);
  if (!entry) throw new Error("Passkey child index not found");
  if (
    map.entries.some(
      (e) =>
        e.index !== index &&
        e.status === "active" &&
        e.label.toLowerCase() === norm.toLowerCase(),
    )
  ) {
    throw new Error("A passkey wallet with this label already exists");
  }
  entry.label = norm;
  await writePasskeyChildIndexMap(map);
  return entry;
}

export async function archivePasskeyChildByIndex(index: number): Promise<PasskeyChildEntry> {
  const map = await readPasskeyChildIndexMap();
  const entry = map.entries.find((e) => e.index === index);
  if (!entry) throw new Error("Passkey child index not found");
  entry.status = "archived";
  entry.archivedAt = new Date().toISOString();
  await writePasskeyChildIndexMap(map);
  return entry;
}

export async function restorePasskeyChildByIndex(index: number): Promise<PasskeyChildEntry> {
  const map = await readPasskeyChildIndexMap();
  const entry = map.entries.find((e) => e.index === index);
  if (!entry) throw new Error("Passkey child index not found");
  if (
    map.entries.some(
      (e) =>
        e.index !== index &&
        e.status === "active" &&
        e.label.toLowerCase() === entry.label.toLowerCase(),
    )
  ) {
    throw new Error("An active wallet already uses this label");
  }
  entry.status = "active";
  delete entry.archivedAt;
  await writePasskeyChildIndexMap(map);
  return entry;
}

export function passkeyIndexFromMeta(meta: Record<string, unknown> | null | undefined): number | null {
  if (!meta) return null;
  const v = meta.passkeyIndex;
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return null;
}
