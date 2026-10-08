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
/** Set only when BLE pair re-arms backup meta without a session passphrase. */
const PASSPHRASE_NEEDED_AFTER_PAIR_KEY =
  "basic.wallet.backup.passphraseNeededAfterPair.v1";

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** In-RAM only after app unlock. */
let sessionPassphrase: string | null = null;

type SessionListener = () => void;
const sessionListeners = new Set<SessionListener>();

function notifyBackupPassphraseSessionChange(): void {
  for (const listener of sessionListeners) {
    try {
      listener();
    } catch {
      /* ignore listener errors */
    }
  }
}

/** Subscribe to RAM session set/clear (banner refresh after lock / pair entry). */
export function onBackupPassphraseSessionChange(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

function assignSessionPassphrase(next: string | null): void {
  if (sessionPassphrase === next) return;
  sessionPassphrase = next;
  if (!next) clearSessionWrapKey();
  notifyBackupPassphraseSessionChange();
}

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<BackupPackageMeta | null> | null = null;

export async function persistBackupPassphrase(passphrase: string): Promise<void> {
  const trimmed = passphrase.trim();
  if (!trimmed) throw new Error("Backup passphrase required");
  await SecureStore.setItemAsync(PASSPHRASE_KEY, trimmed, SECURE_OPTIONS);
  assignSessionPassphrase(trimmed);
}

export async function clearPersistedBackupPassphrase(): Promise<void> {
  assignSessionPassphrase(null);
  try {
    await SecureStore.deleteItemAsync(PASSPHRASE_KEY, SECURE_OPTIONS);
  } catch {
    /* missing ok */
  }
}

/**
 * After successful biometrics / AppLock unlock — load passphrase into session.
 *
 * Important: never wipe a warm RAM session on empty/throw SecureStore reads.
 * Pair Approve UV can background the app and clear session via AppLockGate;
 * a transient keystore miss right after the bio sheet must not also erase a
 * session that still held the secret (α41 fail: loud error despite backup ON).
 */
export async function unlockBackupPassphraseSession(): Promise<boolean> {
  try {
    const v = await SecureStore.getItemAsync(PASSPHRASE_KEY, SECURE_OPTIONS);
    if (!v?.trim()) {
      return !!sessionPassphrase?.trim();
    }
    assignSessionPassphrase(v.trim());
    return true;
  } catch {
    return !!sessionPassphrase?.trim();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ensure the backup AEAD passphrase is available for BLE pair packing.
 * Same SecureStore key as AppLock unlock (`basic.wallet.backup.passphrase.v1`).
 * Retries after UV — OEM bio sheets can briefly race SecureStore reads.
 * Returns null only when SecureStore is truly empty/unreadable (legacy path:
 * α38 re-arm without transfer, or BackupPassphraseSheet session-only entry).
 */
export async function ensureBackupPassphraseForPair(): Promise<string | null> {
  const existing = await getPersistedBackupPassphrase();
  if (existing?.trim()) return existing.trim();

  let sawSecureStore = false;
  let secureStoreThrows = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(80 * attempt);
    await unlockBackupPassphraseSession();
    const fromSession = sessionPassphrase?.trim();
    if (fromSession) return fromSession;
    try {
      const v = await SecureStore.getItemAsync(PASSPHRASE_KEY, SECURE_OPTIONS);
      if (v?.trim()) {
        assignSessionPassphrase(v.trim());
        return v.trim();
      }
      // Empty string / null = key absent, not a race.
      sawSecureStore = true;
    } catch {
      secureStoreThrows += 1;
    }
  }
  console.warn("[basic] pair backup passphrase missing", {
    sessionWarm: !!sessionPassphrase?.trim(),
    secureStoreEmpty: sawSecureStore,
    secureStoreThrows,
  });
  return null;
}

/** True when cloud backup meta is armed (channel ON). */
export async function isCloudBackupMetaArmed(): Promise<boolean> {
  const meta = await readBackupMeta();
  return !!(meta?.enabled && meta.channel);
}

/** Call when app re-locks (background / logout). */
export function lockBackupPassphraseSession(): void {
  assignSessionPassphrase(null);
}

export function setSessionBackupPassphrase(passphrase: string): void {
  const trimmed = passphrase.trim();
  if (!trimmed) throw new Error("Backup passphrase required");
  assignSessionPassphrase(trimmed);
}

export function clearSessionBackupPassphrase(): void {
  assignSessionPassphrase(null);
}

export function hasSessionBackupPassphrase(): boolean {
  return !!sessionPassphrase;
}

/** Load passphrase from session or SecureStore (manual Update / sync / BLE pair). */
export async function getPersistedBackupPassphrase(): Promise<string | null> {
  if (sessionPassphrase?.trim()) return sessionPassphrase.trim();
  try {
    const v = await SecureStore.getItemAsync(PASSPHRASE_KEY, SECURE_OPTIONS);
    return v?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Legacy: arm the Home passphrase banner after BLE pair re-armed meta without
 * a transferred passphrase. α41+ applyPairLoginPackage persists the passphrase
 * and clears this flag instead — happy path never shows the banner.
 */
export async function markBackupPassphraseNeededAfterPair(): Promise<void> {
  await AsyncStorage.setItem(PASSPHRASE_NEEDED_AFTER_PAIR_KEY, "1");
  notifyBackupPassphraseSessionChange();
}

/** Clear after successful Confirm (or when backup is fully disabled). */
export async function clearBackupPassphraseNeededAfterPair(): Promise<void> {
  await AsyncStorage.removeItem(PASSPHRASE_NEEDED_AFTER_PAIR_KEY);
  notifyBackupPassphraseSessionChange();
}

/**
 * True only when BLE pair explicitly flagged passphrase entry AND meta is still
 * armed AND the RAM session has no passphrase.
 * Do NOT treat "backup meta enabled && !sessionPassphrase" alone as needing
 * this banner — that would wrongly prompt Device 1 after restart/upgrade.
 * Does not mean "no backup set up".
 */
export async function needsBackupPassphraseEntry(): Promise<boolean> {
  if (hasSessionBackupPassphrase()) return false;
  const flagged =
    (await AsyncStorage.getItem(PASSPHRASE_NEEDED_AFTER_PAIR_KEY)) === "1";
  if (!flagged) return false;
  const meta = await readBackupMeta();
  if (!meta?.enabled || !meta.channel) return false;
  return true;
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
  await clearBackupPassphraseNeededAfterPair();
}

/**
 * After biometrics / PIN / no-lock resume: load SecureStore passphrase and
 * schedule a deferred pack+upload when Path C is armed.
 *
 * Always schedule when armed (not only when dirty). A prior bug cleared dirty
 * inside enableEncryptedBackup before WebDAV/Nostr publish; after a kill in
 * that window dirty stayed false forever and post-unlock skipped the PUT.
 */
export async function flushEncryptedBackupAfterUnlock(reason: string): Promise<void> {
  const loaded = await unlockBackupPassphraseSession();
  if (!loaded) {
    console.warn("[basic] backup unlock flush skip (no passphrase session)", reason);
    return;
  }
  const meta = await readBackupMeta();
  if (!meta?.enabled) {
    console.warn("[basic] backup unlock flush skip (backup off)", reason);
    return;
  }
  const dirty = await isBackupPackageDirty();
  const unpublished =
    typeof meta.updatedAt === "number" &&
    meta.updatedAt > (meta.lastPublishedAt ?? 0);
  console.warn("[basic] backup unlock flush", {
    reason,
    dirty,
    unpublished,
    channel: meta.channel,
  });
  scheduleEncryptedBackupSync(reason, 8_000);
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
        // Must throw: callers (manual Update) treat a returned meta as success.
        throw e instanceof Error ? e : new Error(String(e));
      }
    } else if (next.channel === "home" && next.homeUrl) {
      try {
        const { readCipherBlob } = await import("./backupPackage");
        const { uploadHomeBackupCipher } = await import("./homeServerWebdav");
        const blob = await readCipherBlob();
        if (!blob) throw new Error("No local cipher blob to upload");
        const uploaded = await uploadHomeBackupCipher(next.homeUrl, blob);
        console.warn("[basic] home backup uploaded", reason, uploaded.fileUrl);
        next = {
          ...next,
          lastPublishedAt: Date.now(),
          lastPublishOk: (next.lastPublishOk ?? 0) + 1,
        };
        await writeBackupMeta(next);
      } catch (e) {
        console.warn("[basic] home backup upload failed", reason, e);
        await markBackupPackageDirty();
        // Do not return local re-pack meta as success — UI would show
        // "Backup updated" while Nextcloud never received the PUT (423 Locked).
        throw e instanceof Error ? e : new Error(String(e));
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
 *
 * Always mark dirty first so a background kill / frozen timer before the
 * debounce fires still flushes on the next unlock / no-lock resume.
 */
export function scheduleEncryptedBackupSync(reason: string, delayMs = 8_000): void {
  void markBackupPackageDirty().catch(() => {});
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
