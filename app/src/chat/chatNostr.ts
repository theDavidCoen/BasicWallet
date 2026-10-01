/**
 * Publish Pay in Chat payloads as NIP-17 gift wraps (kind 1059).
 */

import { SimplePool } from "nostr-tools/pool";
import { wrapEvent } from "nostr-tools/nip17";
import { mergeNostrRelays, readBackupMeta } from "../nostr/backupPackage";
import {
  hasNostrIdentity,
  loadNostrKeyPairForCrypto,
} from "../nostr/identityStore";
import type { ChatEnvelope } from "./types";

export const CHAT_GIFT_WRAP_KIND = 1059;

async function resolveRelays(extra?: string[]): Promise<string[]> {
  if (extra?.length) return mergeNostrRelays(extra);
  const meta = await readBackupMeta();
  return mergeNostrRelays(meta?.relays);
}

export type PublishChatResult = {
  okRelays: string[];
  failedRelays: { url: string; error: string }[];
  eventId: string;
};

export async function publishChatEnvelope(
  recipientPubkeyHex: string,
  envelope: ChatEnvelope,
  opts?: { relays?: string[] },
): Promise<PublishChatResult> {
  if (!(await hasNostrIdentity())) {
    throw new Error("Create a Nostr identity before using Chat & Pay.");
  }
  const pair = await loadNostrKeyPairForCrypto();
  if (!pair) throw new Error("No Nostr identity");

  const recipient = recipientPubkeyHex.toLowerCase();
  if (recipient === pair.pubkey.toLowerCase()) {
    throw new Error("Cannot message yourself.");
  }

  const wrap = wrapEvent(pair.sk, { publicKey: recipient }, JSON.stringify(envelope));
  const urls = await resolveRelays(opts?.relays);
  const pool = new SimplePool();
  const okRelays: string[] = [];
  const failedRelays: { url: string; error: string }[] = [];

  try {
    const pubs = pool.publish(urls, wrap);
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
        ? `Publish failed: ${failedRelays[0].error}`
        : "Publish failed on all relays",
    );
  }

  return { okRelays, failedRelays, eventId: wrap.id };
}
