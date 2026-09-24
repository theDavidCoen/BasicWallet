/**
 * Always-on encrypted contacts directory on Nostr.
 * Pattern: labelDirectory.ts — NIP-44 + kind 30078, no Path C passphrase gate.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { finalizeEvent, type EventTemplate } from "nostr-tools/pure";
import { SimplePool } from "nostr-tools/pool";
import { v2 as nip44 } from "nostr-tools/nip44";
import { DEFAULT_NOSTR_RELAYS, readBackupMeta } from "../nostr/backupPackage";
import {
  ensureNostrIdentity,
  loadNostrKeyPairForCrypto,
} from "../nostr/identityStore";
import type { Contact, ContactIdentifier, ContactField, IdentifierKind } from "./types";
import { listContacts, replaceAllContacts } from "./contactStore";

export const CONTACTS_EVENT_KIND = 30078;
const CONTACTS_D_DOMAIN = "basic.wallet.contacts.d.v1";

export type ContactsDirectoryPayload = {
  v: 1;
  contacts: Contact[];
};

export type PublishContactsResult = {
  okRelays: string[];
  failedRelays: { url: string; error: string }[];
  eventId: string;
};

export function deriveContactsDTag(sk: Uint8Array): string {
  if (sk.length !== 32) throw new Error("Invalid secret key");
  const domain = utf8ToBytes(CONTACTS_D_DOMAIN);
  const material = new Uint8Array(sk.length + domain.length);
  material.set(sk, 0);
  material.set(domain, sk.length);
  return bytesToHex(sha256(material));
}

async function resolveRelays(relays?: string[]): Promise<string[]> {
  if (relays?.length) return relays;
  const meta = await readBackupMeta();
  if (meta?.relays?.length) return meta.relays;
  return DEFAULT_NOSTR_RELAYS;
}

function encryptPayload(sk: Uint8Array, pubkey: string, payload: ContactsDirectoryPayload): string {
  const conversationKey = nip44.utils.getConversationKey(sk, pubkey);
  return nip44.encrypt(JSON.stringify(payload), conversationKey);
}

function decryptPayload(sk: Uint8Array, pubkey: string, content: string): ContactsDirectoryPayload {
  const conversationKey = nip44.utils.getConversationKey(sk, pubkey);
  const text = nip44.decrypt(content, conversationKey);
  const parsed = JSON.parse(text) as ContactsDirectoryPayload;
  if (parsed.v !== 1 || !Array.isArray(parsed.contacts)) {
    throw new Error("Unsupported contacts directory payload");
  }
  return parsed;
}

function sanitizeContact(raw: unknown): Contact | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<Contact>;
  if (typeof c.id !== "string" || typeof c.name !== "string") return null;
  if (!Array.isArray(c.identifiers) || c.identifiers.length < 1) return null;
  const identifiers: ContactIdentifier[] = [];
  for (const id of c.identifiers) {
    if (!id || typeof id !== "object") continue;
    const i = id as Partial<ContactIdentifier>;
    if (typeof i.id !== "string" || typeof i.kind !== "string" || typeof i.value !== "string") {
      continue;
    }
    identifiers.push({
      id: i.id,
      kind: i.kind as IdentifierKind,
      value: i.value,
      label: typeof i.label === "string" ? i.label : undefined,
      customKindLabel: typeof i.customKindLabel === "string" ? i.customKindLabel : undefined,
      lastResolved:
        i.lastResolved &&
        typeof i.lastResolved === "object" &&
        typeof i.lastResolved.at === "number" &&
        typeof i.lastResolved.kind === "string" &&
        typeof i.lastResolved.value === "string"
          ? i.lastResolved
          : undefined,
    });
  }
  if (!identifiers.length) return null;
  const fields: ContactField[] = [];
  if (Array.isArray(c.fields)) {
    for (const f of c.fields) {
      if (!f || typeof f !== "object") continue;
      const field = f as Partial<ContactField>;
      if (typeof field.id !== "string" || typeof field.key !== "string" || typeof field.value !== "string") {
        continue;
      }
      fields.push({ id: field.id, key: field.key, value: field.value });
    }
  }
  return {
    id: c.id,
    name: c.name,
    note: typeof c.note === "string" ? c.note : undefined,
    identifiers,
    fields,
    createdAt: typeof c.createdAt === "number" ? c.createdAt : Date.now(),
    updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : Date.now(),
  };
}

function maxUpdatedAt(contacts: Contact[]): number {
  let m = 0;
  for (const c of contacts) {
    if (c.updatedAt > m) m = c.updatedAt;
  }
  return m;
}

export async function publishContactsDirectory(
  relays?: string[],
): Promise<PublishContactsResult> {
  await ensureNostrIdentity();
  const pair = await loadNostrKeyPairForCrypto();
  if (!pair) throw new Error("No Nostr identity");

  const payload: ContactsDirectoryPayload = { v: 1, contacts: listContacts() };
  const content = encryptPayload(pair.sk, pair.pubkey, payload);
  if (!content || content.trimStart().startsWith("{")) {
    throw new Error("Refusing to publish non-encrypted contacts directory");
  }

  const urls = await resolveRelays(relays);
  const dTag = deriveContactsDTag(pair.sk);
  const template: EventTemplate = {
    kind: CONTACTS_EVENT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", dTag]],
    content,
  };
  const event = finalizeEvent(template, pair.sk);
  const pool = new SimplePool();
  const okRelays: string[] = [];
  const failedRelays: { url: string; error: string }[] = [];

  try {
    const pubs = pool.publish(urls, event);
    const settled = await Promise.allSettled(pubs);
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]!;
      const r = settled[i]!;
      if (r.status === "fulfilled") okRelays.push(url);
      else {
        failedRelays.push({
          url,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }
  } finally {
    pool.close(urls);
  }

  if (!okRelays.length) {
    throw new Error(
      failedRelays[0]?.error
        ? `Contacts publish failed: ${failedRelays[0].error}`
        : "Contacts publish failed on all relays",
    );
  }

  return { okRelays, failedRelays, eventId: event.id };
}

let publishTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced fire-and-forget publish after local mutations. */
export function queuePublishContactsDirectory(reason: string): void {
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    publishTimer = null;
    void publishContactsDirectory().catch((e) => {
      console.warn("[basic] contacts directory publish failed", reason, e);
    });
  }, 400);
}

/**
 * Fetch remote directory; apply if newer than local (LWW on max updatedAt).
 * Returns applied contacts or null if none / local ahead.
 */
export async function fetchAndApplyContactsDirectory(
  relays?: string[],
): Promise<Contact[] | null> {
  const pair = await loadNostrKeyPairForCrypto();
  if (!pair) return null;

  const urls = await resolveRelays(relays);
  const dTag = deriveContactsDTag(pair.sk);
  const pool = new SimplePool();

  try {
    const events = await pool.querySync(urls, {
      kinds: [CONTACTS_EVENT_KIND],
      authors: [pair.pubkey],
      "#d": [dTag],
      limit: 1,
    });
    const event = events.sort((a, b) => b.created_at - a.created_at)[0];
    if (!event) return null;

    const payload = decryptPayload(pair.sk, pair.pubkey, event.content);
    const remote = payload.contacts
      .map(sanitizeContact)
      .filter((c): c is Contact => c != null);
    const local = listContacts();
    if (maxUpdatedAt(remote) < maxUpdatedAt(local)) {
      // Local ahead — push
      queuePublishContactsDirectory("local-ahead");
      return null;
    }
    if (
      maxUpdatedAt(remote) === maxUpdatedAt(local) &&
      remote.length === local.length
    ) {
      return null;
    }
    replaceAllContacts(remote);
    return remote;
  } catch (e) {
    console.warn("[basic] contacts directory fetch failed", e);
    return null;
  } finally {
    pool.close(urls);
  }
}

/** Boot helper: pull then publish if we have local data and identity. */
export function queueContactsDirectoryBootSync(): void {
  void (async () => {
    try {
      await ensureNostrIdentity();
      await fetchAndApplyContactsDirectory();
      if (listContacts().length) {
        await publishContactsDirectory();
      }
    } catch (e) {
      console.warn("[basic] contacts boot sync", e);
    }
  })();
}
