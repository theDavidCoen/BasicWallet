/**
 * Minimal LND REST client (payments / balance / history — no channel management).
 * Auth: Grpc-Metadata-macaroon: <hex>
 *
 * Used for BTCPay → Services → LND (REST). Not LNDHub.
 */

import type { LndRestConfig } from "./btcpayConfig";
import {
  looksLikeBolt11,
  normalizeBolt11,
  parseBolt11AmountSats,
  type LightningPaymentInput,
} from "./lndhub";

export type LndGetInfo = {
  alias?: string;
  identity_pubkey?: string;
  synced_to_chain?: boolean;
  synced_to_graph?: boolean;
  num_active_channels?: number;
  block_height?: number;
  version?: string;
};

export type LndChannelBalance = {
  /** Local channel balance in sats. */
  localSats: number;
  remoteSats: number;
  pendingOpenLocalSats: number;
};

export type LndRestInvoice = {
  paymentRequest: string;
  paymentHash: string;
  amountSats: number;
  memo?: string;
};

export type LndRestInvoiceStatus = {
  paid: boolean;
  preimage?: string;
};

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

async function lndFetch<T>(
  cfg: LndRestConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = joinUrl(cfg.restUrl, path);
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Grpc-Metadata-macaroon": cfg.macaroonHex,
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      /* */
    }
    throw new Error(
      detail
        ? `LND REST ${res.status}: ${detail}`
        : `LND REST request failed (${res.status})`,
    );
  }

  return (await res.json()) as T;
}

export async function lndGetInfo(cfg: LndRestConfig): Promise<LndGetInfo> {
  return lndFetch<LndGetInfo>(cfg, "/v1/getinfo");
}

function amountSats(field: unknown): number {
  if (field == null) return 0;
  if (typeof field === "number" && Number.isFinite(field)) return Math.floor(field);
  if (typeof field === "string" && field.trim()) {
    const n = Number.parseInt(field, 10);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof field === "object") {
    const o = field as { sat?: string | number; msat?: string | number };
    if (o.sat != null) return amountSats(o.sat);
    if (o.msat != null) return Math.floor(amountSats(o.msat) / 1000);
  }
  return 0;
}

/** Host label for UI (no secrets). */
export function lndRestHostLabel(restUrl: string): string {
  try {
    return new URL(restUrl).host;
  } catch {
    return restUrl.replace(/^https?:\/\//i, "").split("/")[0] || restUrl;
  }
}

export async function lndChannelBalance(cfg: LndRestConfig): Promise<LndChannelBalance> {
  const raw = await lndFetch<{
    balance?: string;
    local_balance?: unknown;
    remote_balance?: unknown;
    pending_open_local_balance?: unknown;
  }>(cfg, "/v1/balance/channels");

  const localSats =
    amountSats(raw.local_balance) || amountSats(raw.balance);
  return {
    localSats,
    remoteSats: amountSats(raw.remote_balance),
    pendingOpenLocalSats: amountSats(raw.pending_open_local_balance),
  };
}

/** Probe credentials: getinfo + channel balance. */
export async function probeLndRest(cfg: LndRestConfig): Promise<{
  info: LndGetInfo;
  balance: LndChannelBalance;
}> {
  const info = await lndGetInfo(cfg);
  const balance = await lndChannelBalance(cfg);
  return { info, balance };
}

/** Decode LND base64 / hex / byte-array hash fields to lowercase hex. */
function hashToHex(v: unknown): string {
  if (typeof v === "string" && v.trim()) {
    const t = v.trim();
    if (/^[0-9a-fA-F]{16,}$/.test(t)) return t.toLowerCase();
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

function unixMs(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  return n > 1e12 ? Math.floor(n) : Math.floor(n * 1000);
}

/** Create a BOLT11 invoice (invoice macaroon or admin). */
export async function lndCreateInvoice(
  cfg: LndRestConfig,
  opts: { amountSats: number; memo?: string },
): Promise<LndRestInvoice> {
  const amt = Math.floor(opts.amountSats);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new Error("Amount must be a positive number of sats");
  }
  const memo = (opts.memo ?? "").trim() || "Basic";
  const raw = await lndFetch<{
    payment_request?: string;
    r_hash?: unknown;
    payment_hash?: unknown;
  }>(cfg, "/v1/invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: String(amt), memo }),
  });
  const paymentRequest = String(raw.payment_request ?? "").trim();
  if (!paymentRequest) throw new Error("LND REST returned no payment_request");
  const paymentHash = hashToHex(raw.r_hash) || hashToHex(raw.payment_hash);
  if (!paymentHash) throw new Error("LND REST returned no payment hash");
  return { paymentRequest, paymentHash, amountSats: amt, memo };
}

/** Look up invoice settle status by payment hash (hex). */
export async function lndInvoiceStatus(
  cfg: LndRestConfig,
  paymentHash: string,
): Promise<LndRestInvoiceStatus> {
  const hash = paymentHash.trim().toLowerCase();
  if (!hash) return { paid: false };
  const raw = await lndFetch<{
    settled?: boolean;
    state?: string;
    r_preimage?: unknown;
    payment_preimage?: unknown;
  }>(cfg, `/v1/invoice/${encodeURIComponent(hash)}`);
  const paid =
    raw.settled === true ||
    (typeof raw.state === "string" && raw.state.toUpperCase() === "SETTLED");
  const preimage =
    hashToHex(raw.r_preimage) || hashToHex(raw.payment_preimage) || undefined;
  return {
    paid,
    preimage: preimage && !/^0+$/.test(preimage) ? preimage : undefined,
  };
}

/**
 * Pay a BOLT11 via LND REST (`POST /v1/channels/transactions`).
 * Amount-less invoices need `amountSats`.
 */
export async function lndPayInvoice(
  cfg: LndRestConfig,
  bolt11Raw: string,
  opts?: { amountSats?: number },
): Promise<{ paymentHash: string; preimage?: string; feeSats?: number }> {
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

  const body: Record<string, string> = { payment_request: invoice };
  if (invoiceAmt == null && override != null && override > 0) {
    body.amt = String(override);
  }

  const raw = await lndFetch<{
    payment_error?: string;
    payment_hash?: unknown;
    payment_preimage?: unknown;
    payment_route?: { total_fees?: string | number; total_fees_msat?: string | number };
  }>(cfg, "/v1/channels/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (raw.payment_error) {
    throw new Error(String(raw.payment_error));
  }

  const paymentHash = hashToHex(raw.payment_hash);
  if (!paymentHash) throw new Error("LND REST returned no payment hash");
  const preimage = hashToHex(raw.payment_preimage) || undefined;
  let feeSats: number | undefined;
  const route = raw.payment_route;
  if (route) {
    if (route.total_fees != null) feeSats = amountSats(route.total_fees);
    else if (route.total_fees_msat != null) {
      feeSats = Math.floor(amountSats(route.total_fees_msat) / 1000);
    }
  }
  return {
    paymentHash,
    preimage: preimage && !/^0+$/.test(preimage) ? preimage : undefined,
    feeSats,
  };
}

type RawPayment = Record<string, unknown>;
type RawInvoice = Record<string, unknown>;

function mapOutgoingPayment(p: RawPayment): LightningPaymentInput | null {
  const status = String(p.status ?? "").toUpperCase();
  if (status && status !== "SUCCEEDED") return null;
  const paymentHash = hashToHex(p.payment_hash);
  if (!paymentHash) return null;
  const amount =
    amountSats(p.value_sat) ||
    amountSats(p.value) ||
    Math.floor(amountSats(p.value_msat) / 1000);
  if (amount <= 0) return null;
  const feeSats =
    amountSats(p.fee_sat) ||
    amountSats(p.fee) ||
    Math.floor(amountSats(p.fee_msat) / 1000) ||
    undefined;
  const preimage = hashToHex(p.payment_preimage) || undefined;
  return {
    id: `ln-out-${paymentHash}`,
    amountSats: amount,
    direction: "out",
    createdAt: unixMs(p.creation_date ?? p.creation_time_ns),
    settled: true,
    memo: typeof p.payment_request === "string" ? undefined : undefined,
    paymentHash,
    preimage: preimage && !/^0+$/.test(preimage) ? preimage : undefined,
    feeSats: feeSats && feeSats > 0 ? feeSats : undefined,
  };
}

function mapSettledInvoice(inv: RawInvoice): LightningPaymentInput | null {
  const settled =
    inv.settled === true ||
    (typeof inv.state === "string" && inv.state.toUpperCase() === "SETTLED");
  if (!settled) return null;
  const paymentHash = hashToHex(inv.r_hash) || hashToHex(inv.payment_hash);
  if (!paymentHash) return null;
  const amount =
    amountSats(inv.value) ||
    amountSats(inv.amt_paid_sat) ||
    Math.floor(amountSats(inv.amt_paid_msat) / 1000);
  if (amount <= 0) return null;
  const preimage = hashToHex(inv.r_preimage) || hashToHex(inv.payment_preimage) || undefined;
  return {
    id: `ln-in-${paymentHash}`,
    amountSats: amount,
    direction: "in",
    createdAt: unixMs(inv.settle_date ?? inv.creation_date),
    settled: true,
    memo: typeof inv.memo === "string" ? inv.memo : undefined,
    paymentHash,
    preimage: preimage && !/^0+$/.test(preimage) ? preimage : undefined,
  };
}

/** Fetch recent settled LN payments + invoices for Activity. */
export async function lndListHistory(
  cfg: LndRestConfig,
  opts?: { limit?: number },
): Promise<LightningPaymentInput[]> {
  const limit = opts?.limit ?? 50;
  const out: LightningPaymentInput[] = [];

  try {
    const payments = await lndFetch<{ payments?: RawPayment[] }>(
      cfg,
      `/v1/payments?include_incomplete=false&max_payments=${limit}`,
    );
    for (const p of payments.payments ?? []) {
      const mapped = mapOutgoingPayment(p);
      if (mapped) out.push(mapped);
    }
  } catch (e) {
    console.warn("[basic] lnd REST payments", e);
  }

  try {
    const invoices = await lndFetch<{ invoices?: RawInvoice[] }>(
      cfg,
      `/v1/invoices?num_max_invoices=${limit}&reversed=true`,
    );
    for (const inv of invoices.invoices ?? []) {
      const mapped = mapSettledInvoice(inv);
      if (mapped) out.push(mapped);
    }
  } catch (e) {
    console.warn("[basic] lnd REST invoices", e);
  }

  out.sort((a, b) => b.createdAt - a.createdAt);
  return out.slice(0, limit);
}
