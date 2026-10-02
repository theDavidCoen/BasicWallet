/**
 * Persistent Arkade SDK repositories via expo-sqlite — one namespace per wallet_id.
 * Never the mnemonic.
 */

import * as SQLite from "expo-sqlite";
import type { StorageConfig } from "@arkade-os/sdk";
import {
  SQLiteWalletRepository,
  SQLiteContractRepository,
  SQLiteIntentRepository,
  SQLiteVirtualTxRepository,
  type SQLExecutor,
} from "@arkade-os/sdk/repositories/sqlite";
import { SQLiteAssetSwapRepository } from "@arkade-os/swap/repositories/sqlite";
import type { AssetSwapRepository } from "@arkade-os/swap";
import { openNetworkDatabase } from "../account/sqliteCipher";
import type { ArkadeNetworkId } from "../config/network";

type CacheKey = string;

type Cached = {
  executor: SQLExecutor;
  storage: StorageConfig;
  swapRepository: AssetSwapRepository;
};

const cache = new Map<CacheKey, Cached>();

/** Skip dust VTXOs for exit-branch capture (SDK default is 1000). */
const MIN_EXIT_WORTH_SATS = 1000;

function cacheKey(networkId: ArkadeNetworkId, walletId: string): CacheKey {
  return `${networkId}::${walletId}`;
}

function dbNameFor(networkId: ArkadeNetworkId, walletId: string): string {
  // Sanitize walletId for filesystem
  const safe = walletId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `basic-wallet-${networkId}-${safe}.db`;
}

function tablePrefix(walletId: string): string {
  const safe = walletId.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 24);
  return `basic_${safe}_`;
}

function asBindParams(params: unknown[] | undefined): SQLite.SQLiteBindParams {
  return (params ?? []) as SQLite.SQLiteBindParams;
}

function makeExecutor(db: SQLite.SQLiteDatabase): SQLExecutor {
  return {
    run: async (sql, params) => {
      await db.runAsync(sql, asBindParams(params));
    },
    get: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
      const row = await db.getFirstAsync<T>(sql, asBindParams(params));
      return row ?? undefined;
    },
    all: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) =>
      db.getAllAsync<T>(sql, asBindParams(params)),
  };
}

function ensureCached(networkId: ArkadeNetworkId, walletId: string): Cached {
  const key = cacheKey(networkId, walletId);
  const hit = cache.get(key);
  if (hit) return hit;

  const db = openNetworkDatabase(networkId, dbNameFor(networkId, walletId));
  const executor = makeExecutor(db);
  const prefix = tablePrefix(walletId);
  const storage: StorageConfig = {
    walletRepository: new SQLiteWalletRepository(executor, { prefix }),
    contractRepository: new SQLiteContractRepository(executor, { prefix }),
    intentRepository: new SQLiteIntentRepository(executor, { prefix }),
    virtualTxRepository: new SQLiteVirtualTxRepository(executor, { prefix }),
    exitDataCapture: {
      mode: "full",
      minExitWorthSats: MIN_EXIT_WORTH_SATS,
    },
  };
  const swapRepository = new SQLiteAssetSwapRepository(executor, {
    prefix: `${prefix}swap_`,
  });

  const entry: Cached = { executor, storage, swapRepository };
  cache.set(key, entry);
  return entry;
}

/**
 * Open (or reuse) SQLite-backed StorageConfig for network + wallet.
 * Includes full exit-data capture so unilateral exit can proceed without the indexer.
 */
export function getPersistentStorage(
  networkId: ArkadeNetworkId,
  walletId: string,
): StorageConfig {
  return ensureCached(networkId, walletId).storage;
}

/** Expo-safe swap repository (same DB / executor as wallet storage). */
export function getAssetSwapRepository(
  networkId: ArkadeNetworkId,
  walletId: string,
): AssetSwapRepository {
  return ensureCached(networkId, walletId).swapRepository;
}
