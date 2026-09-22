/**
 * Passkey PRF root → labeled child wallet entropy (Glow-style).
 * Personal uses the root entropy; other labels = HKDF(root, label).
 * Never logs entropy or mnemonics.
 */

import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { mnemonicFromEntropy } from "../onboarding/mnemonicFromEntropy";

export const PERSONAL_WALLET_LABEL = "Personal";

export function normalizeWalletLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ");
}

export function isPersonalLabel(label: string): boolean {
  return normalizeWalletLabel(label).toLowerCase() === PERSONAL_WALLET_LABEL.toLowerCase();
}

/**
 * Stable wallet_id for a passkey-derived child so rematerialize is idempotent.
 * Personal keeps the registry Personal / main slot (not this id).
 */
export function passkeyChildWalletId(label: string): string {
  const norm = normalizeWalletLabel(label);
  if (!norm || isPersonalLabel(norm)) {
    throw new Error("Personal wallet does not use a child id");
  }
  const digest = sha256(utf8ToBytes(`basic.wallet.id.v1:${norm}`));
  return `w_pk_${bytesToHex(digest).slice(0, 16)}`;
}

/** Derive 32-byte entropy for a labeled wallet from the PRF root. */
export function deriveChildEntropy(rootEntropy32: Uint8Array, label: string): Uint8Array {
  if (rootEntropy32.length !== 32) {
    throw new Error("Expected 32-byte PRF root");
  }
  const norm = normalizeWalletLabel(label);
  if (!norm) throw new Error("Wallet label required");
  if (isPersonalLabel(norm)) {
    return new Uint8Array(rootEntropy32);
  }
  return hkdf(
    sha256,
    rootEntropy32,
    undefined,
    utf8ToBytes(`basic.wallet.child.v1:${norm}`),
    32,
  );
}

export function mnemonicFromPasskeyRoot(rootEntropy32: Uint8Array, label: string): string {
  return mnemonicFromEntropy(deriveChildEntropy(rootEntropy32, label));
}
