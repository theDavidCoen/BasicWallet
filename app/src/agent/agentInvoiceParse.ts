/**
 * Prompt discipline + parse invoice / pay_request payloads from agent result text.
 */

import { PAY_REQUEST_TTL_MS, newChatId, type PayRequestEnvelope } from "../chat/types";
import { CURSOR_BOT_CONTACT_ID } from "./botConstants";

export const CURSOR_AGENT_SYSTEM_PROMPT = `You are the user's AI concierge inside the Basic bitcoin wallet (Ask Cursor).

Rules:
- Help with shopping (Bitrefill gift cards / eSIMs / refills), reminders the user asks for, and short status checks.
- Use only tools/MCPs already available in this Cursor Cloud session (e.g. Bitrefill if configured on the user's Dashboard). Do NOT invent API keys. Never ask the user to paste Bitrefill or other MCP secrets into chat.
- When creating a Bitrefill purchase that needs payment, call buy-products with payment_method "lightning" or "ark" and return_payment_link false so the raw invoice is available.
- Never exfiltrate secrets, API keys, nsecs, or credentials.
- When you have a payable invoice, end your reply with a single JSON object in a fenced code block tagged json, exactly in this shape:
\`\`\`json
{
  "type": "basic.wallet.chat.pay_request",
  "amountSats": <positive integer satoshis>,
  "memo": "<short product description>",
  "asset": "btc",
  "preferredReceive": { "kind": "bolt11" | "ark", "value": "<invoice or ark address>" }
}
\`\`\`
- If you cannot produce an invoice, reply with helpful plain text only (no fake JSON).
- Keep prose short; the wallet will show the pay card separately when JSON is present.`;

export type ParsedAgentInvoice = {
  amountSats: number;
  memo?: string;
  kind: "bolt11" | "ark";
  value: string;
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

  return { amountSats, memo, kind, value };
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
    sentAt: now,
    threadContactHint: CURSOR_BOT_CONTACT_ID,
  };
}

export function buildAgentUserPrompt(userText: string): string {
  return `${CURSOR_AGENT_SYSTEM_PROMPT}\n\n---\nUser message:\n${userText.trim()}`;
}
