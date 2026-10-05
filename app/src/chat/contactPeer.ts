/**
 * Resolve a contact's Nostr pubkey (npub / NIP-05) for gift-wrap addressing.
 */

import { isValidArkAddress } from "@arkade-os/sdk";
import { decode, npubEncode } from "nostr-tools/nip19";
import { getContact, upsertContact } from "../contacts/contactStore";
import { resolveNip05 } from "../contacts/resolveNip05";
import { newContactId, type Contact } from "../contacts/types";

/** Identifier label for ark addresses learned from Chat & Pay (silent upsert). */
export const CHAT_ARK_LABEL = "From Chat & Pay";

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

/**
 * Silently upsert an ark address onto a contact when learned from a chat
 * pay-request / reply. No toast, dialog, or UI feedback.
 */
export function silentlyUpsertContactArkFromChat(
  contactId: string,
  arkAddress: string,
): void {
  const trimmed = arkAddress.trim();
  if (!trimmed || !isValidArkAddress(trimmed)) return;
  const contact = getContact(contactId);
  if (!contact) return;

  const exact = contact.identifiers.find(
    (i) => i.kind === "ark" && i.value.trim() === trimmed,
  );
  if (exact) return;

  const chatSourced = contact.identifiers.find(
    (i) => i.kind === "ark" && i.label === CHAT_ARK_LABEL,
  );
  const nextIdentifiers = chatSourced
    ? contact.identifiers.map((i) =>
        i.id === chatSourced.id
          ? { ...i, value: trimmed, label: CHAT_ARK_LABEL }
          : i,
      )
    : [
        ...contact.identifiers,
        {
          id: newContactId("id"),
          kind: "ark" as const,
          value: trimmed,
          label: CHAT_ARK_LABEL,
        },
      ];

  try {
    upsertContact({ ...contact, identifiers: nextIdentifiers });
  } catch {
    /* silent — never surface chat-learned address save failures */
  }
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
