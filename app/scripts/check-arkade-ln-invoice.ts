/**
 * Local BOLT11 preflight for Arkade Lightning (no solver, no wallet).
 */
import { bech32 } from "@scure/base";
import {
  LnInvoiceRejected,
  toArkadeLnInvoiceFacts,
} from "../src/lightning/arkadeLnInvoice";

let failed = 0;
function assert(name: string, cond: boolean) {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    console.log(`  FAIL  ${name}`);
    failed += 1;
  }
}

function wordsTo5(n: number, count: number): number[] {
  const out: number[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push((n >>> (i * 5)) & 31);
  }
  return out;
}

function craftBolt11(opts: {
  hrp: string;
  timestamp: number;
  expiry: number;
  paymentHash: Uint8Array;
}): string {
  const ts = wordsTo5(opts.timestamp, 7);
  const hashWords = [...bech32.toWords(opts.paymentHash)];
  const expWords = wordsTo5(opts.expiry, 3);
  const tagged = [
    1,
    (hashWords.length >> 5) & 31,
    hashWords.length & 31,
    ...hashWords,
    6,
    (expWords.length >> 5) & 31,
    expWords.length & 31,
    ...expWords,
  ];
  const sig = new Array(104).fill(1);
  const words = [...ts, ...tagged, ...sig];
  return bech32.encode(opts.hrp as `${string}`, words, 2500);
}

const hash = new Uint8Array(32).fill(7);
const now = Math.floor(Date.now() / 1000);

console.log("arkade LN invoice preflight\n");

{
  try {
    toArkadeLnInvoiceFacts("not-an-invoice", "mainnet");
    assert("garbage throws", false);
  } catch (e) {
    assert(
      "garbage unparseable",
      e instanceof LnInvoiceRejected && e.reason === "unparseable",
    );
  }
}

{
  const inv = craftBolt11({
    hrp: "lnbc2500u",
    timestamp: now - 60,
    expiry: 3600,
    paymentHash: hash,
  });
  const facts = toArkadeLnInvoiceFacts(inv, "mainnet", now);
  assert("mainnet lnbc amount 250000", facts.amountSats === 250_000);
  assert("payment hash present", facts.paymentHash.length === 64);
  assert("coin network bc", facts.coinNetwork === "bc");
  try {
    toArkadeLnInvoiceFacts(inv, "mutinynet", now);
    assert("lnbc rejected on mutinynet", false);
  } catch (e) {
    assert(
      "lnbc rejected on mutinynet",
      e instanceof LnInvoiceRejected && e.reason === "wrong_network",
    );
  }
}

{
  const inv = craftBolt11({
    hrp: "lntbs500n",
    timestamp: now - 10,
    expiry: 600,
    paymentHash: hash,
  });
  const facts = toArkadeLnInvoiceFacts(inv, "mutinynet", now);
  assert("mutinynet lntbs amount 50", facts.amountSats === 50);
  try {
    toArkadeLnInvoiceFacts(inv, "mainnet", now);
    assert("lntbs rejected on mainnet", false);
  } catch (e) {
    assert(
      "lntbs rejected on mainnet",
      e instanceof LnInvoiceRejected && e.reason === "wrong_network",
    );
  }
}

{
  const inv = craftBolt11({
    hrp: "lnbc2500u",
    timestamp: now - 10_000,
    expiry: 60,
    paymentHash: hash,
  });
  try {
    toArkadeLnInvoiceFacts(inv, "mainnet", now);
    assert("expired invoice refused", false);
  } catch (e) {
    assert(
      "expired invoice refused",
      e instanceof LnInvoiceRejected && e.reason === "expired",
    );
  }
}

{
  const inv = craftBolt11({
    hrp: "lnbc",
    timestamp: now - 10,
    expiry: 3600,
    paymentHash: hash,
  });
  try {
    toArkadeLnInvoiceFacts(inv, "mainnet", now);
    assert("zero-amount refused", false);
  } catch (e) {
    assert(
      "zero-amount refused",
      e instanceof LnInvoiceRejected && e.reason === "zero_amount",
    );
  }
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
