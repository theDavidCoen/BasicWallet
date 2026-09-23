/**
 * Persist whether the user has completed first-time wallet setup / warmup.
 * Returning cold starts show "Welcome back" instead of "Setting up".
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export const WARMUP_SEEN_KEY = "basic.warmup.completed";

export async function markWarmupSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(WARMUP_SEEN_KEY, "1");
  } catch {
    /* optional */
  }
}

export async function clearWarmupSeen(): Promise<void> {
  try {
    await AsyncStorage.removeItem(WARMUP_SEEN_KEY);
  } catch {
    /* optional */
  }
}

export async function readWarmupSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(WARMUP_SEEN_KEY)) === "1";
  } catch {
    return false;
  }
}
