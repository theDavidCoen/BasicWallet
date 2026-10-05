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
import { HOME_RELAY_HINT } from "../notifications/config";
import type { ChatEnvelope } from "./types";

export const CHAT_GIFT_WRAP_KIND = 1059;

/**
 * Relays for chat gift-wraps. Always include the home relay first so the
 * closed-app push sidecar (watching wss://relay.davidcoen.it) sees kind 1059.
 */
async function resolveRelays(extra?: string[]): Promise<string[]> {
  const meta = await readBackupMeta();
  const merged = mergeNostrRelays([
    HOME_RELAY_HINT,
    ...(extra ?? []),
    ...(meta?.relays ?? []),
  ]);
  if (!merged.some((u) => u.toLowerCase().includes("relay.davidcoen.it"))) {
    return mergeNostrRelays([HOME_RELAY_HINT, ...merged]);
  }
  // Home first for publish race (α72 first-success).
  const home = merged.find((u) => u.toLowerCase().includes("relay.davidcoen.it"));
  if (!home) return merged;
  return [home, ...merged.filter((u) => u !== home)];
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
  const homeUrl =
    urls.find((u) => u.toLowerCase().includes("relay.davidcoen.it")) ?? HOME_RELAY_HINT;
  const pool = new SimplePool();
  const okRelays: string[] = [];
  const failedRelays: { url: string; error: string }[] = [];

  try {
    // Closed-app push watches home only. Require home OK before treating as sent;
    // α72 first-success on public relays left the sidecar blind (2026-10-05 QA).
    const homePubs = pool.publish([homeUrl], wrap);
    const homeSettled = await Promise.allSettled(homePubs);
    const homeOk = homeSettled.some((r) => r.status === "fulfilled");
    if (homeOk) {
      okRelays.push(homeUrl);
    } else {
      const err = homeSettled.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      failedRelays.push({
        url: homeUrl,
        error: err?.reason instanceof Error ? err.reason.message : String(err?.reason ?? "home rejected"),
      });
      throw new Error(
        `Publish failed on home relay (${homeUrl}): ${failedRelays[0]?.error ?? "unknown"}`,
      );
    }

    // Fan-out to the rest (best-effort); do not block UX on public relays.
    const rest = urls.filter((u) => u !== homeUrl);
    if (rest.length) {
      const restPubs = pool.publish(rest, wrap);
      const restSettled = await Promise.allSettled(restPubs);
      restSettled.forEach((r, i) => {
        const url = rest[i]!;
        if (r.status === "fulfilled") {
          if (!okRelays.includes(url)) okRelays.push(url);
        } else {
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

  console.warn("[basic] chat publish ok", {
    eventId: wrap.id.slice(0, 16),
    okRelays,
    failedRelays: failedRelays.map((f) => f.url),
  });

  return { okRelays, failedRelays, eventId: wrap.id };
}
