/**
 * Resolve Lightning pay destinations to a BOLT11 invoice.
 *
 * Supported:
 * - BOLT11 (passthrough)
 * - LNURL-pay (bech32 lnurl1… / lightning:LNURL… / https URL)
 * - Lightning Address (user@domain → LNURL-pay)
 * - BIP353 (₿user@domain / user@domain via DNS TXT → bolt11 or offer)
 *
 * BOLT12 offers (lno1…): detected; paid only when a BOLT11 can be obtained
 * (e.g. BIP353 also advertises lightning=). Raw offer pay needs node support
 * LNDHub/LNbits does not expose yet.
 */

import { bech32 } from "@scure/base";
import { looksLikeBolt11, normalizeBolt11, parseBolt11AmountSats } from "./lndhub";

export type LnPayKind =
  | "bolt11"
  | "lnurl"
  | "lightning-address"
  | "bip353"
  | "bolt12";

export type LnPayProbe = {
  kind: LnPayKind;
  /** Human label for UI (address, truncated invoice, …). */
  display: string;
  /** Fixed amount when known (invoice or LNURL min===max). */
  amountSats: number | null;
  minSats?: number;
  maxSats?: number;
  description?: string;
  /** True when the user must enter an amount before pay. */
  needsAmount: boolean;
  /** Raw BOLT11 when already available (no network resolve needed). */
  bolt11?: string;
  /** Raw BOLT12 offer when that is all we have. */
  bolt12?: string;
  /** Cached LNURL-pay callback URL (after first fetch). */
  callback?: string;
  commentAllowed?: number;
};

export type LnPayResolved = {
  kind: LnPayKind;
  bolt11: string;
  amountSats: number;
  description?: string;
  display: string;
};

const LN_ADDRESS_RE = /^([a-zA-Z0-9._+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/;
const BIP353_RE = /^₿?([a-zA-Z0-9._+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/;

export function looksLikeBolt12(raw: string): boolean {
  const t = stripLightningScheme(raw).toLowerCase();
  return t.startsWith("lno1");
}

export function looksLikeLnurlBech32(raw: string): boolean {
  const t = stripLightningScheme(raw).toLowerCase();
  return t.startsWith("lnurl1");
}

export function looksLikeLightningAddress(raw: string): boolean {
  const t = raw.trim().replace(/^₿/, "");
  return LN_ADDRESS_RE.test(t);
}

/** Anything we can attempt to pay (or probe) on the Lightning send path. */
export function looksLikeLightningPayInput(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (looksLikeBolt11(t)) return true;
  if (looksLikeBolt12(t)) return true;
  if (looksLikeLnurlBech32(t)) return true;
  if (looksLikeLightningAddress(t)) return true;
  if (/^https?:\/\//i.test(t) && /lnurl/i.test(t)) return true;
  return false;
}

function stripLightningScheme(raw: string): string {
  let t = raw.trim();
  if (/^lightning:/i.test(t)) {
    t = t.replace(/^lightning:/i, "");
    // Keep query for BIP21-style; for plain lnurl/bolt11 strip ? only if not http
  }
  return t.trim();
}

function decodeLnurlBech32(raw: string): string {
  const t = stripLightningScheme(raw).toLowerCase();
  // @scure/base types require a bech32-shaped template string.
  const decoded = bech32.decode(t as `${string}1${string}`, 2500);
  if (decoded.prefix !== "lnurl") {
    throw new Error("Not an LNURL");
  }
  const bytes = bech32.fromWords(decoded.words);
  return new TextDecoder().decode(bytes);
}

const FETCH_HEADERS: Record<string, string> = {
  Accept: "application/json",
  // Apache on many hosts (incl. davidcoen.it) returns 403 for OkHttp’s default UA.
  "User-Agent": "BasicWallet/0.1 (Lightning Address; +https://davidcoen.it)",
};

/** Per-request cap so LNURL / Lightning Address cannot hang Send. */
export const LNURL_FETCH_TIMEOUT_MS = 8_000;

const LNURL_TIMEOUT_MESSAGE =
  "Lightning Address / LNURL timed out. Check the destination and try again.";

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  const msg = err instanceof Error ? err.message : String(err);
  return name === "AbortError" || /aborted|timed out/i.test(msg);
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const ac = new AbortController();
  const parent = init?.signal;
  const onParentAbort = () => ac.abort();
  if (parent) {
    if (parent.aborted) ac.abort();
    else parent.addEventListener("abort", onParentAbort, { once: true });
  }
  const timer = setTimeout(() => ac.abort(), LNURL_FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: ac.signal,
      redirect: "follow",
      headers: {
        ...FETCH_HEADERS,
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
  } catch (e) {
    if (isAbortError(e)) throw new Error(LNURL_TIMEOUT_MESSAGE);
    throw e;
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", onParentAbort);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* */
  }
  if (!res.ok) {
    throw new Error(friendlyHttpError(res.status, text, json));
  }
  // Some servers return 200 HTML on soft-block; reject non-JSON.
  if (json == null && text.trim().startsWith("<")) {
    throw new Error(friendlyHttpError(res.status || 200, text, null));
  }
  return json;
}

function friendlyHttpError(
  status: number,
  text: string,
  json: unknown,
): string {
  if (json && typeof json === "object") {
    const o = json as { reason?: unknown; detail?: unknown; message?: unknown };
    const msg = [o.reason, o.detail, o.message].find(
      (v) => typeof v === "string" && v.trim(),
    );
    if (typeof msg === "string") return msg;
  }
  const stripped = text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  if (/forbidden/i.test(stripped) || status === 403) {
    return `Lightning Address endpoint returned 403 (blocked). Check .well-known/lnurlp on the domain.`;
  }
  if (/not found/i.test(stripped) || status === 404) {
    return `No LNURL-pay endpoint for this address (HTTP 404).`;
  }
  if (status === 301 || status === 302 || /moved permanently/i.test(stripped)) {
    return `LNURL redirected (HTTP ${status}) but the client could not follow it.`;
  }
  if (stripped && !/^<!DOCTYPE/i.test(text.trim()) && !/^<html/i.test(text.trim())) {
    return stripped;
  }
  return `LNURL request failed (HTTP ${status || "?"}).`;
}

type LnurlPayRequest = {
  callback: string;
  minSendable: number;
  maxSendable: number;
  metadata: string;
  commentAllowed?: number;
  tag?: string;
};

function parseLnurlMetadata(metadata: string): string | undefined {
  try {
    const arr = JSON.parse(metadata) as unknown;
    if (!Array.isArray(arr)) return undefined;
    for (const item of arr) {
      if (
        Array.isArray(item) &&
        item[0] === "text/plain" &&
        typeof item[1] === "string"
      ) {
        return item[1];
      }
    }
  } catch {
    /* */
  }
  return undefined;
}

async function fetchLnurlPayRequest(url: string): Promise<LnurlPayRequest> {
  const raw = (await fetchJson(url)) as Record<string, unknown>;
  if (raw.status === "ERROR") {
    throw new Error(
      typeof raw.reason === "string" ? raw.reason : "LNURL error",
    );
  }
  if (raw.tag != null && raw.tag !== "payRequest") {
    throw new Error(`LNURL tag "${String(raw.tag)}" is not payRequest`);
  }
  const callback = typeof raw.callback === "string" ? raw.callback : "";
  const minSendable = Number(raw.minSendable);
  const maxSendable = Number(raw.maxSendable);
  if (!callback || !Number.isFinite(minSendable) || !Number.isFinite(maxSendable)) {
    throw new Error("Invalid LNURL-pay response");
  }
  return {
    callback,
    minSendable,
    maxSendable,
    metadata: typeof raw.metadata === "string" ? raw.metadata : "[]",
    commentAllowed:
      typeof raw.commentAllowed === "number" ? raw.commentAllowed : undefined,
    tag: typeof raw.tag === "string" ? raw.tag : undefined,
  };
}

async function lnurlPayInvoice(
  callback: string,
  amountSats: number,
): Promise<string> {
  const msats = Math.floor(amountSats) * 1000;
  const u = new URL(callback);
  u.searchParams.set("amount", String(msats));
  const raw = (await fetchJson(u.toString())) as Record<string, unknown>;
  if (raw.status === "ERROR") {
    throw new Error(
      typeof raw.reason === "string" ? raw.reason : "LNURL pay failed",
    );
  }
  const pr =
    (typeof raw.pr === "string" && raw.pr) ||
    (typeof raw.payment_request === "string" && raw.payment_request) ||
    "";
  if (!pr || !looksLikeBolt11(pr)) {
    throw new Error("LNURL did not return a BOLT11 invoice");
  }
  return normalizeBolt11(pr);
}

function lightningAddressToLnurlp(addr: string): string {
  const m = addr.trim().replace(/^₿/, "").match(LN_ADDRESS_RE);
  if (!m) throw new Error("Invalid Lightning Address");
  const user = encodeURIComponent(m[1]!);
  const domain = m[2]!;
  return `https://${domain}/.well-known/lnurlp/${user}`;
}

/** BIP353 DNS name: user.user._bitcoin-payment.domain */
function bip353DnsName(user: string, domain: string): string {
  return `${user}.user._bitcoin-payment.${domain}`;
}

type Bip353Payment = {
  bolt11?: string;
  bolt12?: string;
  raw: string;
};

function parseBitcoinPaymentUri(uri: string): Bip353Payment {
  const t = uri.trim().replace(/^"|"$/g, "");
  let query = "";
  if (/^bitcoin:/i.test(t)) {
    const q = t.indexOf("?");
    query = q >= 0 ? t.slice(q + 1) : "";
  } else if (t.includes("=")) {
    query = t.startsWith("?") ? t.slice(1) : t;
  } else {
    // Bare bolt11 / lno
    if (looksLikeBolt11(t)) return { bolt11: normalizeBolt11(t), raw: t };
    if (looksLikeBolt12(t)) return { bolt12: stripLightningScheme(t), raw: t };
    return { raw: t };
  }

  const params = new URLSearchParams(query);
  const lightning = params.get("lightning") || params.get("ln");
  const lno = params.get("lno") || params.get("offer");
  const out: Bip353Payment = { raw: t };
  if (lightning && looksLikeBolt11(lightning)) {
    out.bolt11 = normalizeBolt11(lightning);
  }
  if (lno && looksLikeBolt12(lno)) {
    out.bolt12 = stripLightningScheme(lno);
  }
  return out;
}

async function resolveBip353Dns(
  user: string,
  domain: string,
): Promise<Bip353Payment | null> {
  const name = bip353DnsName(user, domain);
  // Cloudflare DoH (JSON). DNSSEC validated on their side when present.
  const url =
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LNURL_FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: ac.signal,
      headers: {
        Accept: "application/dns-json",
        "User-Agent": FETCH_HEADERS["User-Agent"]!,
      },
    });
  } catch (e) {
    if (isAbortError(e)) return null;
    return null;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return null;
  const json = (await res.json()) as {
    Status?: number;
    Answer?: Array<{ type?: number; data?: string }>;
  };
  if (json.Status !== 0 || !Array.isArray(json.Answer)) return null;

  const texts: string[] = [];
  for (const ans of json.Answer) {
    if (ans.type !== 16 || typeof ans.data !== "string") continue;
    // Cloudflare returns quoted TXT chunks: "bitcoin:?lno=..."
    const unquoted = ans.data.replace(/^"|"$/g, "").replace(/" "/g, "");
    texts.push(unquoted);
  }
  if (texts.length === 0) return null;

  // Prefer a record that carries lightning / lno / bitcoin:
  for (const text of texts) {
    if (/bitcoin:|lightning=|lno=|lnurl/i.test(text) || looksLikeBolt11(text) || looksLikeBolt12(text)) {
      return parseBitcoinPaymentUri(text);
    }
  }
  return parseBitcoinPaymentUri(texts[0]!);
}

function probeFromLnurlPay(
  kind: LnPayKind,
  display: string,
  pay: LnurlPayRequest,
): LnPayProbe {
  const minSats = Math.ceil(pay.minSendable / 1000);
  const maxSats = Math.floor(pay.maxSendable / 1000);
  const fixed = minSats === maxSats && minSats > 0;
  return {
    kind,
    display,
    amountSats: fixed ? minSats : null,
    minSats,
    maxSats,
    description: parseLnurlMetadata(pay.metadata),
    needsAmount: !fixed,
    callback: pay.callback,
    commentAllowed: pay.commentAllowed,
  };
}

/**
 * Lightweight probe: classify + fetch LNURL params / decode bolt11 amount.
 * Does not request an invoice yet (except when amount is fixed by the server).
 */
export async function probeLightningPay(raw: string): Promise<LnPayProbe> {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Empty destination");

  // BOLT11
  if (looksLikeBolt11(trimmed)) {
    const bolt11 = normalizeBolt11(trimmed);
    const amountSats = parseBolt11AmountSats(bolt11);
    return {
      kind: "bolt11",
      display: midEllipsis(bolt11, 12, 8),
      amountSats,
      needsAmount: amountSats == null,
      bolt11,
    };
  }

  // BOLT12 offer (no resolve without node support)
  if (looksLikeBolt12(trimmed)) {
    const offer = stripLightningScheme(trimmed);
    return {
      kind: "bolt12",
      display: midEllipsis(offer, 10, 8),
      amountSats: null,
      needsAmount: true,
      bolt12: offer,
    };
  }

  // LNURL bech32 or https lnurl endpoint
  if (looksLikeLnurlBech32(trimmed) || /^https?:\/\//i.test(trimmed)) {
    const url = looksLikeLnurlBech32(trimmed)
      ? decodeLnurlBech32(trimmed)
      : trimmed;
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("LNURL did not decode to an https URL");
    }
    const pay = await fetchLnurlPayRequest(url);
    return probeFromLnurlPay("lnurl", midEllipsis(url, 18, 12), pay);
  }

  // user@domain — BIP353 first, then Lightning Address (LNURL-p)
  if (looksLikeLightningAddress(trimmed)) {
    const m = trimmed.replace(/^₿/, "").match(BIP353_RE);
    if (!m) throw new Error("Invalid address");
    const user = m[1]!;
    const domain = m[2]!;
    const display = `${user}@${domain}`;

    try {
      const bip = await resolveBip353Dns(user, domain);
      if (bip?.bolt11) {
        const amountSats = parseBolt11AmountSats(bip.bolt11);
        return {
          kind: "bip353",
          display,
          amountSats,
          needsAmount: amountSats == null,
          bolt11: bip.bolt11,
          description: "BIP353",
        };
      }
      if (bip?.bolt12) {
        // Offer only — still try LNURL-p so address payments work on LNDHub.
        try {
          const pay = await fetchLnurlPayRequest(
            lightningAddressToLnurlp(display),
          );
          return probeFromLnurlPay("lightning-address", display, pay);
        } catch {
          return {
            kind: "bolt12",
            display,
            amountSats: null,
            needsAmount: true,
            bolt12: bip.bolt12,
            description: "BIP353 offer (BOLT12)",
          };
        }
      }
    } catch {
      /* fall through to LNURL-p */
    }

    const pay = await fetchLnurlPayRequest(lightningAddressToLnurlp(display));
    return probeFromLnurlPay("lightning-address", display, pay);
  }

  throw new Error(
    "Paste a BOLT11 invoice, LNURL, Lightning Address, or BIP353 address",
  );
}

/**
 * Resolve to a payable BOLT11. `amountSats` required when probe.needsAmount.
 */
export async function resolveLightningPay(
  raw: string,
  amountSats: number | null | undefined,
  probe?: LnPayProbe,
): Promise<LnPayResolved> {
  const p = probe ?? (await probeLightningPay(raw));

  if (p.kind === "bolt12" && !p.bolt11) {
    throw new Error(
      "BOLT12 offers need a node that supports fetchinvoice. This LNDHub connection only pays BOLT11 (use a Lightning Address / LNURL that issues invoices).",
    );
  }

  if (p.bolt11 && looksLikeBolt11(p.bolt11)) {
    const bolt11 = normalizeBolt11(p.bolt11);
    const invAmt = parseBolt11AmountSats(bolt11);
    const payAmt =
      invAmt != null && invAmt > 0
        ? invAmt
        : amountSats != null && amountSats > 0
          ? Math.floor(amountSats)
          : null;
    if (payAmt == null) {
      throw new Error("Enter how many sats to send");
    }
    return {
      kind: p.kind,
      bolt11,
      amountSats: payAmt,
      description: p.description,
      display: p.display,
    };
  }

  // LNURL / Lightning Address callback
  if (p.callback) {
    const min = p.minSats ?? 1;
    const max = p.maxSats ?? Number.MAX_SAFE_INTEGER;
    const fixed = p.amountSats != null && p.amountSats > 0 ? p.amountSats : null;
    const payAmt =
      fixed ??
      (amountSats != null && amountSats > 0 ? Math.floor(amountSats) : null);
    if (payAmt == null) {
      throw new Error("Enter how many sats to send");
    }
    if (payAmt < min || payAmt > max) {
      throw new Error(
        `Amount must be between ${min.toLocaleString("en-US")} and ${max.toLocaleString("en-US")} sats`,
      );
    }
    const bolt11 = await lnurlPayInvoice(p.callback, payAmt);
    return {
      kind: p.kind,
      bolt11,
      amountSats: payAmt,
      description: p.description,
      display: p.display,
    };
  }

  // Re-probe paths that need a fresh LNURL fetch (no cached callback)
  if (p.kind === "lightning-address" || p.kind === "lnurl" || p.kind === "bip353") {
    const fresh = await probeLightningPay(raw);
    return resolveLightningPay(raw, amountSats, fresh);
  }

  throw new Error("Could not resolve payment destination");
}

function midEllipsis(s: string, head: number, tail: number): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}
