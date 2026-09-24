/**
 * BIP353 resolve for contacts — DNS TXT only (no LNURL-p fallback).
 * Verify must fail fast on missing/wrong entries; never hang on .well-known/lnurlp.
 */

import { looksLikeBolt12, type LnPayProbe } from "../lightning/lnPayResolve";
import { looksLikeBolt11, parseBolt11AmountSats, normalizeBolt11 } from "../lightning/lndhub";
import type { ResolvedHint } from "./types";

export type Bip353ResolveOk = {
  ok: true;
  probe: LnPayProbe;
  /** Value to put in the Send destination field. */
  payDestination: string;
  hint: ResolvedHint;
};

export type Bip353ResolveErr = {
  ok: false;
  message: string;
};

export type Bip353ResolveResult = Bip353ResolveOk | Bip353ResolveErr;

const BIP353_RE = /^₿?([a-zA-Z0-9._+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/;
/** Keep Verify snappy — DoH + parse only. */
const BIP353_VERIFY_TIMEOUT_MS = 8_000;

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
    if (looksLikeBolt11(t)) return { bolt11: normalizeBolt11(t), raw: t };
    if (looksLikeBolt12(t)) return { bolt12: t.replace(/^lightning:/i, "").trim(), raw: t };
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
    out.bolt12 = lno.replace(/^lightning:/i, "").trim();
  }
  return out;
}

async function fetchWithTimeout(
  url: string,
  ms: number,
  init?: RequestInit,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function lookupBip353Dns(
  user: string,
  domain: string,
): Promise<{ ok: true; payment: Bip353Payment } | { ok: false; message: string }> {
  const name = bip353DnsName(user, domain);
  const url =
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`;

  let res: Response;
  try {
    res = await fetchWithTimeout(url, BIP353_VERIFY_TIMEOUT_MS, {
      headers: {
        Accept: "application/dns-json",
        "User-Agent": "BasicWallet/0.1 (BIP353; +https://davidcoen.it)",
      },
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return {
        ok: false,
        message: `BIP353 lookup timed out for ${user}@${domain}.`,
      };
    }
    return {
      ok: false,
      message: `Could not query BIP353 DNS (${e instanceof Error ? e.message : String(e)}).`,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      message: `BIP353 DNS query failed (HTTP ${res.status}) for ${user}@${domain}.`,
    };
  }

  let json: {
    Status?: number;
    Answer?: Array<{ type?: number; data?: string }>;
  };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    return { ok: false, message: "BIP353 DNS response was not valid JSON." };
  }

  // NXDOMAIN / no answer
  if (json.Status !== 0 || !Array.isArray(json.Answer) || json.Answer.length === 0) {
    return {
      ok: false,
      message: `No BIP353 record for ${user}@${domain} (missing or wrong name).`,
    };
  }

  const texts: string[] = [];
  for (const ans of json.Answer) {
    if (ans.type !== 16 || typeof ans.data !== "string") continue;
    const unquoted = ans.data.replace(/^"|"$/g, "").replace(/" "/g, "");
    texts.push(unquoted);
  }
  if (texts.length === 0) {
    return {
      ok: false,
      message: `BIP353 DNS for ${user}@${domain} has no TXT payload.`,
    };
  }

  for (const text of texts) {
    if (
      /bitcoin:|lightning=|lno=|lnurl/i.test(text) ||
      looksLikeBolt11(text) ||
      looksLikeBolt12(text)
    ) {
      return { ok: true, payment: parseBitcoinPaymentUri(text) };
    }
  }
  return { ok: true, payment: parseBitcoinPaymentUri(texts[0]!) };
}

export async function resolveBip353ForContacts(
  raw: string,
  mode: "arkade" | "lightning",
): Promise<Bip353ResolveResult> {
  const trimmed = raw.trim();
  const m = trimmed.match(BIP353_RE);
  if (!m) {
    return { ok: false, message: "BIP353 must look like user@domain (optional ₿ prefix)." };
  }
  const user = m[1]!;
  const domain = m[2]!.toLowerCase();
  const display = `${user}@${domain}`;

  const dns = await lookupBip353Dns(user, domain);
  if (!dns.ok) return { ok: false, message: dns.message };

  const bip = dns.payment;

  if (bip.bolt11) {
    if (mode === "arkade") {
      return {
        ok: false,
        message: "BIP353 resolved to a BOLT11 invoice, which this Arkade wallet can’t pay.",
      };
    }
    const amountSats = parseBolt11AmountSats(bip.bolt11);
    const probe: LnPayProbe = {
      kind: "bip353",
      display,
      amountSats,
      needsAmount: amountSats == null,
      bolt11: bip.bolt11,
      description: "BIP353",
    };
    return {
      ok: true,
      probe,
      payDestination: bip.bolt11,
      hint: {
        at: Date.now(),
        kind: "bip353",
        value: bip.bolt11,
        note: "BIP353",
      },
    };
  }

  if (bip.bolt12) {
    return {
      ok: false,
      message:
        "BIP353 resolved to a BOLT12 offer only. This app can’t pay BOLT12 yet — use a record with lightning= (BOLT11).",
    };
  }

  return {
    ok: false,
    message: `BIP353 record for ${display} has no usable payment (need lightning=/BOLT11).`,
  };
}
