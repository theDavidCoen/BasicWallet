/**
 * LNDHub URI + REST client (LNbits extension compatible).
 *
 * URI shape from LNbits LndHub extension:
 *   lndhub://admin:<adminkey>@https://host/lndhub/ext/
 *   lndhub://invoice:<inkey>@https://host/lndhub/ext/
 *
 * Endpoints follow BlueWallet LndHub (addinvoice, payinvoice, gettxs, …).
 */

export type LightningPaymentInput = {
  /** Stable id (payment hash / invoice id). */
  id: string;
  amountSats: number;
  /** Negative = send, positive = receive. */
  direction: "in" | "out";
  createdAt: number;
  settled: boolean;
  memo?: string;
  paymentHash?: string;
  /** Hex preimage when known (outgoing pay or settled invoice). */
  preimage?: string;
  feeSats?: number;
};

export type LndHubRole = "admin" | "invoice";

export type LndHubConfig = {
  /** Base ending with /ext/ (or /ext) — endpoints are getinfo, auth, balance, … */
  baseUrl: string;
  role: LndHubRole;
  /** Wallet admin or invoice API key (password part of the URI). */
  apiKey: string;
  /** Host label for UI (no secrets). */
  hostLabel: string;
};

export type LndHubBalance = {
  availableSats: number;
};

export type LndHubInvoice = {
  paymentRequest: string;
  paymentHash: string;
  amountSats: number;
  memo?: string;
};

export type DecodedBolt11 = {
  paymentRequest: string;
  amountSats: number | null;
  description?: string;
  paymentHash?: string;
  expiry?: number;
};

function normalizeBaseUrl(raw: string): string {
  let u = raw.trim();
  if (!/^https?:\/\//i.test(u)) {
    throw new Error("LNDHub URL must be http(s)");
  }
  // Fix accidental lndhub://admin:key@https://… parsed with missing slash after scheme
  u = u.replace(/^(https?:)\/(?!\/)/i, "$1//");
  u = u.replace(/\/+$/, "") + "/";
  return u;
}

/**
 * Parse `lndhub://…` or a bare https base + keys are not supported alone.
 * Returns null if the string is not an LNDHub URI.
 */
export function parseLndHubUri(raw: string): LndHubConfig | null {
  const t = raw.trim();
  if (!t) return null;

  const m = t.match(
    /^lndhub:\/\/(admin|invoice):([^@]+)@(https?:\/\/.+)$/i,
  );
  if (!m) {
    // Some QRs omit the scheme
    if (/^(admin|invoice):.+@https?:\/\//i.test(t)) {
      return parseLndHubUri(`lndhub://${t}`);
    }
    return null;
  }

  const role = m[1]!.toLowerCase() as LndHubRole;
  const apiKey = decodeURIComponent(m[2]!);
  const rest = m[3]!;
  if (!apiKey || apiKey.length < 8) {
    throw new Error("Invalid LNDHub key");
  }

  const baseUrl = normalizeBaseUrl(rest);
  let hostLabel = baseUrl;
  try {
    hostLabel = new URL(baseUrl).host;
  } catch {
    /* keep baseUrl */
  }

  return { baseUrl, role, apiKey, hostLabel };
}

export function looksLikeLndHubUri(raw: string): boolean {
  const t = raw.trim();
  if (/^lndhub:\/\//i.test(t)) return true;
  if (/^(admin|invoice):.+@https?:\/\//i.test(t)) return true;
  return false;
}

export function looksLikeBolt11(raw: string): boolean {
  // Strip lightning: then require a real BOLT11 HRP (not LNURL / BOLT12).
  let t = raw.trim();
  if (/^lightning:/i.test(t)) {
    t = t.replace(/^lightning:/i, "");
    const q = t.indexOf("?");
    if (q >= 0) t = t.slice(0, q);
  }
  t = t.trim().toLowerCase();
  if (t.startsWith("lnurl") || t.startsWith("lno1")) return false;
  return (
    t.startsWith("lnbc") ||
    t.startsWith("lntb") ||
    t.startsWith("lnbcrt") ||
    t.startsWith("lnsb")
  );
}

/** Strip `lightning:` prefix / query junk from QR payloads. */
export function normalizeBolt11(raw: string): string {
  let t = raw.trim();
  if (/^lightning:/i.test(t)) {
    t = t.replace(/^lightning:/i, "");
    const q = t.indexOf("?");
    if (q >= 0) t = t.slice(0, q);
  }
  return t.trim();
}

async function lndhubFetch<T>(
  cfg: LndHubConfig,
  path: string,
  init?: RequestInit,
  authed = true,
): Promise<T> {
  const url = new URL(path.replace(/^\//, ""), cfg.baseUrl).toString();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (authed) {
    // LNbits accepts the wallet key directly in Authorization (see extension decorators).
    headers.Authorization = cfg.apiKey;
  }

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 180);
    } catch {
      /* */
    }
    throw new Error(
      detail ? `LNDHub ${res.status}: ${detail}` : `LNDHub request failed (${res.status})`,
    );
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export async function lndhubGetInfo(cfg: LndHubConfig): Promise<{ alias?: string }> {
  return lndhubFetch<{ alias?: string }>(cfg, "getinfo", undefined, false);
}

export async function lndhubGetBalance(cfg: LndHubConfig): Promise<LndHubBalance> {
  const raw = await lndhubFetch<{ BTC?: { AvailableBalance?: number } }>(cfg, "balance");
  const sats = Number(raw?.BTC?.AvailableBalance ?? 0);
  return { availableSats: Number.isFinite(sats) ? Math.floor(sats) : 0 };
}

export async function probeLndHub(cfg: LndHubConfig): Promise<{
  alias: string;
  balance: LndHubBalance;
}> {
  const [info, balance] = await Promise.all([
    lndhubGetInfo(cfg).catch(() => ({ alias: undefined as string | undefined })),
    lndhubGetBalance(cfg),
  ]);
  return {
    alias: info.alias?.trim() || cfg.hostLabel || "Lightning",
    balance,
  };
}

/** Normalize payment hash to lowercase hex (LNbits may send hex, base64, or byte arrays). */
function hashFromField(v: unknown): string {
  if (typeof v === "string" && v.trim()) {
    const t = v.trim();
    if (/^[0-9a-fA-F]{16,}$/.test(t)) return t.toLowerCase();
    // Base64 (BlueWallet / LND style r_hash)
    if (/^[A-Za-z0-9+/]+=*$/.test(t) && t.length >= 16) {
      try {
        const bin =
          typeof atob === "function"
            ? atob(t)
            : Buffer.from(t, "base64").toString("binary");
        let hex = "";
        for (let i = 0; i < bin.length; i++) {
          hex += bin.charCodeAt(i).toString(16).padStart(2, "0");
        }
        if (hex.length >= 16) return hex;
      } catch {
        /* keep raw */
      }
    }
    return t.toLowerCase();
  }
  if (v && typeof v === "object" && "data" in (v as object)) {
    const data = (v as { data?: number[] }).data;
    if (Array.isArray(data)) {
      return data.map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  }
  return "";
}

/** Create a BOLT11 invoice (admin or invoice key). */
export async function lndhubCreateInvoice(
  cfg: LndHubConfig,
  opts: { amountSats: number; memo?: string },
): Promise<LndHubInvoice> {
  const amt = Math.floor(opts.amountSats);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new Error("Amount must be a positive number of sats");
  }
  const memo = (opts.memo ?? "").trim() || "Basic";
  const raw = await lndhubFetch<Record<string, unknown>>(cfg, "addinvoice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amt, memo }),
  });
  const paymentRequest = String(
    raw.payment_request ?? raw.pay_req ?? raw.bolt11 ?? "",
  ).trim();
  if (!paymentRequest) throw new Error("LNDHub returned no payment_request");
  const paymentHash =
    hashFromField(raw.payment_hash) ||
    hashFromField(raw.r_hash) ||
    hashFromField(raw.id);
  if (!paymentHash) {
    throw new Error("LNDHub returned no payment hash");
  }
  return {
    paymentRequest,
    paymentHash,
    amountSats: amt,
    memo,
  };
}

/** Decode BOLT11 via LNDHub (preferred) with local amount fallback. */
export async function lndhubDecodeInvoice(
  cfg: LndHubConfig,
  bolt11Raw: string,
): Promise<DecodedBolt11> {
  const paymentRequest = normalizeBolt11(bolt11Raw);
  if (!looksLikeBolt11(paymentRequest)) {
    throw new Error("Not a BOLT11 invoice");
  }
  try {
    const q = encodeURIComponent(paymentRequest);
    const raw = await lndhubFetch<Record<string, unknown>>(
      cfg,
      `decodeinvoice?invoice=${q}`,
    );
    const amountSats = parseAmountField(raw);
    return {
      paymentRequest,
      amountSats,
      description:
        typeof raw.description === "string"
          ? raw.description
          : typeof raw.memo === "string"
            ? raw.memo
            : undefined,
      paymentHash:
        hashFromField(raw.payment_hash) ||
        hashFromField(raw.r_hash) ||
        undefined,
      expiry: typeof raw.expiry === "number" ? raw.expiry : undefined,
    };
  } catch {
    return {
      paymentRequest,
      amountSats: parseBolt11AmountSats(paymentRequest),
    };
  }
}

function parseAmountField(raw: Record<string, unknown>): number | null {
  const candidates = [raw.num_satoshis, raw.amt, raw.amount, raw.satoshis];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  if (typeof raw.msatoshi === "number" && raw.msatoshi > 0) {
    return Math.floor(raw.msatoshi / 1000);
  }
  return null;
}

/**
 * Minimal BOLT11 amount parse (no full decode).
 * `lnbc2500u1…` → 250_000 sats; amount-less invoices → null.
 */
export function parseBolt11AmountSats(bolt11: string): number | null {
  const t = normalizeBolt11(bolt11).toLowerCase();
  const m = t.match(/^ln(bc|tb|bcrt|sb)(\d+)([munp]?)1/);
  if (!m) return null;
  const n = Number(m[2]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const mul = m[3];
  // BOLT11: amount is in BTC with optional multiplier letter
  // m = milli-BTC, u = micro, n = nano, p = pico
  const btc =
    mul === "m"
      ? n / 1_000
      : mul === "u"
        ? n / 1_000_000
        : mul === "n"
          ? n / 1_000_000_000
          : mul === "p"
            ? n / 1_000_000_000_000
            : n; // no letter = full BTC (rare for invoices)
  const sats = Math.round(btc * 100_000_000);
  return sats > 0 ? sats : null;
}

function lnbitsApiRootFromLndHub(baseUrl: string): string {
  const u = new URL(baseUrl);
  const path = u.pathname.replace(/\/lndhub\/ext\/?$/i, "").replace(/\/+$/, "");
  return `${u.origin}${path}`;
}

function parsePayResult(raw: Record<string, unknown> | undefined): {
  paymentHash: string;
  preimage?: string;
  feeSats?: number;
} {
  const paymentHash =
    hashFromField(raw?.payment_hash) ||
    hashFromField(raw?.r_hash) ||
    hashFromField(raw?.checking_id) ||
    "";
  const preimage =
    hashFromField(raw?.payment_preimage) ||
    hashFromField(raw?.preimage) ||
    undefined;

  if (!paymentHash && !preimage) {
    throw new Error("Payment returned no payment_hash");
  }

  const route = raw?.payment_route as
    | { total_fees?: number; total_fees_msat?: number; total_amt?: number }
    | undefined;
  let feeSats: number | undefined;
  if (typeof route?.total_fees === "number") {
    feeSats = Math.floor(route.total_fees);
  } else if (typeof route?.total_fees_msat === "number") {
    feeSats = Math.floor(route.total_fees_msat / 1000);
  } else if (typeof raw?.fee === "number") {
    feeSats = Math.floor(raw.fee as number);
  } else if (typeof raw?.fee_msat === "number") {
    feeSats = Math.floor((raw.fee_msat as number) / 1000);
  }

  return {
    paymentHash: (paymentHash || preimage || "").toLowerCase(),
    preimage: preimage || undefined,
    feeSats,
  };
}

/**
 * LNbits native pay — supports amountless BOLT11 via `amount` (sats).
 * LNDHub `/payinvoice` rejects amountless invoices even when an amount is supplied.
 */
async function lnbitsPayBolt11(
  cfg: LndHubConfig,
  invoice: string,
  amountSats?: number,
): Promise<{ paymentHash: string; preimage?: string; feeSats?: number }> {
  const root = lnbitsApiRootFromLndHub(cfg.baseUrl);
  const url = `${root}/api/v1/payments`;
  const body: Record<string, unknown> = { out: true, bolt11: invoice };
  if (amountSats != null && amountSats > 0) {
    body.amount = amountSats;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      // LNbits wallet admin key (same secret as LNDHub admin URI password).
      "X-Api-Key": cfg.apiKey,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let raw: Record<string, unknown> = {};
  try {
    raw = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* */
  }
  if (!res.ok) {
    const detail =
      (typeof raw.detail === "string" && raw.detail) ||
      (typeof raw.message === "string" && raw.message) ||
      text.slice(0, 180) ||
      `HTTP ${res.status}`;
    throw new Error(detail);
  }

  let result = parsePayResult(raw);

  // Prefetch preimage if the create response omitted it.
  if (!result.preimage && result.paymentHash) {
    try {
      const checkUrl = `${root}/api/v1/payments/${encodeURIComponent(result.paymentHash)}`;
      const checkRes = await fetch(checkUrl, {
        headers: { Accept: "application/json", "X-Api-Key": cfg.apiKey },
      });
      if (checkRes.ok) {
        const checkRaw = (await checkRes.json()) as Record<string, unknown>;
        const pre =
          hashFromField(checkRaw.preimage) ||
          hashFromField(checkRaw.payment_preimage) ||
          undefined;
        if (pre) result = { ...result, preimage: pre };
        if (typeof checkRaw.fee === "number" && result.feeSats == null) {
          result = { ...result, feeSats: Math.floor(checkRaw.fee) };
        }
      }
    } catch {
      /* optional */
    }
  }

  return result;
}

/** Pay a BOLT11 — requires admin LNDHub key.
 * Amount-less invoices use LNbits `/api/v1/payments` (LNDHub does not support them).
 */
export async function lndhubPayInvoice(
  cfg: LndHubConfig,
  bolt11Raw: string,
  opts?: { amountSats?: number },
): Promise<{ paymentHash: string; preimage?: string; feeSats?: number }> {
  if (cfg.role !== "admin") {
    throw new Error(
      "This connection is invoice-only. Reconnect with an admin LNDHub URL to send.",
    );
  }
  const invoice = normalizeBolt11(bolt11Raw);
  if (!looksLikeBolt11(invoice)) throw new Error("Not a BOLT11 invoice");

  const invoiceAmt = parseBolt11AmountSats(invoice);
  const override =
    opts?.amountSats != null && Number.isFinite(opts.amountSats)
      ? Math.floor(opts.amountSats)
      : undefined;
  if (invoiceAmt == null && (override == null || override <= 0)) {
    throw new Error("This invoice has no amount — enter sats to send");
  }
  if (invoiceAmt != null && override != null && override !== invoiceAmt) {
    throw new Error(
      `Invoice amount is fixed at ${invoiceAmt.toLocaleString("en-US")} sats`,
    );
  }

  // Amountless: LNDHub payinvoice returns "Amountless invoices not supported".
  if (invoiceAmt == null && override != null && override > 0) {
    return lnbitsPayBolt11(cfg, invoice, override);
  }

  try {
    const raw = await lndhubFetch<Record<string, unknown>>(cfg, "payinvoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoice }),
    });

    if (raw && (raw.error === true || raw.payment_error)) {
      const msg =
        typeof raw.payment_error === "string"
          ? raw.payment_error
          : typeof raw.message === "string"
            ? raw.message
            : "Payment failed";
      // Some hubs surface amountless here even for fixed invoices wrongly —
      // if we have an override, fall through to LNbits.
      if (/amountless/i.test(msg) && override != null && override > 0) {
        return lnbitsPayBolt11(cfg, invoice, override);
      }
      throw new Error(msg);
    }

    return parsePayResult(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/amountless/i.test(msg) && override != null && override > 0) {
      return lnbitsPayBolt11(cfg, invoice, override);
    }
    throw e instanceof Error ? e : new Error(msg);
  }
}

type RawTx = Record<string, unknown>;

function mapOutgoingTx(tx: RawTx): LightningPaymentInput | null {
  const amount = Math.abs(
    Number(tx.value ?? tx.amount ?? tx.amt ?? tx.num_satoshis ?? 0),
  );
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const paymentHash = (
    hashFromField(tx.payment_hash) ||
    hashFromField(tx.r_hash) ||
    String(tx.txid ?? tx.id ?? "")
  ).toLowerCase();
  if (!paymentHash) return null;
  const createdAt = Number(tx.timestamp ?? tx.time ?? tx.date ?? Date.now() / 1000);
  const ms = createdAt > 1e12 ? createdAt : createdAt * 1000;
  const settled =
    tx.settled === true ||
    tx.ispaid === true ||
    tx.type === "paid_invoice" ||
    String(tx.type ?? "").toLowerCase().includes("paid");
  const preimage =
    hashFromField(tx.payment_preimage) ||
    hashFromField(tx.preimage) ||
    undefined;
  let feeSats: number | undefined;
  if (typeof tx.fee === "number") feeSats = Math.floor(tx.fee);
  else if (typeof tx.fees === "number") feeSats = Math.floor(tx.fees);
  else if (typeof tx.fee_msat === "number") feeSats = Math.floor(tx.fee_msat / 1000);
  return {
    id: `ln-out-${paymentHash}`,
    amountSats: Math.floor(amount),
    direction: "out",
    createdAt: ms,
    settled: settled !== false,
    memo:
      typeof tx.memo === "string"
        ? tx.memo
        : typeof tx.description === "string"
          ? tx.description
          : undefined,
    paymentHash,
    preimage: preimage || undefined,
    feeSats,
  };
}

function mapIncomingInvoice(inv: RawTx): LightningPaymentInput | null {
  const amount = Math.abs(Number(inv.amt ?? inv.amount ?? inv.value ?? 0));
  if (!Number.isFinite(amount) || amount < 0) return null;
  const paymentHash =
    hashFromField(inv.payment_hash) ||
    hashFromField(inv.r_hash) ||
    String(inv.id ?? "");
  if (!paymentHash) return null;
  const createdAt = Number(
    inv.timestamp ?? inv.time ?? inv.add_index ?? Date.now() / 1000,
  );
  const ms = createdAt > 1e12 ? createdAt : createdAt * 1000;
  const settled = inv.ispaid === true || inv.settled === true;
  // Unpaid invoices stay on Receive QR only — not in Activity.
  if (!settled) return null;
  if (amount <= 0) return null;
  const hash = paymentHash.toLowerCase();
  const preimage =
    hashFromField(inv.payment_preimage) ||
    hashFromField(inv.preimage) ||
    undefined;
  return {
    id: `ln-in-${hash}`,
    amountSats: Math.floor(amount),
    direction: "in",
    createdAt: ms,
    settled: true,
    memo:
      typeof inv.description === "string"
        ? inv.description
        : typeof inv.memo === "string"
          ? inv.memo
          : undefined,
    paymentHash: hash,
    preimage: preimage || undefined,
  };
}

/** Fetch recent LN payments + invoices and normalize for activity_idx. */
export async function lndhubListHistory(
  cfg: LndHubConfig,
  opts?: { limit?: number },
): Promise<LightningPaymentInput[]> {
  const limit = opts?.limit ?? 50;
  const out: LightningPaymentInput[] = [];

  try {
    const txs = await lndhubFetch<RawTx[] | { transactions?: RawTx[] }>(
      cfg,
      `gettxs?limit=${limit}&offset=0`,
    );
    const list = Array.isArray(txs)
      ? txs
      : Array.isArray((txs as { transactions?: RawTx[] })?.transactions)
        ? (txs as { transactions: RawTx[] }).transactions
        : [];
    for (const tx of list) {
      const mapped = mapOutgoingTx(tx);
      if (mapped) out.push(mapped);
    }
  } catch (e) {
    console.warn("[basic] lndhub gettxs", e);
  }

  try {
    const invoices = await lndhubFetch<RawTx[] | { invoices?: RawTx[] }>(
      cfg,
      "getuserinvoices",
    );
    const list = Array.isArray(invoices)
      ? invoices
      : Array.isArray((invoices as { invoices?: RawTx[] })?.invoices)
        ? (invoices as { invoices: RawTx[] }).invoices
        : [];
    for (const inv of list.slice(0, limit)) {
      const mapped = mapIncomingInvoice(inv);
      if (mapped) out.push(mapped);
    }
  } catch (e) {
    console.warn("[basic] lndhub getuserinvoices", e);
  }

  out.sort((a, b) => b.createdAt - a.createdAt);

  // Fill missing preimages via LNbits payment lookup (incoming often omit it on LNDHub).
  const needPre = out.filter((p) => p.settled && !p.preimage && p.paymentHash).slice(0, 12);
  if (needPre.length > 0) {
    await Promise.all(
      needPre.map(async (p) => {
        const pre = await lnbitsLookupPreimage(cfg, p.paymentHash!);
        if (pre) p.preimage = pre;
      }),
    );
  }

  return out;
}

/** LNbits GET /api/v1/payments/{hash} — preimage for paid in/out. */
export async function lnbitsLookupPreimage(
  cfg: LndHubConfig,
  paymentHash: string,
): Promise<string | undefined> {
  const hash = paymentHash.trim();
  if (!hash) return undefined;
  try {
    const root = lnbitsApiRootFromLndHub(cfg.baseUrl);
    const url = `${root}/api/v1/payments/${encodeURIComponent(hash)}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Api-Key": cfg.apiKey,
      },
    });
    if (!res.ok) return undefined;
    const raw = (await res.json()) as Record<string, unknown>;
    const pre =
      hashFromField(raw.preimage) ||
      hashFromField(raw.payment_preimage) ||
      undefined;
    // LNbits sometimes returns all-zero preimage for unpaid.
    if (!pre || /^0+$/.test(pre)) return undefined;
    return pre;
  } catch {
    return undefined;
  }
}

export type LndHubInvoiceStatus = {
  paid: boolean;
  preimage?: string;
};

/** Look up invoice settle status + preimage (getuserinvoices, then LNbits). */
export async function lndhubInvoiceStatus(
  cfg: LndHubConfig,
  paymentHash: string,
): Promise<LndHubInvoiceStatus> {
  const hash = paymentHash.toLowerCase();
  try {
    const invoices = await lndhubFetch<RawTx[]>(cfg, "getuserinvoices");
    const list = Array.isArray(invoices) ? invoices : [];
    for (const inv of list) {
      const h = (
        hashFromField(inv.payment_hash) ||
        hashFromField(inv.r_hash) ||
        ""
      ).toLowerCase();
      if (h && (h === hash || h.includes(hash) || hash.includes(h))) {
        const paid = inv.ispaid === true || inv.settled === true;
        let preimage =
          hashFromField(inv.payment_preimage) ||
          hashFromField(inv.preimage) ||
          undefined;
        if (paid && !preimage) {
          preimage = await lnbitsLookupPreimage(cfg, hash);
        }
        return { paid, preimage };
      }
    }
  } catch {
    /* */
  }
  // Fallback: LNbits payment record by hash
  const preimage = await lnbitsLookupPreimage(cfg, hash);
  if (preimage) return { paid: true, preimage };
  return { paid: false };
}

/** @deprecated use lndhubInvoiceStatus */
export async function lndhubIsInvoicePaid(
  cfg: LndHubConfig,
  paymentHash: string,
): Promise<boolean> {
  const s = await lndhubInvoiceStatus(cfg, paymentHash);
  return s.paid;
}
