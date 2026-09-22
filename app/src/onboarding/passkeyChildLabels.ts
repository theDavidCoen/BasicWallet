/**
 * Non-secret list of passkey-derived child wallet labels.
 * Survives factory reset so Continue with passkey can rematerialize children.
 * Personal is never stored here (always derived from root).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { isPersonalLabel, normalizeWalletLabel } from "./passkeyChildWallets";

export const PASSKEY_CHILD_LABELS_KEY = "basic.wallet.passkey.childLabels.v1";

export async function readPasskeyChildLabels(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(PASSKEY_CHILD_LABELS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const norm = normalizeWalletLabel(item);
      if (!norm || isPersonalLabel(norm)) continue;
      const key = norm.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(norm);
    }
    return out;
  } catch {
    return [];
  }
}

export async function addPasskeyChildLabel(label: string): Promise<string[]> {
  const norm = normalizeWalletLabel(label);
  if (!norm || isPersonalLabel(norm)) {
    throw new Error("Invalid child wallet label");
  }
  const existing = await readPasskeyChildLabels();
  if (existing.some((l) => l.toLowerCase() === norm.toLowerCase())) {
    return existing;
  }
  const next = [...existing, norm];
  await AsyncStorage.setItem(PASSKEY_CHILD_LABELS_KEY, JSON.stringify(next));
  return next;
}

export async function removePasskeyChildLabel(label: string): Promise<string[]> {
  const norm = normalizeWalletLabel(label);
  const existing = await readPasskeyChildLabels();
  if (!norm) return existing;
  const next = existing.filter((l) => l.toLowerCase() !== norm.toLowerCase());
  await AsyncStorage.setItem(PASSKEY_CHILD_LABELS_KEY, JSON.stringify(next));
  return next;
}

export async function writePasskeyChildLabels(labels: string[]): Promise<void> {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const label of labels) {
    const norm = normalizeWalletLabel(label);
    if (!norm || isPersonalLabel(norm)) continue;
    const key = norm.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(norm);
  }
  await AsyncStorage.setItem(PASSKEY_CHILD_LABELS_KEY, JSON.stringify(next));
}
