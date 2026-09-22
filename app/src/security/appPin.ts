/**
 * App unlock PIN (Penpot 01f) — separate from OS device PIN / Duress PIN.
 * Stored as salted SHA-256 in SecureStore; never plaintext.
 */

import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

const PIN_KEY = "basic.wallet.appPin.v1";
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const PIN_LEN_MIN = 4;
const PIN_LEN_MAX = 8;

type PinRecord = { saltHex: string; hashHex: string };

export function validatePinFormat(pin: string): { ok: true } | { ok: false; message: string } {
  if (!/^\d+$/.test(pin)) return { ok: false, message: "PIN must be digits only." };
  if (pin.length < PIN_LEN_MIN || pin.length > PIN_LEN_MAX) {
    return { ok: false, message: `PIN must be ${PIN_LEN_MIN}–${PIN_LEN_MAX} digits.` };
  }
  return { ok: true };
}

async function hashPin(pin: string, salt: Uint8Array): Promise<string> {
  const dig = sha256(utf8ToBytes(`${bytesToHex(salt)}\n${pin}`));
  return bytesToHex(dig);
}

export async function hasAppPin(): Promise<boolean> {
  try {
    const raw = await SecureStore.getItemAsync(PIN_KEY, SECURE_OPTIONS);
    return !!raw;
  } catch {
    return false;
  }
}

export async function setAppPin(pin: string): Promise<void> {
  const check = validatePinFormat(pin);
  if (!check.ok) throw new Error(check.message);
  const salt = await Crypto.getRandomBytesAsync(16);
  const hashHex = await hashPin(pin, salt);
  const rec: PinRecord = { saltHex: bytesToHex(salt), hashHex };
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(rec), SECURE_OPTIONS);
}

export async function verifyAppPin(pin: string): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(PIN_KEY, SECURE_OPTIONS);
  if (!raw) return false;
  let rec: PinRecord;
  try {
    rec = JSON.parse(raw) as PinRecord;
  } catch {
    return false;
  }
  if (!rec.saltHex || !rec.hashHex) return false;
  const hashHex = await hashPin(pin, hexToBytes(rec.saltHex));
  return hashHex === rec.hashHex;
}

export async function clearAppPin(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(PIN_KEY, SECURE_OPTIONS);
  } catch {
    /* missing ok */
  }
}
