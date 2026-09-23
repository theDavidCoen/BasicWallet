/**
 * Passkey label directory on Nostr (active + archived index→label).
 * Always-on for passkey installs — no Path C passphrase gate.
 * NIP-44 self-encrypt + kind 30078 with a distinct opaque d-tag.
 * Never publishes mnemonics or seeds.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { finalizeEvent, type EventTemplate } from "nostr-tools/pure";
import { SimplePool } from "nostr-tools/pool";
import { v2 as nip44 } from "nostr-tools/nip44";
import {
  type PasskeyChildEntry,
  type PasskeyChildIndexMap,
  readPasskeyChildIndexMap,
  writePasskeyChildIndexMap,
} from "../onboarding/passkeyChildIndexMap";
import { isPersonalLabel, normalizeWalletLabel } from "../onboarding/passkeyChildWallets";
import { DEFAULT_NOSTR_RELAYS, readBackupMeta } from "./backupPackage";
import { loadNostrKeyPairForCrypto } from "./identityStore";

export const LABEL_DIRECTORY_EVENT_KIND = 30078;

const LABELS_D_DOMAIN = "basic.wallet.labels.d.v1";

export type LabelDirectoryPayload = {
  v: 1;
  entries: { index: number; label: string; status: "active" | "archived" }[];
};

export function deriveLabelsDTag(sk: Uint8Array): string {
  if (sk.length !== 32) throw new Error("Invalid secret key");
  const domain = utf8ToBytes(LABELS_D_DOMAIN);
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

function mapToPayload(map: PasskeyChildIndexMap): LabelDirectoryPayload {
  return {
    v: 1,
    entries: map.entries.map((e) => ({
      index: e.index,
      label: e.label,
      status: e.status,
    })),
  };
}

function payloadToMap(payload: LabelDirectoryPayload): PasskeyChildIndexMap {
  const entries: PasskeyChildEntry[] = [];
  const seen = new Set<number>();
  for (const raw of payload.entries) {
    if (!Number.isInteger(raw.index) || raw.index < 0) continue;
    if (seen.has(raw.index)) continue;
    const label = normalizeWalletLabel(raw.label);
    if (!label || isPersonalLabel(label)) continue;
    const status = raw.status === "archived" ? "archived" : "active";
    seen.add(raw.index);
    entries.push({ index: raw.index, label, status });
  }
  entries.sort((a, b) => a.index - b.index);
  const maxIdx = entries.reduce((m, e) => Math.max(m, e.index), -1);
  return { version: 1, nextIndex: maxIdx + 1, entries };
}

function encryptPayload(sk: Uint8Array, pubkey: string, payload: LabelDirectoryPayload): string {
  const conversationKey = nip44.utils.getConversationKey(sk, pubkey);
  return nip44.encrypt(JSON.stringify(payload), conversationKey);
}

function decryptPayload(sk: Uint8Array, pubkey: string, content: string): LabelDirectoryPayload {
  const conversationKey = nip44.utils.getConversationKey(sk, pubkey);
  const text = nip44.decrypt(content, conversationKey);
  const parsed = JSON.parse(text) as LabelDirectoryPayload;
  if (parsed.v !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error("Unsupported label directory payload");
  }
  if ("mnemonic" in (parsed as object) || "wallets" in (parsed as object)) {
    throw new Error("Refusing label directory that looks like a wallet package");
  }
  return parsed;
}

export type PublishLabelDirectoryResult = {
  okRelays: string[];
  failedRelays: { url: string; error: string }[];
  eventId: string;
};

/** Publish current local index map (labels + archive status). */
export async function publishLabelDirectory(
  relays?: string[],
): Promise<PublishLabelDirectoryResult> {
  const pair = await loadNostrKeyPairForCrypto();
  if (!pair) throw new Error("No Nostr identity");

  const map = await readPasskeyChildIndexMap();
  const payload = mapToPayload(map);
  const content = encryptPayload(pair.sk, pair.pubkey, payload);
  if (!content || content.trimStart().startsWith("{")) {
    throw new Error("Refusing to publish non-encrypted label directory");
  }

  const urls = await resolveRelays(relays);
  const dTag = deriveLabelsDTag(pair.sk);
  const template: EventTemplate = {
    kind: LABEL_DIRECTORY_EVENT_KIND,
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
        ? `Label directory publish failed: ${failedRelays[0].error}`
        : "Label directory publish failed on all relays",
    );
  }

  return { okRelays, failedRelays, eventId: event.id };
}

/** Fire-and-forget publish; logs failures. */
export function queuePublishLabelDirectory(reason: string): void {
  void publishLabelDirectory().catch((e) => {
    console.warn("[basic] label directory publish failed", reason, e);
  });
}

/**
 * Fetch latest label directory for this identity and replace the local map.
 * Returns null if none found / undecryptable.
 */
export async function fetchAndApplyLabelDirectory(
  relays?: string[],
): Promise<PasskeyChildIndexMap | null> {
  const pair = await loadNostrKeyPairForCrypto();
  if (!pair) throw new Error("No Nostr identity");

  const urls = await resolveRelays(relays);
  const dTag = deriveLabelsDTag(pair.sk);
  const filter = {
    kinds: [LABEL_DIRECTORY_EVENT_KIND],
    authors: [pair.pubkey],
    "#d": [dTag],
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
        console.warn("[basic] label directory fetch relay failed", url, e);
      }
    }

    const events = [...byId.values()].sort((a, b) => b.created_at - a.created_at);
    for (const ev of events) {
      try {
        if (ev.pubkey !== pair.pubkey) continue;
        if (ev.content.trimStart().startsWith("{")) continue;
        const payload = decryptPayload(pair.sk, pair.pubkey, ev.content);
        const map = payloadToMap(payload);
        await writePasskeyChildIndexMap(map);
        return map;
      } catch (e) {
        console.warn("[basic] skip undecryptable label directory event", e);
      }
    }
    return null;
  } finally {
    pool.close(urls);
  }
}
