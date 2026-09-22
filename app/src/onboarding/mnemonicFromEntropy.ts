/**
 * Derive BIP39 24-word mnemonic from 32-byte entropy. Never logs the phrase.
 */

import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import * as Crypto from "expo-crypto";

export function mnemonicFromEntropy(entropy32: Uint8Array): string {
  if (entropy32.length !== 32) {
    throw new Error("Expected 32 bytes of entropy for 24-word mnemonic");
  }
  return entropyToMnemonic(entropy32, wordlist);
}

/** CSPRNG 32 bytes — only for __DEV__ bootstrap when PRF is unavailable. */
export async function randomEntropy32(): Promise<Uint8Array> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return new Uint8Array(bytes);
}
