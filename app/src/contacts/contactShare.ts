/**
 * Share a contact to another Basic Wallet via Nostr NIP-17 gift wrap.
 * Recipient: npub or NIP-05. Message body is JSON (not a chat DM).
 */

import { SimplePool } from "nostr-tools/pool";
import { wrapEvent } from "nostr-tools/nip17";
import { decode, npubEncode } from "nostr-tools/nip19";
import { mergeNostrRelays, readBackupMeta } from "../nostr/backupPackage";
import { HOME_RELAY_HINT } from "../notifications/config";
import {
  hasNostrIdentity,
  loadNostrKeyPairForCrypto,
  readNostrProfile,
} from "../nostr/identityStore";
import { resolveNip05 } from "./resolveNip05";
import type { Contact, ContactField, ContactIdentifier, IdentifierKind } from "./types";
import { newContactId } from "./types";

export const CONTACT_SHARE_TYPE = "basic.wallet.contact.share";
export const CONTACT_SHARE_KIND = 1059;

export type SharedContactPayload = {
  name: string;
  surname?: string;
  note?: string;
  identifiers: Array<{
    kind: IdentifierKind;
    value: string;
    label?: string;
    customKindLabel?: string;
  }>;
  fields: Array<{ key: string; value: string }>;
};

export type ContactShareMessage = {
  v: 1;
  type: typeof CONTACT_SHARE_TYPE;
  contact: SharedContactPayload;
  from: {
    pubkey: string;
    npub: string;
    displayName?: string;
  };
  sharedAt: number;
};

export type ShareContactResult = {
  okRelays: string[];
  failedRelays: { url: string; error: string }[];
  eventId: string;
  recipientPubkey: string;
  recipientNpub: string;
};

async function resolveRelays(extra?: string[]): Promise<string[]> {
  const meta = await readBackupMeta();
  const merged = mergeNostrRelays([
    HOME_RELAY_HINT,
    ...(extra ?? []),
    ...(meta?.relays ?? []),
  ]);
  const home = merged.find((u) => u.toLowerCase().includes("relay.davidcoen.it"));
  if (!home) return mergeNostrRelays([HOME_RELAY_HINT, ...merged]);
  return [home, ...merged.filter((u) => u !== home)];
}

export function contactToSharePayload(contact: Contact): SharedContactPayload {
  return {
    name: contact.name.trim(),
    surname: contact.surname?.trim() || undefined,
    note: contact.note?.trim() || undefined,
    identifiers: contact.identifiers
      .filter((i) => i.value.trim())
      .map((i) => ({
        kind: i.kind,
        value: i.value.trim(),
        label: i.label?.trim() || undefined,
        customKindLabel: i.customKindLabel?.trim() || undefined,
      })),
    fields: contact.fields
      .filter((f) => f.key.trim() || f.value.trim())
      .map((f) => ({ key: f.key.trim(), value: f.value })),
  };
}

export function sharedPayloadToContact(payload: SharedContactPayload): Contact {
  const now = Date.now();
  const identifiers: ContactIdentifier[] = payload.identifiers.map((i) => ({
    id: newContactId("id"),
    kind: i.kind,
    value: i.value,
    label: i.label,
    customKindLabel: i.customKindLabel,
  }));
  const fields: ContactField[] = payload.fields.map((f) => ({
    id: newContactId("f"),
    key: f.key,
    value: f.value,
  }));
  return {
    id: newContactId("c"),
    name: payload.name,
    surname: payload.surname,
    note: payload.note,
    identifiers,
    fields,
    createdAt: now,
    updatedAt: now,
  };
}

export function parseContactShareMessage(raw: string): ContactShareMessage | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ContactShareMessage>;
    if (parsed.v !== 1 || parsed.type !== CONTACT_SHARE_TYPE) return null;
    if (!parsed.contact || typeof parsed.contact !== "object") return null;
    if (typeof parsed.contact.name !== "string" || !parsed.contact.name.trim()) return null;
    if (!parsed.from || typeof parsed.from.pubkey !== "string") return null;
    const identifiers = Array.isArray(parsed.contact.identifiers)
      ? parsed.contact.identifiers.filter(
          (i): i is SharedContactPayload["identifiers"][number] =>
            !!i &&
            typeof i === "object" &&
            typeof i.kind === "string" &&
            typeof i.value === "string" &&
            !!i.value.trim(),
        )
      : [];
    const fields = Array.isArray(parsed.contact.fields)
      ? parsed.contact.fields.filter(
          (f): f is SharedContactPayload["fields"][number] =>
            !!f &&
            typeof f === "object" &&
            typeof f.key === "string" &&
            typeof f.value === "string",
        )
      : [];
    return {
      v: 1,
      type: CONTACT_SHARE_TYPE,
      contact: {
        name: parsed.contact.name.trim(),
        surname:
          typeof parsed.contact.surname === "string" ? parsed.contact.surname : undefined,
        note: typeof parsed.contact.note === "string" ? parsed.contact.note : undefined,
        identifiers,
        fields,
      },
      from: {
        pubkey: parsed.from.pubkey.toLowerCase(),
        npub:
          typeof parsed.from.npub === "string"
            ? parsed.from.npub
            : npubEncode(parsed.from.pubkey),
        displayName:
          typeof parsed.from.displayName === "string" ? parsed.from.displayName : undefined,
      },
      sharedAt: typeof parsed.sharedAt === "number" ? parsed.sharedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

/** Resolve npub1… or name@domain (NIP-05) to hex pubkey. */
export async function resolveShareRecipient(
  raw: string,
  signal?: AbortSignal,
): Promise<{ ok: true; pubkeyHex: string; npub: string } | { ok: false; message: string }> {
  const t = raw.trim().replace(/^@/, "");
  if (!t) return { ok: false, message: "Enter an npub or NIP-05 name@domain." };

  if (t.toLowerCase().startsWith("npub1")) {
    try {
      const decoded = decode(t.toLowerCase());
      if (decoded.type !== "npub") {
        return { ok: false, message: "That is not a valid npub." };
      }
      const data = decoded.data;
      const pubkeyHex =
        typeof data === "string"
          ? data.toLowerCase()
          : Array.from(data as Uint8Array)
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("");
      if (!/^[0-9a-f]{64}$/.test(pubkeyHex)) {
        return { ok: false, message: "Invalid npub pubkey." };
      }
      return { ok: true, pubkeyHex, npub: npubEncode(pubkeyHex) };
    } catch {
      return { ok: false, message: "Invalid npub (check for truncated paste)." };
    }
  }

  if (t.includes("@")) {
    const r = await resolveNip05(t, signal);
    if (!r.ok) return r;
    return { ok: true, pubkeyHex: r.pubkeyHex, npub: r.npub };
  }

  return { ok: false, message: "Use an npub1… or a NIP-05 name@domain." };
}

export async function shareContactToRecipient(
  contact: Contact,
  recipientRaw: string,
  opts?: { relays?: string[]; signal?: AbortSignal },
): Promise<ShareContactResult> {
  if (!(await hasNostrIdentity())) {
    throw new Error("Create a Nostr identity in Settings before sharing contacts.");
  }
  const pair = await loadNostrKeyPairForCrypto();
  if (!pair) throw new Error("No Nostr identity");

  const recipient = await resolveShareRecipient(recipientRaw, opts?.signal);
  if (!recipient.ok) throw new Error(recipient.message);

  if (recipient.pubkeyHex === pair.pubkey.toLowerCase()) {
    throw new Error("You cannot share a contact to yourself.");
  }

  const profile = await readNostrProfile();
  const message: ContactShareMessage = {
    v: 1,
    type: CONTACT_SHARE_TYPE,
    contact: contactToSharePayload(contact),
    from: {
      pubkey: pair.pubkey,
      npub: pair.npub,
      displayName: profile.displayName.trim() || undefined,
    },
    sharedAt: Date.now(),
  };

  const wrap = wrapEvent(pair.sk, { publicKey: recipient.pubkeyHex }, JSON.stringify(message));
  const urls = await resolveRelays(opts?.relays);
  const homeUrl =
    urls.find((u) => u.toLowerCase().includes("relay.davidcoen.it")) ?? HOME_RELAY_HINT;
  const pool = new SimplePool();
  const okRelays: string[] = [];
  const failedRelays: { url: string; error: string }[] = [];

  try {
    const homeSettled = await Promise.allSettled(pool.publish([homeUrl], wrap));
    if (!homeSettled.some((r) => r.status === "fulfilled")) {
      const err = homeSettled.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      throw new Error(
        `Share failed on home relay (${homeUrl}): ${
          err?.reason instanceof Error ? err.reason.message : String(err?.reason ?? "rejected")
        }`,
      );
    }
    okRelays.push(homeUrl);
    const rest = urls.filter((u) => u !== homeUrl);
    if (rest.length) {
      const restSettled = await Promise.allSettled(pool.publish(rest, wrap));
      restSettled.forEach((r, i) => {
        const url = rest[i]!;
        if (r.status === "fulfilled") okRelays.push(url);
        else {
          failedRelays.push({
            url,
            error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          });
        }
      });
    }
  } finally {
    pool.close(urls.includes(homeUrl) ? urls : [homeUrl, ...urls]);
  }

  return {
    okRelays,
    failedRelays,
    eventId: wrap.id,
    recipientPubkey: recipient.pubkeyHex,
    recipientNpub: recipient.npub,
  };
}
