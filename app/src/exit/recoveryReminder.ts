/**
 * One-shot reminder: set an external recovery address after balance ≥ 50k sats.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const DISMISSED_KEY = "basic.exit.recoveryReminder.dismissed.v1";
export const RECOVERY_REMINDER_THRESHOLD_SATS = 50_000;

export async function isRecoveryReminderDismissed(): Promise<boolean> {
  return (await AsyncStorage.getItem(DISMISSED_KEY)) === "1";
}

export async function dismissRecoveryReminder(): Promise<void> {
  await AsyncStorage.setItem(DISMISSED_KEY, "1");
}

export async function clearRecoveryReminderDismissed(): Promise<void> {
  await AsyncStorage.removeItem(DISMISSED_KEY);
}

export async function shouldShowRecoveryReminder(opts: {
  balanceSats: number | null;
  hasRecoveryAddress: boolean;
}): Promise<boolean> {
  if (opts.hasRecoveryAddress) return false;
  if (opts.balanceSats === null || opts.balanceSats < RECOVERY_REMINDER_THRESHOLD_SATS) {
    return false;
  }
  if (await isRecoveryReminderDismissed()) return false;
  return true;
}
