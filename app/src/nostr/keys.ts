/**
 * Nostr key helpers (nsec / npub). Never log secret material.
 */

import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { decode, nsecEncode, npubEncode } from "nostr-tools/nip19";

export type NostrKeyPair = {
  /** Hex public key (32 bytes). */
  pubkey: string;
  npub: string;
  nsec: string;
  /** Raw 32-byte secret. */
  sk: Uint8Array;
};

export function generateNostrKeys(): NostrKeyPair {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  return {
    sk,
    pubkey,
    npub: npubEncode(pubkey),
    nsec: nsecEncode(sk),
  };
}

export function pairFromSecretKey(sk: Uint8Array): NostrKeyPair {
  if (sk.length !== 32) throw new Error("Invalid secret key length");
  const pubkey = getPublicKey(sk);
  return {
    sk,
    pubkey,
    npub: npubEncode(pubkey),
    nsec: nsecEncode(sk),
  };
}

/** Accept nsec bech32 or 64-char hex. Strips whitespace / zero-width junk from paste. */
export function parseNsecInput(raw: string): NostrKeyPair {
  const trimmed = raw
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/\s+/g, "");
  if (!trimmed) throw new Error("Empty nsec");

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("npub1")) {
    throw new Error("That is an npub (public). Paste the nsec instead.");
  }

  if (lower.startsWith("nsec1")) {
    try {
      const decoded = decode(lower);
      if (decoded.type !== "nsec") throw new Error("Not an nsec");
      return pairFromSecretKey(decoded.data as Uint8Array);
    } catch (e) {
      if (e instanceof Error && e.message === "Not an nsec") throw e;
      throw new Error("Invalid nsec (check for truncated paste)");
    }
  }

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const sk = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      sk[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    }
    return pairFromSecretKey(sk);
  }

  throw new Error("Expected nsec1… or 64-char hex");
}

export function midEllipsis(s: string, head = 10, tail = 6): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}
