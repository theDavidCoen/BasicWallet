/**
 * Scenario checks for catchUpCredit (α89.1).
 * Run: npx tsx scripts/check-catch-up-credit.ts
 */
import {
  addCatchUpCredit,
  consumeCatchUpCredit,
  settleCatchUpCredit,
  getCatchUpCreditForWallet,
  setCatchUpCreditForWallet,
  seedPollAdoptCatchUpCredit,
  CATCH_UP_EXACT_MATCH_TTL_MS,
  CATCH_UP_SETTLED_TTL_MS,
  type CatchUpCredit,
  type CatchUpCreditByWallet,
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

{
  console.log("\n11) per-wallet credit survives switch (not cleared globally)");
  const byWallet: CatchUpCreditByWallet = {};
  setCatchUpCreditForWallet(
    byWallet,
    "w_a",
    addCatchUpCredit(null, 800, { now: 0, noticeSettled: true }),
  );
  setCatchUpCreditForWallet(
    byWallet,
    "w_b",
    addCatchUpCredit(null, 500, { now: 1_000, noticeSettled: false }),
  );
  assert("A still 800 after B adopt", eq(getCatchUpCreditForWallet(byWallet, "w_a")?.sats ?? -1, 800));
  assert("B has 500", eq(getCatchUpCreditForWallet(byWallet, "w_b")?.sats ?? -1, 500));
  setCatchUpCreditForWallet(byWallet, "w_b", null);
  assert("clearing B leaves A", eq(getCatchUpCreditForWallet(byWallet, "w_a")?.sats ?? -1, 800));
  assert("B gone", getCatchUpCreditForWallet(byWallet, "w_b") === null);
}

{
  console.log("\n12) shown exact-match: same amount within TTL → one toast path");
  const c = addCatchUpCredit(null, 800, {
    now: 0,
    noticeSettled: true,
    exactMatchOnly: true,
    exactMatchTtlMs: CATCH_UP_EXACT_MATCH_TTL_MS,
  });
  const same = consumeCatchUpCredit(c, 800, { now: 60_000 });
  assert("exact 800 apply 0", eq(same.applyAmount, 0));
  assert("exact 800 skip toast", same.noticeSettled === true);
  assert("exact 800 cleared", same.credit === null);
}

{
  console.log("\n13) catch-up 1900 must not swallow later notify 800");
  // Catch-up-while-away no longer seeds; if a stale exact 1900 were present,
  // a different amount must still apply fully.
  const stale = addCatchUpCredit(null, 1900, {
    now: 0,
    noticeSettled: true,
    exactMatchOnly: true,
    exactMatchTtlMs: CATCH_UP_EXACT_MATCH_TTL_MS,
  });
  const later = consumeCatchUpCredit(stale, 800, { now: 60_000 });
  assert("different amount apply full 800", eq(later.applyAmount, 800));
  assert("different amount toast", later.noticeSettled === false);
  assert("different amount leaves exact credit", eq(later.credit?.sats ?? -1, 1900));
  const expired = consumeCatchUpCredit(stale, 800, {
    now: CATCH_UP_EXACT_MATCH_TTL_MS + 1,
  });
  assert("expired exact apply full", eq(expired.applyAmount, 800));
  assert("expired exact cleared", expired.credit === null);
  // No seed at all (catch-up-while-away):
  const none = consumeCatchUpCredit(null, 800, { now: 0 });
  assert("no credit apply full 800", eq(none.applyAmount, 800));
}

{
  console.log("\n14) α95 Xiaomi: poll-adopt +2911 then notify must not double Home");
  // Poll home/notify adopted UI to 9495 (delta 2911) without raising ack.
  let c = seedPollAdoptCatchUpCredit(null, 2911, { now: 0, noticeSettled: true });
  assert("seeded 2911", eq(c?.sats ?? -1, 2911));
  // Second path (already-on-screen) must not stack another 2911.
  c = seedPollAdoptCatchUpCredit(c, 2911, { now: 1_000, noticeSettled: true });
  assert("re-seed same amount stays 2911", eq(c?.sats ?? -1, 2911));
  const notify = consumeCatchUpCredit(c, 2911, { now: 60_000 });
  assert("notify apply 0 (no double)", eq(notify.applyAmount, 0));
  assert("notify consumes seed", notify.consumed === 2911 || eq(notify.consumed, 2911));
  assert("credit cleared", notify.credit === null);
  // Simulated Home: start 6584 → poll to 9495 → notify must stay 9495.
  const homeAfterPoll = 6584 + 2911;
  const homeAfterNotify = homeAfterPoll + notify.applyAmount;
  assert("Home stays 9495", eq(homeAfterNotify, 9495));
  assert("Home not 12406", !eq(homeAfterNotify, 12406));
}

console.log(failed === 0 ? "\nAll scenarios passed." : `\n${failed} scenario(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
