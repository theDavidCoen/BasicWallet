/**
 * Per-wallet Fiat Mode persistence (selected Arkade wallet only).
 * Path C backup embed is out of v1 — local AsyncStorage only.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ArkadeNetworkId } from "../config/network";

export type FiatModeJobKind = "enter" | "exit" | "auto-inbound" | "pay-convert" | null;

export type FiatModeState = {
  fiatMode: boolean;
  /** User (or enter flow) already touched the wallet label for FIAT MODE suffix. */
  labelTouched: boolean;
  lastSwapId: string | null;
  pendingJob: FiatModeJobKind;
  updatedAt: number;
};

const DEFAULT_STATE: FiatModeState = {
  fiatMode: false,
  labelTouched: false,
  lastSwapId: null,
  pendingJob: null,
  updatedAt: 0,
};

function key(networkId: ArkadeNetworkId, walletId: string): string {
  return `basic.fiatMode.v1:${networkId}:${walletId}`;
}

export async function readFiatModeState(
  networkId: ArkadeNetworkId,
  walletId: string,
): Promise<FiatModeState> {
  try {
    const raw = await AsyncStorage.getItem(key(networkId, walletId));
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<FiatModeState>;
    return {
      fiatMode: Boolean(parsed.fiatMode),
      labelTouched: Boolean(parsed.labelTouched),
      lastSwapId: typeof parsed.lastSwapId === "string" ? parsed.lastSwapId : null,
      pendingJob:
        parsed.pendingJob === "enter" ||
        parsed.pendingJob === "exit" ||
        parsed.pendingJob === "auto-inbound" ||
        parsed.pendingJob === "pay-convert"
          ? parsed.pendingJob
          : null,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function writeFiatModeState(
  networkId: ArkadeNetworkId,
  walletId: string,
  patch: Partial<FiatModeState>,
): Promise<FiatModeState> {
  const prev = await readFiatModeState(networkId, walletId);
  const next: FiatModeState = {
    ...prev,
    ...patch,
    updatedAt: Date.now(),
  };
  await AsyncStorage.setItem(key(networkId, walletId), JSON.stringify(next));
  return next;
}
