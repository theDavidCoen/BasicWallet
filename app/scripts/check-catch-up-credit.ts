/**
 * Scenario checks for catchUpCredit (α89.1).
 * Run: npx tsx scripts/check-catch-up-credit.ts
 */
import {
  addCatchUpCredit,
  consumeCatchUpCredit,
  settleCatchUpCredit,
  CATCH_UP_SETTLED_TTL_MS,
  type CatchUpCredit,
} from "../src/wallet/catchUpCredit";

let failed = 0;

function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(a: number, b: number) {
  return Math.abs(a - b) <= 0;
}

console.log("catchUpCredit scenarios\n");

// --- B1: single payment, non-zero baseline ---
{
  console.log("1) single payment non-zero baseline (5000+800)");
  let c: CatchUpCredit | null = null;
  c = addCatchUpCredit(c, 800, { now: 0, noticeSettled: false });
  c = settleCatchUpCredit(c, 800);
  assert("settledSats 800", eq(c?.settledSats ?? -1, 800));
  const r = consumeCatchUpCredit(c, 800, { now: 109_000 });
  assert("applyAmount 0", eq(r.applyAmount, 0));
  assert("consume 800", eq(r.consumed, 800));
  assert("skip toast (settled covers)", r.noticeSettled === true);
  assert("credit cleared", r.credit === null);
}

// --- B4 / S8: split no-repeat toast ---
{
  console.log("\n2) split no-repeat (1300 settled → notify 800 then 500)");
  let c: CatchUpCredit | null = addCatchUpCredit(null, 1300, {
    now: 0,
    noticeSettled: false,
  });
  c = settleCatchUpCredit(c, 1300);
  const r1 = consumeCatchUpCredit(c, 800, { now: 1_000 });
  assert("first apply 0", eq(r1.applyAmount, 0), `got ${r1.applyAmount}`);
  assert("first skip toast (settled covers)", r1.noticeSettled === true);
  assert("left 500", eq(r1.credit?.sats ?? -1, 500));
  assert("settled left 500", eq(r1.credit?.settledSats ?? -1, 500));
  const r2 = consumeCatchUpCredit(r1.credit, 500, { now: 2_000 });
  assert("second apply 0", eq(r2.applyAmount, 0));
  assert("second skip toast", r2.noticeSettled === true);
  assert("cleared", r2.credit === null);
}

// --- B4 / S8: overwrite — A's notify must not re-toast ---
{
  console.log("\n3) overwrite before notify (A settled, B added)");
  let c: CatchUpCredit | null = addCatchUpCredit(null, 800, {
    now: 0,
    noticeSettled: true,
  });
  assert("A settledSats 800", eq(c?.settledSats ?? -1, 800));
  c = addCatchUpCredit(c, 500, { now: 10_000, noticeSettled: false });
  assert("budget 1300", eq(c?.sats ?? -1, 1300));
  assert("settledSats still 800", eq(c?.settledSats ?? -1, 800));
  const r1 = consumeCatchUpCredit(c, 800, { now: 109_000 });
  assert("notify 800 apply 0", eq(r1.applyAmount, 0));
  assert("notify 800 skip toast (A settled)", r1.noticeSettled === true);
  assert("left 500", eq(r1.credit?.sats ?? -1, 500));
  const r2 = consumeCatchUpCredit(r1.credit, 500, { now: 110_000 });
  assert("notify 500 apply 0", eq(r2.applyAmount, 0));
  assert("notify 500 toast (B not settled)", r2.noticeSettled === false);
}

// --- late notify 109s and >120s ---
{
  console.log("\n4) late notify 109s and 125s (no balance TTL pin)");
  let c: CatchUpCredit | null = addCatchUpCredit(null, 800, {
    now: 0,
    noticeSettled: true,
  });
  const r109 = consumeCatchUpCredit(c, 800, { now: 109_000 });
  assert("109s apply 0", eq(r109.applyAmount, 0));
  assert("109s skip toast", r109.noticeSettled === true);
  c = addCatchUpCredit(null, 800, { now: 0, noticeSettled: true });
  const r125 = consumeCatchUpCredit(c, 800, { now: 125_000 });
  assert("125s apply 0", eq(r125.applyAmount, 0));
  assert("125s skip toast", r125.noticeSettled === true);
}

// --- duplicate / noticeAlready (no adopt → no credit) ---
{
  console.log("\n5) duplicate/cooldown (no adopt → notify applies full)");
  const r = consumeCatchUpCredit(null, 800, { now: 0 });
  assert("apply full 800", eq(r.applyAmount, 800));
  assert("no settled", r.noticeSettled === false);
}

// --- different-amount payment (min-consume; settled covers → skip toast) ---
{
  console.log("\n6) different-amount payment (credit 800 settled, notify 500)");
  let c: CatchUpCredit | null = addCatchUpCredit(null, 800, {
    now: 0,
    noticeSettled: true,
  });
  const r = consumeCatchUpCredit(c, 500, { now: 1_000 });
  assert("apply 0 (min consume)", eq(r.applyAmount, 0));
  assert("skip toast (settled covers consume)", r.noticeSettled === true);
  assert("left 300", eq(r.credit?.sats ?? -1, 300));
}

// --- S6: stale same-amount after swallowed notify + settled TTL ---
{
  console.log("\n7) stale same-amount: settled TTL drops toast inherit, keeps budget");
  let c: CatchUpCredit | null = addCatchUpCredit(null, 800, {
    now: 0,
    noticeSettled: true,
  });
  const r = consumeCatchUpCredit(c, 800, {
    now: CATCH_UP_SETTLED_TTL_MS + 1,
  });
  assert("still apply 0", eq(r.applyAmount, 0));
  assert("toast after settled TTL", r.noticeSettled === false);
  assert("credit cleared", r.credit === null);
}

// --- clear (wallet switch / send) ---
{
  console.log("\n8) wallet switch / send clears (null credit)");
  const r = consumeCatchUpCredit(null, 800, { now: 0 });
  assert("apply full after clear", eq(r.applyAmount, 800));
}

// --- amount larger than credit (N11: must toast for the new remainder) ---
{
  console.log("\n9) notify larger than credit (credit 500 settled, notify 800)");
  let c: CatchUpCredit | null = addCatchUpCredit(null, 500, {
    now: 0,
    noticeSettled: true,
  });
  const r = consumeCatchUpCredit(c, 800, { now: 1_000 });
  assert("apply remainder 300", eq(r.applyAmount, 300));
  assert("toast for new money (applyAmount > 0)", r.noticeSettled === false);
  assert("credit cleared", r.credit === null);
}

// --- N10 helper: exact match flag for post-send-change gate ---
{
  console.log("\n9b) exact match vs partial (post-send-change gate)");
  let c: CatchUpCredit | null = addCatchUpCredit(null, 800, {
    now: 0,
    noticeSettled: true,
  });
  const exact = Math.abs(800 - (c?.sats ?? 0)) <= 2;
  const partial = Math.abs(500 - (c?.sats ?? 0)) <= 2;
  assert("800 is exact on credit 800", exact === true);
  assert("500 is not exact on credit 800", partial === false);
}

// --- both chat races settle partial amounts against combined budget ---
{
  console.log("\n10) settle(800)+settle(500) on budget 1300 — both notifies skip toast");
  let c: CatchUpCredit | null = addCatchUpCredit(null, 800, { now: 0 });
  c = addCatchUpCredit(c, 500, { now: 1_000 });
  c = settleCatchUpCredit(c, 800);
  c = settleCatchUpCredit(c, 500);
  assert("settledSats 1300", eq(c?.settledSats ?? -1, 1300));
  const r1 = consumeCatchUpCredit(c, 800, { now: 109_000 });
  assert("800 skip toast", r1.noticeSettled === true);
  const r2 = consumeCatchUpCredit(r1.credit, 500, { now: 110_000 });
  assert("500 skip toast", r2.noticeSettled === true);
  assert("cleared", r2.credit === null);
}

console.log(failed === 0 ? "\nAll scenarios passed." : `\n${failed} scenario(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
