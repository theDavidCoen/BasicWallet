/**
 * Unified BIP21 encode: optional lightning= for amounted POS/BIP21 requests.
 * Run: npx tsx scripts/check-bip21-receive.ts
 */
import { encodeReceiveBip21 } from "../src/wallet/bip21Receive";

let failed = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("BIP21 receive lightning=\n");

{
  const uri = encodeReceiveBip21("bc1qtestboarding", "ark1testaddr", null, 2320);
  assert(
    "amounted bip21 without ln has no lightning=",
    Boolean(uri && !/lightning=/i.test(uri ?? "")),
  );
  assert("amounted bip21 has amount", Boolean(uri && /amount=/i.test(uri ?? "")));
}

{
  const inv = "lnbc2320n1pqexampleinvoice";
  const uri = encodeReceiveBip21("bc1qtestboarding", "ark1testaddr", inv, 2320);
  assert(
    "amounted bip21 embeds lightning=",
    Boolean(uri && /lightning=/i.test(uri ?? "") && uri.includes("lnbc2320n1pqexampleinvoice")),
  );
  assert("unified uri starts bitcoin:", Boolean(uri?.toLowerCase().startsWith("bitcoin:")));
}

{
  const uri = encodeReceiveBip21("bc1qtestboarding", "ark1testaddr", null);
  assert("no-amount bip21 has no lightning=", Boolean(uri && !/lightning=/i.test(uri ?? "")));
  assert(
    "no-amount bip21 has no amount=",
    Boolean(uri && !/[?&]amount=/i.test(uri ?? "")),
  );
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
