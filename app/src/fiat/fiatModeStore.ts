/**
 * Per-wallet Fiat Mode persistence (selected Arkade wallet only).
 * Also embedded in Path C AEAD as optional `prefs[]` (see backupPackage).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ArkadeNetworkId } from "../config/network";

function queueFiatPrefsBackupSync(reason: string): void {
  void import("../nostr/backupSync")
    .then(async (m) => {
      await m.markBackupPackageDirty();
      // Home channel: flush immediately so remote cipher matches local fiatMode
      // before uninstall / cross-device restore. Debounced queue can leave a
      // stale fiatMode:true on the server after Exit.
      const meta = await import("../nostr/backupPackage").then((b) =>
        b.readBackupMeta(),
      );
      if (meta?.enabled && meta.channel === "home") {
        await m.unlockBackupPassphraseSession();
        await m.syncEncryptedBackupNow(reason);
        return;
      }
      m.queueEncryptedBackupSync(reason);
    })
    .catch((e) => console.warn("[basic] fiat prefs backup dirty failed", e));
}

export type FiatModeJobKind =
  | "enter"
  | "exit"
  | "auto-inbound"
  | "maxi-inbound"
  | "pay-convert"
  | null;

export type FiatModeState = {
  fiatMode: boolean;
  /** User (or enter flow) already touched the wallet label for FIAT MODE suffix. */
  labelTouched: boolean;
  lastSwapId: string | null;
  pendingJob: FiatModeJobKind;
  /**
   * Last settled fiat display (BRL/USD) — restored on cold open so Home does not
   * flash `…` while ASP assets load. Cleared on Exit.
   */
  lastGoodDisplay: number | null;
  /**
   * Expected Enter fill while assets settle — Home shows `+ $ x pending`.
   * Cleared when live balance arrives or on Exit.
   */
  pendingEnterDisplay: number | null;
  updatedAt: number;
};

const DEFAULT_STATE: FiatModeState = {
  fiatMode: false,
  labelTouched: false,
  lastSwapId: null,
  pendingJob: null,
  lastGoodDisplay: null,
  pendingEnterDisplay: null,
  updatedAt: 0,
};

function key(networkId: ArkadeNetworkId, walletId: string): string {
  return `basic.fiatMode.v1:${networkId}:${walletId}`;
}

function readDisplayField(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0.01) return null;
  return Math.round(v * 100) / 100;
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
      fiatMode: parsed.fiatMode === true,
      labelTouched: Boolean(parsed.labelTouched),
      lastSwapId: typeof parsed.lastSwapId === "string" ? parsed.lastSwapId : null,
      pendingJob:
        parsed.pendingJob === "enter" ||
        parsed.pendingJob === "exit" ||
        parsed.pendingJob === "auto-inbound" ||
        parsed.pendingJob === "maxi-inbound" ||
        parsed.pendingJob === "pay-convert"
          ? parsed.pendingJob
          : null,
      lastGoodDisplay: readDisplayField(parsed.lastGoodDisplay),
      pendingEnterDisplay: readDisplayField(parsed.pendingEnterDisplay),
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
  opts?: { syncBackup?: boolean },
): Promise<FiatModeState> {
  const prev = await readFiatModeState(networkId, walletId);
  const next: FiatModeState = {
    ...prev,
    ...patch,
    updatedAt: Date.now(),
  };
  await AsyncStorage.setItem(key(networkId, walletId), JSON.stringify(next));
  // Path C: dirty only when the product flag changes (not lastGood / pending settle).
  if (
    opts?.syncBackup !== false &&
    patch.fiatMode !== undefined &&
    (patch.fiatMode === true) !== (prev.fiatMode === true)
  ) {
    queueFiatPrefsBackupSync(`fiatMode:${walletId.slice(0, 8)}`);
  }
  return next;
}
