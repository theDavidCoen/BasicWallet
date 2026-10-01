/**
 * Resolve a contact's Nostr pubkey (npub / NIP-05) for gift-wrap addressing.
 */

import { decode, npubEncode } from "nostr-tools/nip19";
import { resolveNip05 } from "../contacts/resolveNip05";
import type { Contact } from "../contacts/types";

export type PeerPubkeyResult =
  | { ok: true; pubkeyHex: string; npub: string }
  | { ok: false; message: string };

export function contactHasNostrId(contact: Contact): boolean {
  return contact.identifiers.some(
    (i) =>
      (i.kind === "npub" || i.kind === "nip05") && i.value.trim().length > 0,
  );
}

export function contactArkAddress(contact: Contact): string | null {
  const hit = contact.identifiers.find(
    (i) => i.kind === "ark" && i.value.trim().toLowerCase().startsWith("ark"),
  );
  return hit?.value.trim() ?? null;
}

export async function resolveContactPeerPubkey(
  contact: Contact,
  signal?: AbortSignal,
): Promise<PeerPubkeyResult> {
  const npubIdent = contact.identifiers.find((i) => i.kind === "npub" && i.value.trim());
  if (npubIdent) {
    const t = npubIdent.value.trim().toLowerCase();
    try {
      const decoded = decode(t);
      if (decoded.type !== "npub") {
        return { ok: false, message: "Contact npub is invalid." };
      }
      const data = decoded.data;
      const pubkeyHex =
        typeof data === "string"
          ? data.toLowerCase()
          : Array.from(data as Uint8Array)
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("");
      if (!/^[0-9a-f]{64}$/.test(pubkeyHex)) {
        return { ok: false, message: "Contact npub pubkey is invalid." };
      }
      return { ok: true, pubkeyHex, npub: npubEncode(pubkeyHex) };
    } catch {
      return { ok: false, message: "Contact npub is invalid." };
    }
  }

  const nip05Ident = contact.identifiers.find((i) => i.kind === "nip05" && i.value.trim());
  if (nip05Ident) {
    const r = await resolveNip05(nip05Ident.value.trim(), signal);
    if (!r.ok) return r;
    return { ok: true, pubkeyHex: r.pubkeyHex, npub: r.npub };
  }

  return {
    ok: false,
    message: "Add an npub or NIP-05 to this contact for encrypted chat and requests.",
  };
}

/** Find local contact by peer hex pubkey (npub identifier match). */
export function findContactIdByPeerPubkey(
  pubkeyHex: string,
  contacts: Contact[],
): string | null {
  const want = pubkeyHex.toLowerCase();
  for (const c of contacts) {
    for (const id of c.identifiers) {
      if (id.kind !== "npub" || !id.value.trim()) continue;
      try {
        const decoded = decode(id.value.trim().toLowerCase());
        if (decoded.type !== "npub") continue;
        const data = decoded.data;
        const hex =
          typeof data === "string"
            ? data.toLowerCase()
            : Array.from(data as Uint8Array)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
        if (hex === want) return c.id;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}
