/**
 * Prompt discipline + parse invoice / pay_request payloads from agent result text.
 */

import { PAY_REQUEST_TTL_MS, newChatId, type PayRequestEnvelope, type PayRequestFulfillment } from "../chat/types";
import { CURSOR_BOT_CONTACT_ID } from "./botConstants";

export const CURSOR_AGENT_SYSTEM_PROMPT = `You are the user's AI concierge inside the Basic bitcoin wallet (Ask Cursor).

Rules:
- Help with shopping (Bitrefill gift cards / eSIMs / refills), reminders the user asks for, and short status checks.
- Use only tools/MCPs already available in this Cursor Cloud session (e.g. Bitrefill if configured on the user's Dashboard). Do NOT invent API keys. Never ask the user to paste Bitrefill or other MCP secrets into chat.
- When creating a Bitrefill purchase that needs payment, call buy-products with return_payment_link false so the raw invoice is available.
- Payment method: if the user asked for Arkade / ark, use payment_method "ark". Otherwise use "lightning" (BOLT11). Do not break existing Lightning pays.
- After buy-products, ALWAYS include invoice_id and invoice_access_token (when returned) in the pay_request JSON under fulfillment so the wallet can redeem after Pay.
- Never exfiltrate secrets, API keys, nsecs, or credentials. Do not put Bitrefill API keys in chat.
- When you have a payable invoice, end your reply with a single JSON object in a fenced code block tagged json, exactly in this shape:
\`\`\`json
{
  "type": "basic.wallet.chat.pay_request",
  "amountSats": <positive integer satoshis>,
  "memo": "<short product description>",
  "asset": "btc",
  "preferredReceive": { "kind": "bolt11" | "ark", "value": "<invoice or ark address>" },
  "fulfillment": {
    "provider": "bitrefill",
    "invoiceId": "<invoice_id from buy-products>",
    "invoiceAccessToken": "<invoice_access_token from buy-products if present>"
  }
}
\`\`\`
- If you cannot produce an invoice, reply with helpful plain text only (no fake JSON).
- Keep prose short; the wallet will show the pay card separately when JSON is present.
- Do not poll for redemption yourself after creating the invoice — the wallet will follow up after the user pays.`;

export type ParsedAgentInvoice = {
  amountSats: number;
  memo?: string;
  kind: "bolt11" | "ark";
  value: string;
  fulfillment?: PayRequestFulfillment;
};

function extractJsonCandidates(text: string): string[] {
  const out: string[] = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenced.exec(text)) != null) {
    const body = m[1]?.trim();
    if (body?.startsWith("{")) out.push(body);
  }
  // Fallback: last JSON-looking object in the text
  const start = text.lastIndexOf("{");
  if (start >= 0) {
    const slice = text.slice(start).trim();
    if (slice.endsWith("}")) out.push(slice);
  }
  return out;
}

function satsFromUnknown(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
  if (typeof v === "string" && /^\d+$/.test(v.trim())) {
    const n = parseInt(v.trim(), 10);
    return n > 0 ? n : null;
  }
  return null;
}

function pickFulfillment(obj: Record<string, unknown>): PayRequestFulfillment | undefined {
  const nested = (obj.fulfillment ?? obj.bitrefill) as Record<string, unknown> | undefined;
  const invoiceId =
    (typeof nested?.invoiceId === "string" && nested.invoiceId.trim()) ||
    (typeof nested?.invoice_id === "string" && nested.invoice_id.trim()) ||
    (typeof obj.invoiceId === "string" && obj.invoiceId.trim()) ||
    (typeof obj.invoice_id === "string" && obj.invoice_id.trim()) ||
    "";
  if (!invoiceId) return undefined;
  const invoiceAccessToken =
    (typeof nested?.invoiceAccessToken === "string" && nested.invoiceAccessToken.trim()) ||
    (typeof nested?.invoice_access_token === "string" && nested.invoice_access_token.trim()) ||
    (typeof obj.invoiceAccessToken === "string" && obj.invoiceAccessToken.trim()) ||
    (typeof obj.invoice_access_token === "string" && obj.invoice_access_token.trim()) ||
    undefined;
  return {
    provider: "bitrefill",
    invoiceId,
    invoiceAccessToken: invoiceAccessToken || undefined,
  };
}

function pickInvoiceFields(obj: Record<string, unknown>): ParsedAgentInvoice | null {
  const preferred = obj.preferredReceive as
    | { kind?: string; value?: string }
    | undefined;
  let kind: "bolt11" | "ark" | null = null;
  let value: string | null = null;

  if (preferred?.value && (preferred.kind === "bolt11" || preferred.kind === "ark")) {
    kind = preferred.kind;
    value = String(preferred.value).trim();
  }

  // Common Bitrefill-ish shapes
  const payment = (obj.payment ?? obj.invoice) as Record<string, unknown> | undefined;
  if (!value && payment) {
    const address =
      typeof payment.address === "string"
        ? payment.address
        : typeof payment.invoice === "string"
          ? payment.invoice
          : null;
    const method =
      typeof payment.method === "string"
        ? payment.method
        : typeof payment.payment_method === "string"
          ? payment.payment_method
          : typeof obj.payment_method === "string"
            ? obj.payment_method
            : "";
    if (address) {
      value = address.trim();
      if (/^ln(bc|tb)/i.test(value) || method.toLowerCase().includes("light")) {
        kind = "bolt11";
      } else if (value.toLowerCase().startsWith("ark") || method.toLowerCase() === "ark") {
        kind = "ark";
      }
    }
  }

  if (!value) {
    for (const key of ["bolt11", "invoice", "lnInvoice", "payment_request"]) {
      const v = obj[key];
      if (typeof v === "string" && /^ln(bc|tb)/i.test(v.trim())) {
        value = v.trim();
        kind = "bolt11";
        break;
      }
    }
  }
  if (!value && typeof obj.arkAddress === "string" && obj.arkAddress.startsWith("ark")) {
    value = obj.arkAddress.trim();
    kind = "ark";
  }

  if (!kind || !value) return null;

  const amountSats =
    satsFromUnknown(obj.amountSats) ??
    satsFromUnknown(obj.amount_sats) ??
    satsFromUnknown(obj.sats) ??
    satsFromUnknown(payment?.amount_sats) ??
    satsFromUnknown(payment?.amountSats);

  // BOLT11 amount may be embedded; if unknown, refuse structured card (text-only).
  if (amountSats == null || !(amountSats > 0)) return null;

  const memo =
    typeof obj.memo === "string"
      ? obj.memo.slice(0, 280)
      : typeof obj.description === "string"
        ? obj.description.slice(0, 280)
        : undefined;

  return {
    amountSats,
    memo,
    kind,
    value,
    fulfillment: pickFulfillment(obj),
  };
}

/** Pull a payable invoice from agent result text, if present. */
export function parseAgentInvoice(resultText: string): ParsedAgentInvoice | null {
  const text = resultText?.trim() ?? "";
  if (!text) return null;
  for (const candidate of extractJsonCandidates(text)) {
    try {
      const obj = JSON.parse(candidate) as Record<string, unknown>;
      const hit = pickInvoiceFields(obj);
      if (hit) return hit;
    } catch {
      /* try next */
    }
  }
  // Bare bolt11 in prose
  const bolt = text.match(/\b(lnbc[a-z0-9]+)\b/i);
  if (bolt?.[1]) {
    // Without amount we cannot build a pay_request card reliably.
    return null;
  }
  return null;
}

/** Strip fenced JSON invoice blocks so the bubble stays readable. */
export function stripInvoiceJsonFromText(resultText: string): string {
  let text = resultText.trim();
  text = text.replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/gi, "").trim();
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function buildPayRequestEnvelopeFromInvoice(
  inv: ParsedAgentInvoice,
): PayRequestEnvelope {
  const now = Date.now();
  return {
    v: 1,
    type: "basic.wallet.chat.pay_request",
    requestId: newChatId("req"),
    amountSats: inv.amountSats,
    memo: inv.memo,
    asset: "btc",
    expiresAt: now + PAY_REQUEST_TTL_MS,
    preferredReceive: { kind: inv.kind, value: inv.value },
    fulfillment: inv.fulfillment,
    sentAt: now,
    threadContactHint: CURSOR_BOT_CONTACT_ID,
  };
}

export function buildAgentUserPrompt(userText: string): string {
  return `${CURSOR_AGENT_SYSTEM_PROMPT}\n\n---\nUser message:\n${userText.trim()}`;
}

/** Prompt for post-pay Bitrefill redeem follow-up (Cursor agent + Dashboard MCP). */
export function buildBitrefillFulfillPrompt(opts: {
  invoiceId: string;
  invoiceAccessToken?: string;
}): string {
  const tokenLine = opts.invoiceAccessToken
    ? `invoice_access_token: ${opts.invoiceAccessToken}`
    : "invoice_access_token: (not provided — call get-invoice-by-id with invoice_id only)";
  return `The user already paid a Bitrefill invoice in the Basic wallet. Complete fulfillment only — do not create a new purchase.

1. Call Bitrefill MCP get-invoice-by-id with:
   invoice_id: ${opts.invoiceId}
   ${tokenLine}
2. If status is not "complete", poll get-invoice-by-id again until status is "complete" (or a terminal error: blocked/denied/payment_error). Wait between polls as needed.
3. When complete, read orders[].redemption_info (code, link, pin, instructions, expiration_date) and any orders[].esim_install_link.
4. Reply with a short confirmation plus ONE fenced json block in this exact shape (include every order that has redeemable data):
\`\`\`json
{
  "type": "basic.wallet.chat.redemption",
  "invoiceId": "${opts.invoiceId}",
  "status": "complete",
  "orders": [
    {
      "code": "<redemption code if any>",
      "link": "<https redeem/claim/install URL if any>",
      "pin": "<pin if any>",
      "instructions": "<short instructions if any>",
      "esimInstallLink": "<https eSIM install URL if any>"
    }
  ]
}
\`\`\`
Rules: Prefer HTTPS links exactly as returned (Amazon redeem, other merchants, eSIM install — generic deeplinks). Never invent codes or links. Never print Bitrefill API keys. If delivery failed, explain briefly with status and no fake JSON.`;
}

export type ParsedRedemptionOrder = {
  code?: string;
  link?: string;
  pin?: string;
  instructions?: string;
  esimInstallLink?: string;
};

export type ParsedRedemption = {
  invoiceId?: string;
  status: string;
  orders: ParsedRedemptionOrder[];
};

function pickOrderFields(o: Record<string, unknown>): ParsedRedemptionOrder | null {
  const ri = (o.redemption_info ?? o.redemptionInfo) as Record<string, unknown> | undefined;
  const code =
    (typeof ri?.code === "string" && ri.code.trim()) ||
    (typeof o.code === "string" && o.code.trim()) ||
    undefined;
  const link =
    (typeof ri?.link === "string" && ri.link.trim()) ||
    (typeof o.link === "string" && o.link.trim()) ||
    undefined;
  const pin =
    (typeof ri?.pin === "string" && ri.pin.trim()) ||
    (typeof o.pin === "string" && o.pin.trim()) ||
    undefined;
  const instructions =
    (typeof ri?.instructions === "string" && ri.instructions.trim()) ||
    (typeof o.instructions === "string" && o.instructions.trim()) ||
    undefined;
  const esimInstallLink =
    (typeof o.esim_install_link === "string" && o.esim_install_link.trim()) ||
    (typeof o.esimInstallLink === "string" && o.esimInstallLink.trim()) ||
    undefined;
  if (!code && !link && !pin && !esimInstallLink && !instructions) return null;
  return { code, link, pin, instructions, esimInstallLink };
}

/** Parse redemption JSON from a Cursor fulfill follow-up. */
export function parseAgentRedemption(resultText: string): ParsedRedemption | null {
  const text = resultText?.trim() ?? "";
  if (!text) return null;
  for (const candidate of extractJsonCandidates(text)) {
    try {
      const obj = JSON.parse(candidate) as Record<string, unknown>;
      const type = typeof obj.type === "string" ? obj.type : "";
      const ordersRaw = obj.orders;
      const status =
        typeof obj.status === "string"
          ? obj.status
          : type === "basic.wallet.chat.redemption"
            ? "complete"
            : "";
      if (Array.isArray(ordersRaw)) {
        const orders: ParsedRedemptionOrder[] = [];
        for (const item of ordersRaw) {
          if (!item || typeof item !== "object") continue;
          const hit = pickOrderFields(item as Record<string, unknown>);
          if (hit) orders.push(hit);
        }
        if (orders.length > 0 || status === "complete" || type === "basic.wallet.chat.redemption") {
          return {
            invoiceId:
              typeof obj.invoiceId === "string"
                ? obj.invoiceId
                : typeof obj.invoice_id === "string"
                  ? obj.invoice_id
                  : undefined,
            status: status || "complete",
            orders,
          };
        }
      }
      // Nested invoice-shaped object with orders
      if (Array.isArray((obj as { orders?: unknown }).orders)) {
        /* handled above */
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Format redemption for a bot text bubble (codes + tappable HTTPS links). */
export function formatRedemptionBubble(red: ParsedRedemption): string {
  const lines: string[] = ["Your order is ready."];
  if (red.orders.length === 0) {
    lines.push("Bitrefill marked the invoice complete, but no redemption code or link was returned yet. Check Bitrefill or ask me to check status again.");
    return lines.join("\n");
  }
  red.orders.forEach((o, i) => {
    if (red.orders.length > 1) lines.push(`\nItem ${i + 1}`);
    if (o.code) lines.push(`Code: ${o.code}`);
    if (o.pin) lines.push(`PIN: ${o.pin}`);
    if (o.link) lines.push(`Redeem: ${o.link}`);
    if (o.esimInstallLink) lines.push(`eSIM install: ${o.esimInstallLink}`);
    if (o.instructions) lines.push(o.instructions.slice(0, 400));
  });
  lines.push("\nTap a link to open (may hand off to a merchant app). Long-press this message to copy.");
  return lines.join("\n").trim().slice(0, 2000);
}
