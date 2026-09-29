/**
 * Path C backup sync + session passphrase.
 *
 * Passphrase at rest: SecureStore (same class as nsec/seeds). Device compromise
 * that reads Keystore already has spendable seeds — Path C passphrase mainly
 * protects relay/nsec-only leaks.
 *
 * Session: after 05c biometrics unlock, passphrase is loaded into RAM for
 * deferred dirty flush / manual Update & publish. Cleared when the app locks.
 *
 * Never run PBKDF2/publish on the unlock critical path — schedule after
 * interactions with a delay so Home can paint first.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { InteractionManager } from "react-native";
import {
  clearSessionWrapKey,
  disableEncryptedBackup as disablePackage,
  readBackupMeta,
  refreshEncryptedBackup,
  writeBackupMeta,
  type BackupPackageMeta,
} from "./backupPackage";
import {
  publishEncryptedBackupToRelays,
  rememberPublishMeta,
} from "./backupBroadcast";

const PASSPHRASE_KEY = "basic.wallet.backup.passphrase.v1";
const DIRTY_KEY = "basic.wallet.backup.dirty.v1";

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** In-RAM only after app unlock. */
let sessionPassphrase: string | null = null;

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<BackupPackageMeta | null> | null = null;

export async function persistBackupPassphrase(passphrase: string): Promise<void> {
  const trimmed = passphrase.trim();
  if (!trimmed) throw new Error("Backup passphrase required");
  await SecureStore.setItemAsync(PASSPHRASE_KEY, trimmed, SECURE_OPTIONS);
  sessionPassphrase = trimmed;
}

export async function clearPersistedBackupPassphrase(): Promise<void> {
  sessionPassphrase = null;
  clearSessionWrapKey();
  try {
    await SecureStore.deleteItemAsync(PASSPHRASE_KEY, SECURE_OPTIONS);
  } catch {
    /* missing ok */
  }
}

/** After successful biometrics lock unlock — load passphrase into session. */
export async function unlockBackupPassphraseSession(): Promise<boolean> {
  try {
    const v = await SecureStore.getItemAsync(PASSPHRASE_KEY, SECURE_OPTIONS);
    if (!v?.trim()) {
      sessionPassphrase = null;
      return false;
    }
    sessionPassphrase = v.trim();
    return true;
  } catch {
    sessionPassphrase = null;
    return false;
  }
}

/** Call when app re-locks (background / logout). */
export function lockBackupPassphraseSession(): void {
  sessionPassphrase = null;
  clearSessionWrapKey();
}

export function setSessionBackupPassphrase(passphrase: string): void {
  const trimmed = passphrase.trim();
  if (!trimmed) throw new Error("Backup passphrase required");
  sessionPassphrase = trimmed;
}

export function clearSessionBackupPassphrase(): void {
  sessionPassphrase = null;
  clearSessionWrapKey();
}

export function hasSessionBackupPassphrase(): boolean {
  return !!sessionPassphrase;
}

/** Load passphrase from session or SecureStore (manual Update / sync). Never for BLE pair. */
export async function getPersistedBackupPassphrase(): Promise<string | null> {
  if (sessionPassphrase?.trim()) return sessionPassphrase.trim();
  try {
    const v = await SecureStore.getItemAsync(PASSPHRASE_KEY, SECURE_OPTIONS);
    return v?.trim() || null;
  } catch {
    return null;
  }
}

export async function markBackupPackageDirty(): Promise<void> {
  await AsyncStorage.setItem(DIRTY_KEY, "1");
}

export async function clearBackupPackageDirty(): Promise<void> {
  await AsyncStorage.removeItem(DIRTY_KEY);
}

export async function isBackupPackageDirty(): Promise<boolean> {
  return (await AsyncStorage.getItem(DIRTY_KEY)) === "1";
}

export async function disableEncryptedBackupFully(): Promise<void> {
  await disablePackage();
  await clearPersistedBackupPassphrase();
  await clearBackupPackageDirty();
}

/**
 * Re-pack AEAD + publish. Needs session passphrase (post-unlock).
 * If missing → mark dirty.
 */
export async function syncEncryptedBackupNow(reason: string): Promise<BackupPackageMeta | null> {
  const meta = await readBackupMeta();
  if (!meta?.enabled) return null;

  if (!sessionPassphrase) {
    console.warn("[basic] backup sync deferred (locked / no session passphrase)", reason);
    await markBackupPackageDirty();
    return null;
  }

  if (inFlight) {
    try {
      return await inFlight;
    } catch {
      /* fall through to new run */
    }
  }

  const passphrase = sessionPassphrase;
  const run = (async () => {
    console.warn("[basic] backup sync", reason);
    let next = await refreshEncryptedBackup(passphrase);
    if (next.channel === "nostr") {
      try {
        const pub = await publishEncryptedBackupToRelays(next.relays);
        next = await rememberPublishMeta(next, pub);
      } catch (e) {
        console.warn("[basic] backup sync publish failed", reason, e);
        await markBackupPackageDirty();
        return next;
      }
    } else if (next.channel === "home" && next.homeUrl) {
      try {
        const { readCipherBlob } = await import("./backupPackage");
        const { uploadHomeBackupCipher } = await import("./homeServerWebdav");
        const blob = await readCipherBlob();
        if (!blob) throw new Error("No local cipher blob to upload");
        await uploadHomeBackupCipher(next.homeUrl, blob);
        next = {
          ...next,
          lastPublishedAt: Date.now(),
          lastPublishOk: (next.lastPublishOk ?? 0) + 1,
        };
        await writeBackupMeta(next);
      } catch (e) {
        console.warn("[basic] home backup upload failed", reason, e);
        await markBackupPackageDirty();
        return next;
      }
    }
    await clearBackupPackageDirty();
    return next;
  })();

  inFlight = run;
  try {
    return await run;
  } finally {
    if (inFlight === run) inFlight = null;
  }
}

/**
 * Debounced sync after UI is idle. Prefer this over syncEncryptedBackupNow
 * on unlock / navigation transitions.
 */
export function scheduleEncryptedBackupSync(reason: string, delayMs = 8_000): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    InteractionManager.runAfterInteractions(() => {
      void syncEncryptedBackupNow(reason).catch((e) => {
        console.warn("[basic] backup sync failed", reason, e);
      });
    });
  }, delayMs);
}

/** Wallet create/rename/remove — short delay, still off the tap critical path. */
export function queueEncryptedBackupSync(reason: string): void {
  scheduleEncryptedBackupSync(reason, 3_000);
}
