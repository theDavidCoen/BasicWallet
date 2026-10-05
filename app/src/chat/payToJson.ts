/**
 * Local-only pay destination JSON on chat request messages.
 * Extends kind/value with optional Bitrefill fulfillment ids (not API keys).
 */

import type { PayRequestFulfillment } from "./types";

export type ChatPayToPayload = {
  kind: "ark" | "bolt11";
  value: string;
  bitrefill?: {
    invoiceId: string;
    invoiceAccessToken?: string;
  };
};

export function buildPayToJson(opts: {
  kind: "ark" | "bolt11";
  value: string;
  fulfillment?: PayRequestFulfillment | null;
}): string {
  const payload: ChatPayToPayload = {
    kind: opts.kind,
    value: opts.value,
  };
  const id = opts.fulfillment?.invoiceId?.trim();
  if (opts.fulfillment?.provider === "bitrefill" && id) {
    payload.bitrefill = {
      invoiceId: id,
      invoiceAccessToken: opts.fulfillment.invoiceAccessToken?.trim() || undefined,
    };
  }
  return JSON.stringify(payload);
}

export function parsePayToPayload(
  json: string | null | undefined,
): ChatPayToPayload | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json) as Partial<ChatPayToPayload> & {
      bitrefill?: {
        invoiceId?: string;
        invoice_id?: string;
        invoiceAccessToken?: string;
        invoice_access_token?: string;
      };
    };
    if (
      (o.kind !== "ark" && o.kind !== "bolt11") ||
      typeof o.value !== "string" ||
      !o.value.trim()
    ) {
      return null;
    }
    const out: ChatPayToPayload = { kind: o.kind, value: o.value.trim() };
    const br = o.bitrefill;
    const invoiceId =
      typeof br?.invoiceId === "string"
        ? br.invoiceId.trim()
        : typeof br?.invoice_id === "string"
          ? br.invoice_id.trim()
          : "";
    if (invoiceId) {
      const token =
        typeof br?.invoiceAccessToken === "string"
          ? br.invoiceAccessToken.trim()
          : typeof br?.invoice_access_token === "string"
            ? br.invoice_access_token.trim()
            : undefined;
      out.bitrefill = {
        invoiceId,
        invoiceAccessToken: token || undefined,
      };
    }
    return out;
  } catch {
    return null;
  }
}

export function bitrefillFulfillmentFromPayToJson(
  json: string | null | undefined,
): PayRequestFulfillment | null {
  const p = parsePayToPayload(json);
  if (!p?.bitrefill?.invoiceId) return null;
  return {
    provider: "bitrefill",
    invoiceId: p.bitrefill.invoiceId,
    invoiceAccessToken: p.bitrefill.invoiceAccessToken,
  };
}
