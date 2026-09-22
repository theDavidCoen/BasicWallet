/**
 * Publish / fetch Path C backup on Nostr relays.
 *
 * Layers (both required for privacy + restore policy):
 * 1. Inner AEAD: salt+iv+ciphertext from KDF(nsec, passphrase) — nsec alone cannot unwrap seeds.
 * 2. Outer NIP-44 self-encrypt of that blob envelope — event `content` is never plaintext JSON,
 *    seeds, labels, or wallet metadata.
 *
 * Kind 30078 (NIP-78 addressable). The `d` tag is opaque hex derived from the nsec
 * (not a public Basic string) so relays/observers cannot fingerprint the app from tags.
 * No `client` tag.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { finalizeEvent, type EventTemplate } from "nostr-tools/pure";
import { SimplePool } from "nostr-tools/pool";
import { v2 as nip44 } from "nostr-tools/nip44";
import {
  DEFAULT_NOSTR_RELAYS,
  readBackupMeta,
  readCipherBlob,
  type BackupPackageMeta,
  type CipherBlob,
} from "./backupPackage";
import { loadNostrKeyPairForCrypto } from "./identityStore";

export const BACKUP_EVENT_KIND = 30078;

/** Domain separator for d-tag — never published; only mixed with sk. */
const BACKUP_D_DOMAIN = "basic.wallet.backup.d.v1";

/**
 * Opaque addressable `d` for this identity.
 * Requires secret key — pubkey-only observers cannot compute or filter it.
 */
export function deriveBackupDTag(sk: Uint8Array): string {
  if (sk.length !== 32) throw new Error("Invalid secret key");
  const domain = utf8ToBytes(BACKUP_D_DOMAIN);
  const material = new Uint8Array(sk.length + domain.length);
  material.set(sk, 0);
  material.set(domain, sk.length);
  return bytesToHex(sha256(material));
}

export type { CipherBlob } from "./backupPackage";

/** Outer envelope only — no seeds, labels, or wallet list. (Inside NIP-44 only.) */
export type BackupRelayEnvelope = {
  v: 1;
  format: "basic.wallet.aead.v1";
  blob: CipherBlob;
};

export type PublishBackupResult = {
  okRelays: string[];
  failedRelays: { url: string; error: string }[];
  eventId: string;
};

function assertCipherBlob(blob: unknown): CipherBlob {
  if (!blob || typeof blob !== "object") throw new Error("Invalid cipher blob");
  const b = blob as Record<string, unknown>;
  if (
    typeof b.saltHex !== "string" ||
    typeof b.ivHex !== "string" ||
    typeof b.ciphertextHex !== "string"
  ) {
    throw new Error("Invalid cipher blob fields");
  }
  if ("wallets" in b || "mnemonic" in b || "txMeta" in b) {
    throw new Error("Refusing to publish plaintext wallet package");
  }
  const out: CipherBlob = {
    saltHex: b.saltHex,
    ivHex: b.ivHex,
    ciphertextHex: b.ciphertextHex,
  };
  if (typeof b.iters === "number" && b.iters > 0) {
    out.iters = b.iters;
  }
  return out;
}

function buildEncryptedContent(sk: Uint8Array, pubkey: string, blob: CipherBlob): string {
  const envelope: BackupRelayEnvelope = {
    v: 1,
    format: "basic.wallet.aead.v1",
    blob: assertCipherBlob(blob),
  };
  const conversationKey = nip44.utils.getConversationKey(sk, pubkey);
  return nip44.encrypt(JSON.stringify(envelope), conversationKey);
}

function decryptEnvelope(sk: Uint8Array, pubkey: string, content: string): BackupRelayEnvelope {
  const conversationKey = nip44.utils.getConversationKey(sk, pubkey);
  const text = nip44.decrypt(content, conversationKey);
  const parsed = JSON.parse(text) as BackupRelayEnvelope;
  if (parsed.v !== 1 || parsed.format !== "basic.wallet.aead.v1") {
    throw new Error("Unsupported backup envelope");
  }
  assertCipherBlob(parsed.blob);
  return parsed;
}

/**
 * Publish the local passphrase-wrapped AEAD blob to relays, NIP-44 wrapped.
 * Never accepts or publishes decrypted wallet JSON.
 */
export async function publishEncryptedBackupToRelays(
  relays?: string[],
): Promise<PublishBackupResult> {
  const pair = await loadNostrKeyPairForCrypto();
  if (!pair) throw new Error("No Nostr identity");

  const blob = await readCipherBlob();
  if (!blob) throw new Error("No local encrypted package — enable backup first");

  const meta = await readBackupMeta();
  const urls =
    relays?.length ? relays : meta?.relays?.length ? meta.relays : DEFAULT_NOSTR_RELAYS;

  const content = buildEncryptedContent(pair.sk, pair.pubkey, blob);
  if (!content || content.trimStart().startsWith("{") || content.trimStart().startsWith("[")) {
    throw new Error("Refusing to publish non-encrypted content");
  }

  const dTag = deriveBackupDTag(pair.sk);
  const template: EventTemplate = {
    kind: BACKUP_EVENT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    // Only opaque d — no client/app name tags (fingerprint).
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
        ? `Publish failed: ${failedRelays[0].error}`
        : "Publish failed on all relays",
    );
  }

  return { okRelays, failedRelays, eventId: event.id };
}

/**
 * Fetch latest addressable backup for this pubkey; return inner AEAD blob only.
 * Queries relays one-by-one so a single "connection abort" does not drop the rest.
 */
export async function fetchEncryptedBackupFromRelays(
  relays?: string[],
): Promise<CipherBlob | null> {
  const pair = await loadNostrKeyPairForCrypto();
  if (!pair) throw new Error("No Nostr identity");

  const meta = await readBackupMeta();
  const urls =
    relays?.length ? relays : meta?.relays?.length ? meta.relays : DEFAULT_NOSTR_RELAYS;

  const dTag = deriveBackupDTag(pair.sk);
  // Opaque d first; legacy clear d only for early test publishes.
  const dCandidates = [dTag, "basic.wallet.backup.v1"];
  const filter = {
    kinds: [BACKUP_EVENT_KIND],
    authors: [pair.pubkey],
    "#d": dCandidates,
    limit: 8,
  };

  const pool = new SimplePool();
  const byId = new Map<string, { created_at: number; pubkey: string; content: string }>();
  try {
    for (const url of urls) {
      try {
        const events = await pool.querySync([url], filter);
        for (const ev of events) {
          const prev = byId.get(ev.id);
          if (!prev || ev.created_at >= prev.created_at) {
            byId.set(ev.id, {
              created_at: ev.created_at,
              pubkey: ev.pubkey,
              content: ev.content,
            });
          }
        }
      } catch (e) {
        console.warn("[basic] backup fetch relay failed", url, e);
      }
    }

    const events = [...byId.values()].sort((a, b) => b.created_at - a.created_at);
    if (!events.length) return null;

    for (const ev of events) {
      try {
        if (ev.pubkey !== pair.pubkey) continue;
        if (ev.content.trimStart().startsWith("{")) {
          console.warn("[basic] rejecting plaintext Nostr backup content");
          continue;
        }
        const envelope = decryptEnvelope(pair.sk, pair.pubkey, ev.content);
        return envelope.blob;
      } catch (e) {
        console.warn("[basic] skip undecryptable backup event", e);
      }
    }
    return null;
  } finally {
    pool.close(urls);
  }
}

export async function rememberPublishMeta(
  meta: BackupPackageMeta,
  result: PublishBackupResult,
): Promise<BackupPackageMeta> {
  const { writeBackupMeta } = await import("./backupPackage");
  const next: BackupPackageMeta = {
    ...meta,
    updatedAt: Date.now(),
    lastPublishedAt: Date.now(),
    lastPublishOk: result.okRelays.length,
    lastPublishFail: result.failedRelays.length,
  };
  await writeBackupMeta(next);
  return next;
}
