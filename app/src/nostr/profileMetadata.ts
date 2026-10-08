/**
 * NIP-01 kind 0 metadata publish + fetch (public profile).
 * Save profile must broadcast the full Identity edit buffer, not local-only.
 * Contact-local notes / custom fields stay private (Path C / device only).
 */

import { finalizeEvent, type Event, type EventTemplate } from "nostr-tools/pure";
import { SimplePool } from "nostr-tools/pool";
import { decode } from "nostr-tools/nip19";
import {
  DEFAULT_NOSTR_RELAYS,
  mergeNostrRelays,
  readBackupMeta,
} from "./backupPackage";
import {
  EMPTY_PROFILE,
  loadNostrKeyPairForCrypto,
  type NostrProfile,
  writeNostrProfile,
} from "./identityStore";
import type { Contact, ContactIdentifier } from "../contacts/types";
import { newContactId } from "../contacts/types";

export const PROFILE_EVENT_KIND = 0;

/** Identifier label for fields learned from kind 0 (not private notes). */
export const NOSTR_PROFILE_LABEL = "From Nostr profile";

export type PublishProfileResult = {
  okRelays: string[];
  failedRelays: { url: string; error: string }[];
  eventId: string;
};

/** Full public metadata pulled from kind 0 (mirrors Identity Save fields). */
export type FetchedNostrMetadata = NostrProfile & {
  createdAt: number;
  eventId: string;
};

async function resolveRelays(relays?: string[]): Promise<string[]> {
  if (relays?.length) return mergeNostrRelays(relays);
  const meta = await readBackupMeta();
  return mergeNostrRelays(meta?.relays ?? DEFAULT_NOSTR_RELAYS);
}

/**
 * NIP-01 metadata JSON from the full Identity profile buffer.
 * Omit empty strings so a Save that clears a field drops it from the replaceable event.
 */
export function profileToMetadataContent(profile: NostrProfile): string {
  const name = profile.displayName.trim();
  const nip05 = profile.nip05.trim();
  const lud16 = profile.lightningAddress.trim();
  const about = profile.about.trim();
  const picture = profile.picture.trim();
  const website = profile.website.trim();
  const body: Record<string, string> = {};
  if (name) {
    body.name = name;
    body.display_name = name;
  }
  if (about) body.about = about;
  if (picture) body.picture = picture;
  if (nip05) body.nip05 = nip05;
  if (lud16) body.lud16 = lud16;
  if (website) body.website = website;
  return JSON.stringify(body);
}

export function metadataContentToProfile(content: string): NostrProfile {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return { ...EMPTY_PROFILE };
  }
  const displayName =
    (typeof parsed.display_name === "string" && parsed.display_name.trim()) ||
    (typeof parsed.name === "string" && parsed.name.trim()) ||
    "";
  return {
    displayName,
    nip05: typeof parsed.nip05 === "string" ? parsed.nip05.trim() : "",
    lightningAddress:
      (typeof parsed.lud16 === "string" && parsed.lud16.trim()) ||
      (typeof parsed.lud06 === "string" && parsed.lud06.trim()) ||
      "",
    about: typeof parsed.about === "string" ? parsed.about.trim() : "",
    picture: typeof parsed.picture === "string" ? parsed.picture.trim() : "",
    website: typeof parsed.website === "string" ? parsed.website.trim() : "",
  };
}

/**
 * Persist locally, then publish kind 0 to relays.
 * Local write always happens first so a flaky relay does not lose the edit buffer.
 */
export async function saveAndPublishNostrProfile(
  profile: NostrProfile,
  relays?: string[],
): Promise<PublishProfileResult> {
  await writeNostrProfile(profile);
  return publishNostrProfile(profile, relays);
}

export async function publishNostrProfile(
  profile: NostrProfile,
  relays?: string[],
): Promise<PublishProfileResult> {
  const pair = await loadNostrKeyPairForCrypto();
  if (!pair) throw new Error("No Nostr identity");

  const urls = await resolveRelays(relays);
  const template: EventTemplate = {
    kind: PROFILE_EVENT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: profileToMetadataContent(profile),
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
        ? `Profile publish failed: ${failedRelays[0].error}`
        : "Profile publish failed on all relays",
    );
  }

  return { okRelays, failedRelays, eventId: event.id };
}

/** Hex pubkey from contact npub identifier, or null. */
export function contactNpubPubkeyHex(contact: Contact): string | null {
  for (const id of contact.identifiers) {
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
      if (/^[0-9a-f]{64}$/.test(hex)) return hex;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Fetch latest kind 0 for a pubkey (replaceable: highest created_at wins).
 * Queries relays one-by-one so one abort does not drop the rest.
 */
export async function fetchNostrMetadata(
  pubkeyHex: string,
  relays?: string[],
): Promise<FetchedNostrMetadata | null> {
  const pk = pubkeyHex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk)) throw new Error("Invalid pubkey");

  const urls = await resolveRelays(relays);
  const filter = { kinds: [PROFILE_EVENT_KIND], authors: [pk], limit: 5 };
  const pool = new SimplePool();
  let best: Event | null = null;

  try {
    for (const url of urls) {
      try {
        const events = await pool.querySync([url], filter, { maxWait: 4_000 });
        for (const ev of events) {
          if (ev.kind !== PROFILE_EVENT_KIND) continue;
          if ((ev.pubkey || "").toLowerCase() !== pk) continue;
          if (!best || ev.created_at > best.created_at) best = ev;
        }
      } catch (e) {
        console.warn("[basic] kind0 fetch relay failed", url, e);
      }
    }
  } finally {
    pool.close(urls);
  }

  if (!best) return null;
  const fields = metadataContentToProfile(best.content || "{}");
  return {
    ...fields,
    createdAt: best.created_at,
    eventId: best.id,
  };
}

function upsertTypedIdent(
  identifiers: ContactIdentifier[],
  kind: "lightning_address" | "nip05",
  value: string,
): ContactIdentifier[] {
  const trimmed = value.trim();
  if (!trimmed) return identifiers;

  const profileSourced = identifiers.find(
    (i) => i.kind === kind && i.label === NOSTR_PROFILE_LABEL,
  );
  if (profileSourced) {
    if (profileSourced.value.trim() === trimmed) return identifiers;
    return identifiers.map((i) =>
      i.id === profileSourced.id
        ? { ...i, value: trimmed, label: NOSTR_PROFILE_LABEL }
        : i,
    );
  }

  const sameKind = identifiers.find((i) => i.kind === kind);
  if (sameKind) {
    if (sameKind.value.trim() === trimmed) return identifiers;
    return identifiers.map((i) =>
      i.id === sameKind.id ? { ...i, value: trimmed } : i,
    );
  }

  return [
    ...identifiers,
    {
      id: newContactId("id"),
      kind,
      value: trimmed,
      label: NOSTR_PROFILE_LABEL,
    },
  ];
}

/** Public website / picture as custom identifiers (not private ContactField rows). */
function upsertCustomPublicIdent(
  identifiers: ContactIdentifier[],
  customKindLabel: string,
  value: string,
): ContactIdentifier[] {
  const trimmed = value.trim();
  if (!trimmed) return identifiers;

  const hit = identifiers.find(
    (i) =>
      i.kind === "custom" &&
      i.label === NOSTR_PROFILE_LABEL &&
      (i.customKindLabel || "").trim() === customKindLabel,
  );
  if (hit) {
    if (hit.value.trim() === trimmed) return identifiers;
    return identifiers.map((i) =>
      i.id === hit.id ? { ...i, value: trimmed } : i,
    );
  }

  return [
    ...identifiers,
    {
      id: newContactId("id"),
      kind: "custom",
      value: trimmed,
      label: NOSTR_PROFILE_LABEL,
      customKindLabel,
    },
  ];
}

/**
 * Merge public kind-0 fields into a contact.
 * Never touches `note` or custom `fields` (those stay local / Path C private).
 */
export function applyPublicProfileToContact(
  contact: Contact,
  meta: FetchedNostrMetadata,
): Contact {
  let identifiers = contact.identifiers;
  if (meta.lightningAddress) {
    identifiers = upsertTypedIdent(
      identifiers,
      "lightning_address",
      meta.lightningAddress,
    );
  }
  if (meta.nip05) {
    identifiers = upsertTypedIdent(identifiers, "nip05", meta.nip05);
  }
  if (meta.website) {
    identifiers = upsertCustomPublicIdent(identifiers, "Website", meta.website);
  }
  if (meta.picture) {
    identifiers = upsertCustomPublicIdent(identifiers, "Picture", meta.picture);
  }

  const nextName = meta.displayName.trim();
  const name =
    nextName && nextName !== contact.name.trim() ? nextName : contact.name;

  if (name === contact.name && identifiers === contact.identifiers) {
    return contact;
  }

  return {
    ...contact,
    name,
    identifiers,
    // note + fields + surname intentionally unchanged
    updatedAt: Date.now(),
  };
}
