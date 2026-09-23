/**
 * Passkey PRF root → indexed child wallet entropy.
 * Personal uses the root entropy; children = HKDF(root, index).
 * Never logs entropy or mnemonics.
 */

import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { mnemonicFromEntropy } from "../onboarding/mnemonicFromEntropy";
import { pairFromSecretKey, type NostrKeyPair } from "../nostr/keys";

export const PERSONAL_WALLET_LABEL = "Personal";

export function normalizeWalletLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ");
}

export function isPersonalLabel(label: string): boolean {
  return normalizeWalletLabel(label).toLowerCase() === PERSONAL_WALLET_LABEL.toLowerCase();
}

function assertRoot(rootEntropy32: Uint8Array): void {
  if (rootEntropy32.length !== 32) {
    throw new Error("Expected 32-byte PRF root");
  }
}

/** Stable wallet_id for a passkey-derived child (Personal uses registry main slot). */
export function passkeyChildWalletIdByIndex(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error("Passkey child index must be a non-negative integer");
  }
  return `w_pk_i_${index}`;
}

/** Derive 32-byte entropy for child index `i` from the PRF root. */
export function deriveChildEntropyByIndex(rootEntropy32: Uint8Array, index: number): Uint8Array {
  assertRoot(rootEntropy32);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error("Passkey child index must be a non-negative integer");
  }
  return hkdf(
    sha256,
    rootEntropy32,
    undefined,
    utf8ToBytes(`basic.wallet.child.idx.v1:${index}`),
    32,
  );
}

export function mnemonicFromPersonalRoot(rootEntropy32: Uint8Array): string {
  assertRoot(rootEntropy32);
  return mnemonicFromEntropy(new Uint8Array(rootEntropy32));
}

export function mnemonicFromPasskeyChildIndex(rootEntropy32: Uint8Array, index: number): string {
  return mnemonicFromEntropy(deriveChildEntropyByIndex(rootEntropy32, index));
}

/** Deterministic Nostr secret from the same PRF root (domain-separated). */
export function deriveNostrSecretKey(rootEntropy32: Uint8Array): Uint8Array {
  assertRoot(rootEntropy32);
  return hkdf(
    sha256,
    rootEntropy32,
    undefined,
    utf8ToBytes("basic.wallet.nostr.sk.v1"),
    32,
  );
}

export function nostrPairFromPasskeyRoot(rootEntropy32: Uint8Array): NostrKeyPair {
  return pairFromSecretKey(deriveNostrSecretKey(rootEntropy32));
}
