/**
 * Resolve a contact's Nostr pubkey (npub / NIP-05) for gift-wrap addressing.
 */

import { isValidArkAddress } from "@arkade-os/sdk";
import { decode, npubEncode } from "nostr-tools/nip19";
import {
  getContact,
  listContacts,
  upsertContact,
} from "../contacts/contactStore";
import { resolveNip05 } from "../contacts/resolveNip05";
import {
  midEllipsis,
  newContactId,
  type Contact,
} from "../contacts/types";

/** Identifier label for ark addresses learned from Chat & Pay (silent upsert). */
export const CHAT_ARK_LABEL = "From Chat & Pay";

/** Contact field: inbound peer not yet Add/Deny'd in chat (recipient UX). */
export const CHAT_INVITE_FIELD_KEY = "basic.chatInvite";

export type ChatInviteState = "pending" | "accepted" | "denied";

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
  // Prefer the address learned/updated from Chat & Pay (kept current).
  const fromChat = contact.identifiers.find(
    (i) =>
      i.kind === "ark" &&
      i.label === CHAT_ARK_LABEL &&
      i.value.trim().toLowerCase().startsWith("ark"),
  );
  if (fromChat) return fromChat.value.trim();
  const hit = contact.identifiers.find(
    (i) => i.kind === "ark" && i.value.trim().toLowerCase().startsWith("ark"),
  );
  return hit?.value.trim() ?? null;
}

export function getChatInviteState(contact: Contact): ChatInviteState | null {
  const f = contact.fields.find((x) => x.key === CHAT_INVITE_FIELD_KEY);
  if (!f) return null;
  const v = f.value.trim();
  if (v === "pending" || v === "accepted" || v === "denied") return v;
  return null;
}

export function isChatInvitePending(contact: Contact): boolean {
  return getChatInviteState(contact) === "pending";
}

/** True when the contact should appear in Settings → Contacts. */
export function isDirectoryContact(contact: Contact): boolean {
  const s = getChatInviteState(contact);
  return s !== "pending" && s !== "denied";
}

export function setChatInviteState(
  contactId: string,
  state: ChatInviteState,
): void {
  const contact = getContact(contactId);
  if (!contact) return;
  const others = contact.fields.filter((f) => f.key !== CHAT_INVITE_FIELD_KEY);
  // Accepted → drop the invite field (fully in directory + Nostr sync).
  const fields =
    state === "accepted"
      ? others
      : [
          ...others,
          {
            id: newContactId("f"),
            key: CHAT_INVITE_FIELD_KEY,
            value: state,
          },
        ];
  try {
    upsertContact(
      { ...contact, fields },
      { sync: state === "accepted" },
    );
  } catch {
    /* silent */
  }
}

/**
 * Ensure a local contact exists for an inbound chat peer (no mutual contact yet).
 * Creates a provisional contact with npub + pending invite flag (no directory sync).
 */
export function ensureInboundPeerContact(peerPubkeyHex: string): string {
  const want = peerPubkeyHex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(want)) {
    throw new Error("Invalid peer pubkey");
  }
  const existing = findContactIdByPeerPubkey(want, listContacts());
  if (existing) return existing;

  const npub = npubEncode(want);
  const now = Date.now();
  const contact: Contact = {
    id: newContactId("c"),
    name: midEllipsis(npub, 12, 8),
    identifiers: [
      {
        id: newContactId("id"),
        kind: "npub",
        value: npub,
      },
    ],
    fields: [
      {
        id: newContactId("f"),
        key: CHAT_INVITE_FIELD_KEY,
        value: "pending",
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  upsertContact(contact, { sync: false });
  return contact.id;
}

/**
 * First usable Lightning pay input on a contact (LN address / LNURL / BIP353).
 * Used by chat destination selection; resolve to bolt11 at pay time via lnPayResolve.
 */
export function contactLnPayInput(contact: Contact): string | null {
  const order = ["lightning_address", "lnurl", "bip353"] as const;
  for (const kind of order) {
    const hit = contact.identifiers.find(
      (i) => i.kind === kind && i.value.trim().length > 0,
    );
    if (hit) return hit.value.trim();
  }
  return null;
}

export function contactCanReceiveLn(contact: Contact): boolean {
  return contactLnPayInput(contact) != null;
}

/**
 * Silently upsert an ark address onto a contact when learned from a chat
 * pay-request / reply / payer receipt. Updates the Chat & Pay ark on change.
 * No toast, dialog, or UI feedback.
 */
export function silentlyUpsertContactArkFromChat(
  contactId: string,
  arkAddress: string,
): void {
  const trimmed = arkAddress.trim();
  if (!trimmed || !isValidArkAddress(trimmed)) return;
  const contact = getContact(contactId);
  if (!contact) return;

  const chatSourced = contact.identifiers.find(
    (i) => i.kind === "ark" && i.label === CHAT_ARK_LABEL,
  );
  if (chatSourced && chatSourced.value.trim() === trimmed) return;

  const exactOther = contact.identifiers.find(
    (i) =>
      i.kind === "ark" &&
      i.label !== CHAT_ARK_LABEL &&
      i.value.trim() === trimmed,
  );
  // Same address already stored (manual) and no chat-sourced row yet — stamp label.
  if (exactOther && !chatSourced) {
    const nextIdentifiers = contact.identifiers.map((i) =>
      i.id === exactOther.id ? { ...i, label: CHAT_ARK_LABEL } : i,
    );
    try {
      upsertContact({ ...contact, identifiers: nextIdentifiers }, { sync: true });
    } catch {
      /* silent */
    }
    return;
  }

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
