/**
 * Lightweight parse checks (run with: npx tsx src/agent/agentInvoiceParse.test.ts).
 */

import {
  formatRedemptionBubble,
  parseAgentInvoice,
  parseAgentRedemption,
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
  "preferredReceive": { "kind": "bolt11", "value": "lnbc21u1ptestampleinvoice" },
  "fulfillment": {
    "provider": "bitrefill",
    "invoiceId": "6654a2ea-0df7-4f44-bc72-c1c6ad8b7b34",
    "invoiceAccessToken": "tok_test_abc"
  }
}
\`\`\`
`;

const inv = parseAgentInvoice(sample);
assert(inv?.amountSats === 2100, "amount");
assert(inv?.kind === "bolt11", "kind");
assert(inv?.value.startsWith("lnbc"), "value");
assert(inv?.fulfillment?.provider === "bitrefill", "fulfill provider");
assert(
  inv?.fulfillment?.invoiceId === "6654a2ea-0df7-4f44-bc72-c1c6ad8b7b34",
  "invoice id",
);
assert(inv?.fulfillment?.invoiceAccessToken === "tok_test_abc", "token");
assert(stripInvoiceJsonFromText(sample).includes("Here is your invoice"), "prose");
assert(!stripInvoiceJsonFromText(sample).includes("amountSats"), "stripped json");

const redeemSample = `Ready.

\`\`\`json
{
  "type": "basic.wallet.chat.redemption",
  "invoiceId": "6654a2ea-0df7-4f44-bc72-c1c6ad8b7b34",
  "status": "complete",
  "orders": [
    {
      "code": "AMZN-TEST-CODE",
      "link": "https://redeem.amazon.com/claim?code=AMZN-TEST-CODE",
      "pin": null,
      "instructions": "Redeem on Amazon"
    }
  ]
}
\`\`\`
`;

const red = parseAgentRedemption(redeemSample);
assert(red?.orders.length === 1, "orders");
assert(red?.orders[0]?.code === "AMZN-TEST-CODE", "code");
assert(red?.orders[0]?.link?.startsWith("https://redeem.amazon.com"), "link");
const bubble = formatRedemptionBubble(red!);
assert(bubble.includes("AMZN-TEST-CODE"), "bubble code");
assert(bubble.includes("https://redeem.amazon.com"), "bubble link");

console.log("agentInvoiceParse.test.ts OK");
