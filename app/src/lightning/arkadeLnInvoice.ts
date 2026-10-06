/**
 * Local BOLT11 preflight for the Arkade Lightning corridor.
 * Refuse unusable invoices before any solver RFQ (no invoice leak).
 */

import { bech32 } from "@scure/base";
import type { ArkadeNetworkId } from "../config/network";
import { looksLikeBolt11, normalizeBolt11, parseBolt11AmountSats } from "./lndhub";

export type LnInvoiceRejection =
  | "unparseable"
  | "wrong_network"
  | "expired"
  | "zero_amount"
  | "no_payment_hash";

export class LnInvoiceRejected extends Error {
  readonly reason: LnInvoiceRejection;

  constructor(reason: LnInvoiceRejection, message: string) {
    super(message);
    this.name = "LnInvoiceRejected";
    this.reason = reason;
  }
}

export type ArkadeLnInvoiceFacts = {
  raw: string;
  amountSats: number;
  paymentHash: string;
  timestamp: number;
  expiresAt: number;
  /** BOLT11 coin network: bc | tbs | tb | bcrt */
  coinNetwork: string;
};

/** Signet and mutinynet share Lightning HRP `tbs` (official wallet bolt11.ts). */
const NETWORK_PREFIX: Record<string, string> = {
  mainnet: "bc",
  bitcoin: "bc",
  mutinynet: "tbs",
  signet: "tbs",
  testnet: "tb",
  regtest: "bcrt",
};

const DEFAULT_EXPIRY_SEC = 3600;
const SIG_WORDS = 104;
const TS_WORDS = 7;

function hrpCoinNetwork(hrp: string): string {
  const h = hrp.toLowerCase();
  if (h.startsWith("lnbcrt")) return "bcrt";
  if (h.startsWith("lntbs")) return "tbs";
  if (h.startsWith("lntb")) return "tb";
  if (h.startsWith("lnbc")) return "bc";
  return "";
}

function wordsToUint(words: number[]): number {
  let n = 0;
  for (const w of words) n = n * 32 + w;
  return n;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

function expectedCoinNetwork(networkId: ArkadeNetworkId | string): string {
  return NETWORK_PREFIX[networkId] ?? "bc";
}

/**
 * Decode enough of a BOLT11 to refuse dead invoices locally.
 * Amount still uses the existing HRP parser; hash/expiry come from bech32 words.
 */
export function toArkadeLnInvoiceFacts(
  invoice: string,
  networkId: ArkadeNetworkId | string,
  nowSeconds = Math.floor(Date.now() / 1000),
): ArkadeLnInvoiceFacts {
  const raw = normalizeBolt11(invoice);
  if (!looksLikeBolt11(raw)) {
    throw new LnInvoiceRejected("unparseable", "not a valid BOLT11 invoice");
  }

  let prefix: string;
  let words: number[];
  try {
    const decoded = bech32.decode(raw.toLowerCase() as `${string}1${string}`, 2500);
    prefix = decoded.prefix;
    words = decoded.words as number[];
  } catch {
    throw new LnInvoiceRejected("unparseable", "not a valid BOLT11 invoice");
  }

  const coinNetwork = hrpCoinNetwork(prefix);
  const want = expectedCoinNetwork(networkId);
  if (!coinNetwork || coinNetwork !== want) {
    throw new LnInvoiceRejected(
      "wrong_network",
      `invoice is not for ${networkId === "mutinynet" ? "mutinynet" : "bitcoin"}`,
    );
  }

  if (words.length < TS_WORDS + SIG_WORDS) {
    throw new LnInvoiceRejected("unparseable", "not a valid BOLT11 invoice");
  }

  const timestamp = wordsToUint(words.slice(0, TS_WORDS));
  const tagged = words.slice(TS_WORDS, words.length - SIG_WORDS);
  let expiry = DEFAULT_EXPIRY_SEC;
  let paymentHash = "";
  let i = 0;
  while (i + 3 <= tagged.length) {
    const type = tagged[i]!;
    const dataLen = (tagged[i + 1]! << 5) | tagged[i + 2]!;
    i += 3;
    if (i + dataLen > tagged.length) break;
    const data = tagged.slice(i, i + dataLen);
    i += dataLen;
    if (type === 1 && data.length > 0) {
      try {
        paymentHash = bytesToHex(bech32.fromWords(data));
      } catch {
        paymentHash = "";
      }
    } else if (type === 6 && data.length > 0) {
      expiry = wordsToUint(data);
    }
  }

  if (!timestamp) {
    throw new LnInvoiceRejected("expired", "invoice has expired");
  }
  const expiresAt = timestamp + expiry;
  if (nowSeconds >= expiresAt) {
    throw new LnInvoiceRejected("expired", "invoice has expired");
  }

  const amountSats = parseBolt11AmountSats(raw);
  if (amountSats == null || amountSats <= 0) {
    throw new LnInvoiceRejected("zero_amount", "invoice does not specify an amount");
  }
  if (!paymentHash || paymentHash.length < 64) {
    throw new LnInvoiceRejected("no_payment_hash", "invoice carries no payment hash");
  }

  return { raw, amountSats, paymentHash, timestamp, expiresAt, coinNetwork };
}

export function friendlyLnInvoiceError(err: unknown): string {
  if (err instanceof LnInvoiceRejected) {
    switch (err.reason) {
      case "wrong_network":
        return err.message;
      case "expired":
        return "This invoice has expired.";
      case "zero_amount":
        return "This invoice has no amount. Ask for a fixed-amount invoice.";
      case "no_payment_hash":
        return "This invoice is missing a payment hash.";
      default:
        return "Not a valid Lightning invoice.";
    }
  }
  return err instanceof Error ? err.message : "Lightning pay failed.";
}
