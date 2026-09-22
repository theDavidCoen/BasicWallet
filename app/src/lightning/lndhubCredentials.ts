/**
 * LNDHub credentials in SecureStore (same class as seeds / nsec).
 * Multi-wallet: map keyed by walletId. Legacy single-record shape is migrated on read.
 */

import * as SecureStore from "expo-secure-store";
import type { LndHubConfig } from "./lndhub";

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const CREDS_KEY = "basic.wallet.lndhub.v1";

export type StoredLndHub = LndHubConfig & {
  walletId: string;
  savedAt: number;
  alias?: string;
};

type HubMap = Record<string, StoredLndHub>;

function isLegacyRecord(v: unknown): v is StoredLndHub {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.baseUrl === "string" && typeof o.apiKey === "string" && typeof o.walletId === "string";
}

async function readMap(): Promise<HubMap> {
  const raw = await SecureStore.getItemAsync(CREDS_KEY, SECURE_OPTIONS);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isLegacyRecord(parsed)) {
      return { [parsed.walletId]: parsed };
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const map: HubMap = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (isLegacyRecord(v) && v.walletId) map[k] = { ...v, walletId: k };
      }
      return map;
    }
  } catch {
    /* */
  }
  return {};
}

async function writeMap(map: HubMap): Promise<void> {
  if (Object.keys(map).length === 0) {
    try {
      await SecureStore.deleteItemAsync(CREDS_KEY, SECURE_OPTIONS);
    } catch {
      /* */
    }
    return;
  }
  await SecureStore.setItemAsync(CREDS_KEY, JSON.stringify(map), SECURE_OPTIONS);
}

export async function saveLndHubCredentials(rec: StoredLndHub): Promise<void> {
  const map = await readMap();
  map[rec.walletId] = rec;
  await writeMap(map);
}

export async function loadLndHubCredentials(walletId: string): Promise<StoredLndHub | null> {
  if (!walletId) return null;
  const map = await readMap();
  const hit = map[walletId];
  if (!hit?.baseUrl || !hit?.apiKey) return null;
  return hit;
}

/** Wipe all LNDHub slots (factory reset). */
export async function clearLndHubCredentials(): Promise<void> {
  await writeMap({});
}

export async function clearLndHubIfWallet(walletId: string): Promise<void> {
  const map = await readMap();
  if (!(walletId in map)) return;
  delete map[walletId];
  await writeMap(map);
}

export { CREDS_KEY as LNDHUB_SECURE_KEY };
