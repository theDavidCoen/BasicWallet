import type { IdentifierKind } from "./types";
import {
  looksLikeBolt12,
  looksLikeLightningAddress,
  looksLikeLnurlBech32,
} from "../lightning/lnPayResolve";
import { looksLikeBolt11 } from "../lightning/lndhub";

const NPUB_RE = /^npub1[a-z0-9]+$/i;
const NIP05_RE = /^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export function looksLikeArkAddress(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return /^(ark|tark)1[a-z0-9]+$/.test(t);
}

export function looksLikeOnchainAddress(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return /^(bc1|tb1|bcrt1|1|3)[a-z0-9]+$/.test(t) && t.length >= 14;
}

export function looksLikeNpub(raw: string): boolean {
  return NPUB_RE.test(raw.trim());
}

export function looksLikeNip05(raw: string): boolean {
  const t = raw.trim().replace(/^₿/, "");
  return NIP05_RE.test(t);
}

/**
 * BOLT11 / BOLT12 invoices are one-shot — never offer Save to contacts.
 * Also matches truncated UI displays (`lnbc1…abc` from midEllipsis).
 */
export function isOneShotPayInvoice(raw: string): boolean {
  const t = raw.trim().replace(/^lightning:/i, "");
  if (!t) return false;
  if (looksLikeBolt11(t) || looksLikeBolt12(t)) return true;
  if (/^(lnbc|lntb|lnbcrt|lnsb|lntbs)[0-9a-z]*…/i.test(t)) return true;
  if (/^lno1[0-9a-z]*…/i.test(t)) return true;
  return false;
}

/** Reusable destinations only (ark, LNURL, lightning address, … — not bolt11/12). */
export function canOfferSaveToContacts(destination: string): boolean {
  const t = destination.trim();
  if (!t) return false;
  return !isOneShotPayInvoice(t);
}

/**
 * Best-effort kind for paste / save-to-contacts.
 * BIP353 vs LN Address vs NIP-05 share user@domain — caller may override.
 * Default user@domain → lightning_address (most common pay path).
 */
export function detectIdentifierKind(raw: string): IdentifierKind {
  const t = raw.trim();
  if (!t) return "custom";
  if (looksLikeArkAddress(t)) return "ark";
  if (looksLikeNpub(t)) return "npub";
  if (looksLikeBolt11(t) || looksLikeBolt12(t)) return "lnurl";
  if (looksLikeLnurlBech32(t) || (/^https?:\/\//i.test(t) && /lnurl/i.test(t))) {
    return "lnurl";
  }
  if (t.startsWith("₿") && looksLikeLightningAddress(t)) return "bip353";
  if (looksLikeLightningAddress(t) || looksLikeNip05(t)) return "lightning_address";
  if (looksLikeOnchainAddress(t)) return "onchain";
  return "custom";
}
