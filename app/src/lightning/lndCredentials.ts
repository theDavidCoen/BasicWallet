/**
 * LND REST credentials in SecureStore (same class as seeds / nsec).
 * Multi-wallet: map keyed by walletId. Legacy single-record shape is migrated on read.
 */

import * as SecureStore from "expo-secure-store";
import type { LndRestConfig } from "./btcpayConfig";

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const CREDS_KEY = "basic.wallet.lnd.rest.v1";

export type StoredLndRest = LndRestConfig & {
  walletId: string;
  savedAt: number;
  alias?: string;
  identityPubkey?: string;
};

type RestMap = Record<string, StoredLndRest>;

function isLegacyRecord(v: unknown): v is StoredLndRest {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.restUrl === "string" &&
    typeof o.macaroonHex === "string" &&
    typeof o.walletId === "string"
  );
}

async function readMap(): Promise<RestMap> {
  const raw = await SecureStore.getItemAsync(CREDS_KEY, SECURE_OPTIONS);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isLegacyRecord(parsed)) {
      return { [parsed.walletId]: parsed };
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const map: RestMap = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (isLegacyRecord(v)) map[k] = { ...v, walletId: k };
      }
      return map;
    }
  } catch {
    /* */
  }
  return {};
}

async function writeMap(map: RestMap): Promise<void> {
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

export async function saveLndRestCredentials(rec: StoredLndRest): Promise<void> {
  const map = await readMap();
  map[rec.walletId] = rec;
  await writeMap(map);
}

export async function loadLndRestCredentials(walletId: string): Promise<StoredLndRest | null> {
  if (!walletId) return null;
  const map = await readMap();
  const hit = map[walletId];
  if (!hit?.restUrl || !hit?.macaroonHex) return null;
  return hit;
}

/** Wipe all LND REST slots (factory reset). */
export async function clearLndRestCredentials(): Promise<void> {
  await writeMap({});
}

export async function clearLndRestIfWallet(walletId: string): Promise<void> {
  const map = await readMap();
  if (!(walletId in map)) return;
  delete map[walletId];
  await writeMap(map);
}

export { CREDS_KEY as LND_REST_SECURE_KEY };
