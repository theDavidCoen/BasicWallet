import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ArkadeNetworkId } from "../config/network";

export type CachedArkAddress = {
  arkAddress: string;
  updatedAt: number;
};

function keyFor(networkId: ArkadeNetworkId, walletId: string): string {
  return `basic.wallet.arkAddress.v1.${networkId}.${walletId}`;
}

function parseCached(raw: string): CachedArkAddress | null {
  try {
    const o = JSON.parse(raw) as CachedArkAddress;
    if (typeof o?.arkAddress !== "string" || !o.arkAddress.trim()) return null;
    return {
      arkAddress: o.arkAddress.trim(),
      updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export async function readCachedArkAddress(
  networkId: ArkadeNetworkId,
  walletId: string,
): Promise<CachedArkAddress | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(networkId, walletId));
    if (!raw) return null;
    return parseCached(raw);
  } catch {
    return null;
  }
}

/** Persist the L2 address shown for this wallet (forced pin preferred over raw getAddress). */
export async function writeCachedArkAddress(
  networkId: ArkadeNetworkId,
  walletId: string,
  arkAddress: string,
): Promise<void> {
  const trimmed = arkAddress.trim();
  if (!trimmed) return;
  try {
    const payload: CachedArkAddress = { arkAddress: trimmed, updatedAt: Date.now() };
    await AsyncStorage.setItem(keyFor(networkId, walletId), JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export async function clearCachedArkAddress(
  networkId: ArkadeNetworkId,
  walletId: string,
): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyFor(networkId, walletId));
  } catch {
    /* ignore */
  }
}
