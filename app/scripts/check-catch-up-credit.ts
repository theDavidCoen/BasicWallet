/**
 * Scenario checks for catchUpCredit (α89.1 re-review a322376).
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
  const r = consumeCatchUpCredit(c, 800, { now: 109_000 });
  assert("applyAmount 0", eq(r.applyAmount, 0));
  assert("consume 800", eq(r.consumed, 800));
  assert("skip toast (settled exact)", r.noticeSettled === true);
  assert("credit cleared", r.credit === null);
}

// --- B4: two payments in one poll ---
{
  console.log("\n2) two payments in one poll (1300 → notify 800 then 500)");
  let c: CatchUpCredit | null = addCatchUpCredit(null, 1300, {
    now: 0,
    noticeSettled: false,
  });
  c = settleCatchUpCredit(c, 1300);
  const r1 = consumeCatchUpCredit(c, 800, { now: 1_000 });
  assert("first apply 0", eq(r1.applyAmount, 0), `got ${r1.applyAmount}`);
  assert("first no settled inherit (not exact)", r1.noticeSettled === false);
  assert("left 500", eq(r1.credit?.sats ?? -1, 500));
  const r2 = consumeCatchUpCredit(r1.credit, 500, { now: 2_000 });
  assert("second apply 0", eq(r2.applyAmount, 0));
  assert("second settled exact", r2.noticeSettled === true);
  assert("cleared", r2.credit === null);
}

// --- B4: overwrite before notify ---
{
  console.log("\n3) overwrite before notify (800 then +500, notify 800 then 500)");
  let c: CatchUpCredit | null = addCatchUpCredit(null, 800, {
    now: 0,
    noticeSettled: true,
  });
  c = addCatchUpCredit(c, 500, { now: 10_000, noticeSettled: false });
  assert("budget 1300", eq(c?.sats ?? -1, 1300));
  assert("settled kept", c?.noticeSettled === true);
  const r1 = consumeCatchUpCredit(c, 800, { now: 20_000 });
  assert("notify 800 apply 0", eq(r1.applyAmount, 0));
  assert("notify 800 toast (not exact)", r1.noticeSettled === false);
  const r2 = consumeCatchUpCredit(r1.credit, 500, { now: 21_000 });
  assert("notify 500 apply 0", eq(r2.applyAmount, 0));
  assert("notify 500 skip toast", r2.noticeSettled === true);
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

// --- different-amount payment ---
{
  console.log("\n6) different-amount payment (credit 800, notify 500)");
  let c: CatchUpCredit | null = addCatchUpCredit(null, 800, {
    now: 0,
    noticeSettled: true,
  });
  const r = consumeCatchUpCredit(c, 500, { now: 1_000 });
  assert("apply 0 (min consume)", eq(r.applyAmount, 0));
  assert("toast (not exact)", r.noticeSettled === false);
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

// --- amount larger than credit ---
{
  console.log("\n9) notify larger than credit (credit 500, notify 800)");
  let c: CatchUpCredit | null = addCatchUpCredit(null, 500, {
    now: 0,
    noticeSettled: true,
  });
  const r = consumeCatchUpCredit(c, 800, { now: 1_000 });
  assert("apply remainder 300", eq(r.applyAmount, 300));
  assert("no settled inherit", r.noticeSettled === false);
  assert("credit cleared", r.credit === null);
}

console.log(failed === 0 ? "\nAll scenarios passed." : `\n${failed} scenario(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
