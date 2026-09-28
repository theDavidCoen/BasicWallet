/**
 * Per-wallet Bitcoin Maxi Mode persistence.
 * Default ON: inbound alt-assets (outside Fiat Mode) auto-swap to sats.
 * Also embedded in Path C AEAD as optional `prefs[]` (see backupPackage).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ArkadeNetworkId } from "../config/network";

function key(networkId: ArkadeNetworkId, walletId: string): string {
  return `basic.bitcoinMaxi.v1:${networkId}:${walletId}`;
}

function queueMaxiPrefsBackupSync(reason: string): void {
  void import("../nostr/backupSync")
    .then(async (m) => {
      await m.markBackupPackageDirty();
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
    .catch((e) => console.warn("[basic] maxi prefs backup dirty failed", e));
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
  opts?: { syncBackup?: boolean },
): Promise<void> {
  const prev = await readBitcoinMaxiMode(networkId, walletId);
  const next = Boolean(on);
  await AsyncStorage.setItem(
    key(networkId, walletId),
    JSON.stringify({ on: next, updatedAt: Date.now() }),
  );
  if (opts?.syncBackup !== false && next !== prev) {
    queueMaxiPrefsBackupSync(`bitcoinMaxi:${walletId.slice(0, 8)}`);
  }
}
