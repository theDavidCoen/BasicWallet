import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ArkadeNetworkId } from "../config/network";
import type { BalanceBreakdown } from "./balance";

function keyFor(networkId: ArkadeNetworkId, walletId: string): string {
  // v3: stop legacy v1 bleed into new wallets (v2 keys may be poisoned).
  return `basic.wallet.balance.v3.${networkId}.${walletId}`;
}

function ackKeyFor(networkId: ArkadeNetworkId, walletId: string): string {
  // Balance the user has already seen / been notified about (catch-up source of truth).
  return `basic.wallet.balanceAck.v1.${networkId}.${walletId}`;
}

function activityAckKeyFor(networkId: ArkadeNetworkId, walletId: string): string {
  return `basic.wallet.activityAck.v1.${networkId}.${walletId}`;
}

function legacyKey(networkId: ArkadeNetworkId): string {
  return `basic.wallet.balance.v1.${networkId}`;
}

function legacyMigratedKey(networkId: ArkadeNetworkId): string {
  return `basic.wallet.balance.v1.${networkId}.migrated`;
}

function parseBreakdown(raw: string): BalanceBreakdown | null {
  try {
    const o = JSON.parse(raw) as BalanceBreakdown;
    if (typeof o?.total !== "number") return null;
    return {
      total: o.total,
      available: typeof o.available === "number" ? o.available : o.total,
      boarding: typeof o.boarding === "number" ? o.boarding : 0,
    };
  } catch {
    return null;
  }
}

export async function readCachedBalance(
  networkId: ArkadeNetworkId,
  walletId: string,
  opts?: { allowLegacyMigrate?: boolean },
): Promise<BalanceBreakdown | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(networkId, walletId));
    if (raw) return parseBreakdown(raw);

    // Legacy single-wallet cache may only seed the personal wallet once.
    // Never apply it to a newly created wallet (flashes wrong balance).
    if (!opts?.allowLegacyMigrate) return null;

    const migrated = await AsyncStorage.getItem(legacyMigratedKey(networkId));
    if (migrated) return null;

    const legacy = await AsyncStorage.getItem(legacyKey(networkId));
    if (!legacy) {
      await AsyncStorage.setItem(legacyMigratedKey(networkId), "1");
      return null;
    }
    const bal = parseBreakdown(legacy);
    await AsyncStorage.setItem(legacyMigratedKey(networkId), "1");
    await AsyncStorage.removeItem(legacyKey(networkId));
    if (bal) await writeCachedBalance(networkId, walletId, bal);
    return bal;
  } catch {
    return null;
  }
}

export async function writeCachedBalance(
  networkId: ArkadeNetworkId,
  walletId: string,
  bal: BalanceBreakdown,
): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(networkId, walletId), JSON.stringify(bal));
  } catch {
    /* ignore */
  }
}

/** Last balance the user acknowledged (seen or notified). Used for catch-up notices. */
export async function readLastAckBalance(
  networkId: ArkadeNetworkId,
  walletId: string,
): Promise<BalanceBreakdown | null> {
  try {
    const raw = await AsyncStorage.getItem(ackKeyFor(networkId, walletId));
    if (!raw) return null;
    return parseBreakdown(raw);
  } catch {
    return null;
  }
}

export async function writeLastAckBalance(
  networkId: ArkadeNetworkId,
  walletId: string,
  bal: BalanceBreakdown,
): Promise<void> {
  try {
    await AsyncStorage.setItem(ackKeyFor(networkId, walletId), JSON.stringify(bal));
  } catch {
    /* ignore */
  }
}

/** Highest activity created_at the user has already been notified about. */
export async function readLastNotifiedActivityAt(
  networkId: ArkadeNetworkId,
  walletId: string,
): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(activityAckKeyFor(networkId, walletId));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function writeLastNotifiedActivityAt(
  networkId: ArkadeNetworkId,
  walletId: string,
  createdAt: number,
): Promise<void> {
  try {
    await AsyncStorage.setItem(activityAckKeyFor(networkId, walletId), String(createdAt));
  } catch {
    /* ignore */
  }
}

/** Seed a fresh wallet cache so select never falls through to stale data. */
export async function writeZeroCachedBalance(
  networkId: ArkadeNetworkId,
  walletId: string,
): Promise<void> {
  await writeCachedBalance(networkId, walletId, { total: 0, available: 0, boarding: 0 });
  await writeLastAckBalance(networkId, walletId, { total: 0, available: 0, boarding: 0 });
  await writeLastNotifiedActivityAt(networkId, walletId, Date.now());
}
