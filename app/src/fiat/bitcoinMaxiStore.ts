/**
 * Per-wallet Bitcoin Maxi Mode persistence.
 * Default ON: inbound alt-assets (outside Fiat Mode) auto-swap to sats.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ArkadeNetworkId } from "../config/network";

function key(networkId: ArkadeNetworkId, walletId: string): string {
  return `basic.bitcoinMaxi.v1:${networkId}:${walletId}`;
}

/** Default ON when unset. */
export async function readBitcoinMaxiMode(
  networkId: ArkadeNetworkId,
  walletId: string,
): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(key(networkId, walletId));
    if (raw == null) return true;
    const parsed = JSON.parse(raw) as { on?: unknown };
    if (typeof parsed?.on === "boolean") return parsed.on;
    return true;
  } catch {
    return true;
  }
}

/** Persist preference (v1 UI does not offer OFF; kept for future). */
export async function writeBitcoinMaxiMode(
  networkId: ArkadeNetworkId,
  walletId: string,
  on: boolean,
): Promise<void> {
  await AsyncStorage.setItem(
    key(networkId, walletId),
    JSON.stringify({ on: Boolean(on), updatedAt: Date.now() }),
  );
}
