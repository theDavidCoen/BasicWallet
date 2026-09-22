/**
 * External onchain recovery (sweep) address for unilateral exit auto-prepare.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ArkadeNetworkId } from "../config/network";
import { validateExternalSweepAddress, validateSweepAddress } from "./runExit";

const KEY = "basic.exit.recoveryAddress.v1";

type Store = Partial<Record<ArkadeNetworkId, string>>;

async function readAll(): Promise<Store> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Store;
  } catch {
    return {};
  }
}

export async function readRecoveryAddress(
  networkId: ArkadeNetworkId,
): Promise<string | null> {
  const all = await readAll();
  const v = all[networkId]?.trim();
  return v || null;
}

export async function writeRecoveryAddress(
  networkId: ArkadeNetworkId,
  address: string,
  opts?: { walletId?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = address.trim();
  if (!trimmed) {
    const all = await readAll();
    delete all[networkId];
    await AsyncStorage.setItem(KEY, JSON.stringify(all));
    return { ok: true };
  }
  const err = opts?.walletId
    ? await validateExternalSweepAddress(trimmed, networkId, opts.walletId)
    : validateSweepAddress(trimmed, networkId);
  if (err) return { ok: false, error: err };
  const all = await readAll();
  all[networkId] = trimmed;
  await AsyncStorage.setItem(KEY, JSON.stringify(all));
  return { ok: true };
}

export async function clearAllRecoveryAddresses(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
