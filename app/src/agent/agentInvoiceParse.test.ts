/**
 * Lightweight parse checks (run with: npx tsx src/agent/agentInvoiceParse.test.ts).
 */

import {
  parseAgentInvoice,
  stripInvoiceJsonFromText,
} from "./agentInvoiceParse";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const sample = `Here is your invoice.

\`\`\`json
{
  "type": "basic.wallet.chat.pay_request",
  "amountSats": 2100,
  "memo": "Bitrefill Amazon",
  "asset": "btc",
  "preferredReceive": { "kind": "bolt11", "value": "lnbc21u1ptestampleinvoice" }
}
\`\`\`
`;

const inv = parseAgentInvoice(sample);
assert(inv?.amountSats === 2100, "amount");
assert(inv?.kind === "bolt11", "kind");
assert(inv?.value.startsWith("lnbc"), "value");
assert(stripInvoiceJsonFromText(sample).includes("Here is your invoice"), "prose");
assert(!stripInvoiceJsonFromText(sample).includes("amountSats"), "stripped json");

console.log("agentInvoiceParse.test.ts OK");
