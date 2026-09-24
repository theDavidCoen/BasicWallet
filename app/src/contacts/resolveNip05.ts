/**
 * NIP-05 resolve: GET https://domain/.well-known/nostr.json?name=local
 */

import { npubEncode } from "nostr-tools/nip19";
import type { ResolvedHint } from "./types";

const NIP05_RE = /^([a-z0-9._-]+)@([a-z0-9.-]+\.[a-z]{2,})$/i;

export type Nip05ResolveOk = {
  ok: true;
  pubkeyHex: string;
  npub: string;
  relays?: string[];
  /** Optional lud16 / lightning if present on the JSON (non-standard but common). */
  lud16?: string;
  hint: ResolvedHint;
};

export type Nip05ResolveErr = {
  ok: false;
  message: string;
};

export type Nip05ResolveResult = Nip05ResolveOk | Nip05ResolveErr;

function isHexPubkey(s: string): boolean {
  return /^[0-9a-f]{64}$/i.test(s);
}

export async function resolveNip05(
  raw: string,
  signal?: AbortSignal,
): Promise<Nip05ResolveResult> {
  const t = raw.trim().replace(/^₿/, "");
  const m = t.match(NIP05_RE);
  if (!m) {
    return { ok: false, message: "NIP-05 must look like name@domain." };
  }
  const local = m[1]!.toLowerCase();
  const domain = m[2]!.toLowerCase();
  const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(local)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "BasicWallet/0.1 (NIP-05; +https://davidcoen.it)",
      },
    });
  } catch (e) {
    if (signal?.aborted) {
      return { ok: false, message: "NIP-05 lookup cancelled." };
    }
    return {
      ok: false,
      message: `Could not reach ${domain} for NIP-05 (${e instanceof Error ? e.message : String(e)}).`,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      message: `NIP-05 lookup failed (${res.status}). Check the name@domain.`,
    };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return {
      ok: false,
      message: "NIP-05 response was not valid JSON (incompatible format).",
    };
  }

  if (!json || typeof json !== "object") {
    return {
      ok: false,
      message: "NIP-05 response format is incompatible.",
    };
  }

  const names = (json as { names?: Record<string, string> }).names;
  if (!names || typeof names !== "object") {
    return {
      ok: false,
      message: "NIP-05 JSON has no names map (incompatible format).",
    };
  }

  const pubkey =
    names[local] ??
    names[m[1]!] ??
    Object.entries(names).find(([k]) => k.toLowerCase() === local)?.[1];

  if (typeof pubkey !== "string" || !isHexPubkey(pubkey)) {
    return {
      ok: false,
      message: `No NIP-05 entry for “${local}” on ${domain}, or pubkey is invalid.`,
    };
  }

  const pubkeyHex = pubkey.toLowerCase();
  let npub: string;
  try {
    npub = npubEncode(pubkeyHex);
  } catch {
    return { ok: false, message: "NIP-05 pubkey could not be encoded as npub." };
  }

  const relaysRaw = (json as { relays?: Record<string, string[]> }).relays;
  const relays =
    relaysRaw && typeof relaysRaw === "object" && Array.isArray(relaysRaw[pubkeyHex])
      ? relaysRaw[pubkeyHex]
      : undefined;

  // Some hosts put lud16 next to names (non-NIP); surface as optional hint only.
  const extras = json as { lud16?: string; lightning?: string };
  const lud16 =
    typeof extras.lud16 === "string"
      ? extras.lud16
      : typeof extras.lightning === "string"
        ? extras.lightning
        : undefined;

  return {
    ok: true,
    pubkeyHex,
    npub,
    relays,
    lud16,
    hint: {
      at: Date.now(),
      kind: "npub",
      value: npub,
      note: lud16 ? `lud16 ${lud16}` : undefined,
    },
  };
}

/**
 * Whether a NIP-05 result can be used as a *payment* destination for the current mode.
 * Identity-only (npub) is not payable on Arkade/LN send in v1.
 */
export function nip05PayableMessage(mode: "arkade" | "lightning"): string {
  if (mode === "lightning") {
    return "NIP-05 resolved to a Nostr identity, not a Lightning payment address. Add an LN Address, BIP353, or LNURL to this contact — or use a NIP-05 that also exposes lud16.";
  }
  return "NIP-05 resolved to a Nostr identity, not a payment address. Add an Ark, Lightning Address, or BIP353 identifier to this contact.";
}
