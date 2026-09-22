/**
 * Bottom reminder after onboarding "Continue without backup".
 * Cleared when Nostr/home backup is enabled or seed export is confirmed.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const PENDING_KEY = "basic.wallet.backupReminder.pending.v1";
const SEED_CONFIRMED_KEY = "basic.wallet.backupReminder.seedConfirmed.v1";

export async function setBackupReminderPending(): Promise<void> {
  await AsyncStorage.setItem(PENDING_KEY, "1");
}

export async function clearBackupReminder(): Promise<void> {
  await AsyncStorage.multiRemove([PENDING_KEY, SEED_CONFIRMED_KEY]);
}

/** Seed export "I wrote it down" satisfies the reminder. */
export async function markSeedExportConfirmed(): Promise<void> {
  await AsyncStorage.multiRemove([PENDING_KEY]);
  await AsyncStorage.setItem(SEED_CONFIRMED_KEY, "1");
}

export async function isBackupReminderPending(): Promise<boolean> {
  const pending = await AsyncStorage.getItem(PENDING_KEY);
  if (pending !== "1") return false;
  const seedOk = await AsyncStorage.getItem(SEED_CONFIRMED_KEY);
  return seedOk !== "1";
}

/** Routes where the reminder must stay hidden (Settings tree + onboarding/modals). */
export const BACKUP_REMINDER_HIDDEN_ROUTES = new Set<string>([
  "OnboardingCreate",
  "OnboardingSecurity",
  "TermsOfUse",
  "Ready",
  "Settings",
  "ArkadeSettings",
  "Privacy",
  "SetAppPin",
  "AdvancedBackup",
  "NostrBackup",
  "HomeServerBackup",
  "ExportRecoveryPhrase",
  "NostrIdentity",
  "ExportNsecWarning",
  "ExportNsecReveal",
  "GenerateIdentityWarning",
  "ImportNsecWarning",
  "ResetApp",
  "RestoreWallet",
  "DisplayCurrencies",
  "Delegates",
  "ExitRecoveryAddress",
  "CollaborativeOffboard",
  "UnilateralExitHub",
  "UnilateralExitPrepare",
  "UnilateralExitFund",
  "UnilateralExitExecute",
  "ConnectedNode",
  "ConnectNode",
  "ConnectLndHub",
  "ConnectBtcPay",
  "NodeStatus",
]);
