/**
 * Contact / Nostr identity QR payloads for Home scanner + edit/identity cards.
 *
 * - Identity: `nostr:npub1…`
 * - Contact card: `basicwallet:contact:v1:` + base64url(JSON SharedContactPayload wrapper)
 * - Bare `npub1…` also accepted when scanning
 */

import { base64urlnopad } from "@scure/base";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { looksLikeNpub } from "./detectKind";
import {
  contactToSharePayload,
  sharedPayloadToContact,
  type SharedContactPayload,
} from "./contactShare";
import type { Contact } from "./types";
import { midEllipsis } from "./types";

export const CONTACT_QR_PREFIX = "basicwallet:contact:v1:";
export const CONTACT_QR_TYPE = "basic.wallet.contact.qr";
export const NOSTR_URI_PREFIX = "nostr:";

export type ScannedContactQr =
  | { kind: "npub"; npub: string; payload: SharedContactPayload }
  | { kind: "contact"; payload: SharedContactPayload };

function encodeJson(obj: unknown): string {
  return base64urlnopad.encode(utf8ToBytes(JSON.stringify(obj)));
}

function decodeJson(b64: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64urlnopad.decode(b64)));
}

/** QR string for Nostr Identity card. */
export function encodeNostrIdentityQr(npub: string): string {
  const t = npub.trim();
  if (!t) return "";
  return t.toLowerCase().startsWith(NOSTR_URI_PREFIX) ? t : `${NOSTR_URI_PREFIX}${t}`;
}

/** QR string for a saved contact (may omit npub). */
export function encodeContactQr(contact: Contact): string {
  const payload = contactToSharePayload(contact);
  return (
    CONTACT_QR_PREFIX +
    encodeJson({
      v: 1,
      type: CONTACT_QR_TYPE,
      contact: payload,
    })
  );
}

function npubPayload(npub: string): SharedContactPayload {
  const cleaned = npub.trim();
  return {
    name: midEllipsis(cleaned, 8, 4),
    identifiers: [{ kind: "npub", value: cleaned }],
    fields: [],
  };
}

function parseContactJson(raw: unknown): SharedContactPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as {
    v?: unknown;
    type?: unknown;
    contact?: SharedContactPayload;
  };
  if (o.v !== 1 || o.type !== CONTACT_QR_TYPE) return null;
  if (!o.contact || typeof o.contact.name !== "string" || !o.contact.name.trim()) {
    return null;
  }
  const identifiers = Array.isArray(o.contact.identifiers)
    ? o.contact.identifiers.filter(
        (i): i is SharedContactPayload["identifiers"][number] =>
          !!i &&
          typeof i === "object" &&
          typeof i.kind === "string" &&
          typeof i.value === "string" &&
          !!i.value.trim(),
      )
    : [];
  const fields = Array.isArray(o.contact.fields)
    ? o.contact.fields.filter(
        (f): f is SharedContactPayload["fields"][number] =>
          !!f &&
          typeof f === "object" &&
          typeof f.key === "string" &&
          typeof f.value === "string",
      )
    : [];
  return {
    name: o.contact.name.trim(),
    surname: o.contact.surname,
    note: o.contact.note,
    identifiers,
    fields,
  };
}

/** Extract npub from `nostr:npub1…` or bare npub. */
export function extractNpubFromScan(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  let body = t;
  if (/^nostr:/i.test(body)) {
    body = body.replace(/^nostr:/i, "").trim();
  }
  // nostr:npub1…?… or path junk
  body = body.split(/[/?#\s]/)[0] ?? body;
  if (looksLikeNpub(body)) return body.trim();
  return null;
}

/** Home / shared scanner: contact card or Nostr npub URI. */
export function extractContactOrNostrFromScan(raw: string): ScannedContactQr | null {
  const t = raw.trim();
  if (!t) return null;

  if (t.toLowerCase().startsWith(CONTACT_QR_PREFIX)) {
    try {
      const b64 = t.slice(CONTACT_QR_PREFIX.length);
      const payload = parseContactJson(decodeJson(b64));
      if (!payload) return null;
      return { kind: "contact", payload };
    } catch {
      return null;
    }
  }

  // Plain JSON contact (rare / debug)
  if (t.startsWith("{")) {
    try {
      const payload = parseContactJson(JSON.parse(t));
      if (payload) return { kind: "contact", payload };
    } catch {
      /* fall through */
    }
  }

  const npub = extractNpubFromScan(t);
  if (npub) {
    return { kind: "npub", npub, payload: npubPayload(npub) };
  }

  return null;
}

/** Normalize scanner hit to a destination token for SheetHost branching. */
export function contactQrScanToken(hit: ScannedContactQr): string {
  if (hit.kind === "npub") return encodeNostrIdentityQr(hit.npub);
  return CONTACT_QR_PREFIX + encodeJson({ v: 1, type: CONTACT_QR_TYPE, contact: hit.payload });
}

export function isContactOrNostrScanToken(value: string): boolean {
  const t = value.trim();
  return (
    t.toLowerCase().startsWith(CONTACT_QR_PREFIX) ||
    !!extractNpubFromScan(t)
  );
}

export function contactFromScanToken(value: string): Contact | null {
  const hit = extractContactOrNostrFromScan(value);
  if (!hit) return null;
  return sharedPayloadToContact(hit.payload);
}
