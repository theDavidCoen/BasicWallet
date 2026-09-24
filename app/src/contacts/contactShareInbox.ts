/**
 * Local inbox for incoming contact-share offers (NIP-17).
 * Pending offers drive the home reminder dialog.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ContactShareMessage, SharedContactPayload } from "./contactShare";

const INBOX_KEY = "basic.wallet.contact.share.inbox.v1";
const SEEN_KEY = "basic.wallet.contact.share.seen.v1";

export type ContactShareOffer = {
  /** Gift-wrap event id (stable). */
  id: string;
  receivedAt: number;
  fromPubkey: string;
  fromNpub: string;
  fromDisplayName?: string;
  contact: SharedContactPayload;
  sharedAt: number;
};

type Listener = () => void;

const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

export function subscribeContactShareInbox(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function readInbox(): Promise<ContactShareOffer[]> {
  try {
    const raw = await AsyncStorage.getItem(INBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isOffer);
  } catch {
    return [];
  }
}

async function writeInbox(offers: ContactShareOffer[]): Promise<void> {
  await AsyncStorage.setItem(INBOX_KEY, JSON.stringify(offers));
  notify();
}

function isOffer(o: unknown): o is ContactShareOffer {
  if (!o || typeof o !== "object") return false;
  const x = o as Partial<ContactShareOffer>;
  return (
    typeof x.id === "string" &&
    typeof x.receivedAt === "number" &&
    typeof x.fromPubkey === "string" &&
    typeof x.fromNpub === "string" &&
    !!x.contact &&
    typeof x.contact === "object" &&
    typeof x.contact.name === "string"
  );
}

async function readSeen(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

async function markSeen(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const seen = await readSeen();
  let changed = false;
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      changed = true;
    }
  }
  if (!changed) return;
  // Cap growth
  const list = [...seen];
  const trimmed = list.length > 400 ? list.slice(list.length - 400) : list;
  await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(trimmed));
}

export async function listPendingContactShares(): Promise<ContactShareOffer[]> {
  const inbox = await readInbox();
  return inbox.sort((a, b) => b.receivedAt - a.receivedAt);
}

export async function getContactShareOffer(id: string): Promise<ContactShareOffer | null> {
  const inbox = await readInbox();
  return inbox.find((o) => o.id === id) ?? null;
}

export async function hasPendingContactShares(): Promise<boolean> {
  const inbox = await readInbox();
  return inbox.length > 0;
}

/**
 * Add offer if wrap id not already seen (avoids re-prompting after dismiss).
 * Returns true when newly added.
 */
export async function enqueueContactShareOffer(
  wrapEventId: string,
  message: ContactShareMessage,
): Promise<boolean> {
  const seen = await readSeen();
  if (seen.has(wrapEventId)) return false;

  const inbox = await readInbox();
  if (inbox.some((o) => o.id === wrapEventId)) {
    await markSeen([wrapEventId]);
    return false;
  }

  const offer: ContactShareOffer = {
    id: wrapEventId,
    receivedAt: Date.now(),
    fromPubkey: message.from.pubkey,
    fromNpub: message.from.npub,
    fromDisplayName: message.from.displayName,
    contact: message.contact,
    sharedAt: message.sharedAt,
  };
  await writeInbox([offer, ...inbox]);
  await markSeen([wrapEventId]);
  return true;
}

/** Remove from inbox (X dismiss, add, or ignore). Keeps wrap id in seen set. */
export async function dismissContactShareOffer(id: string): Promise<void> {
  const inbox = await readInbox();
  const next = inbox.filter((o) => o.id !== id);
  if (next.length === inbox.length) return;
  await writeInbox(next);
  await markSeen([id]);
}

export async function clearAllContactShareOffers(): Promise<void> {
  await writeInbox([]);
}
