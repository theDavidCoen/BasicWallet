/**
 * Activity refresh + wallet-switch baseline scenarios (α91 Xiaomi).
 * Run: npx tsx scripts/check-activity-refresh.ts
 */
import {
  ACTIVITY_HISTORY_BUDGET_MS,
  ACTIVITY_REMATERIALIZE_COOL_MS,
  filterUnmatchedLocalReceives,
  isWalletCoolingDown,
  matchOptimisticReceive,
  previousBalanceForWallet,
  remainingHistoryBudgetMs,
  shouldCommitWalletWork,
  shouldFetchVtxoFallback,
  shouldRecordOptimisticReceive,
  switchHomeBalance,
} from "../src/wallet/activityRefresh";

let failed = 0;

function assert(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("activityRefresh scenarios\n");

{
  console.log("1) catch-up receive → record once");
  const d = shouldRecordOptimisticReceive({
    amountSats: 1900,
    source: "catch-up",
    isOwnChange: false,
  });
  assert("record catch-up 1900", d.record === true, d.reason);
  const existing = [
    { id: "local-recv:1", amount: 1900, createdAt: 1_000 },
  ];
  const again = matchOptimisticReceive(existing, {
    amountSats: 1900,
    now: 2_000,
    source: "catch-up",
  });
  assert("second catch-up dedupes", again === "local-recv:1");
}

{
  console.log("\n2) history merge after optimistic → no dup");
  const local = [
    { id: "local-recv:1", amount: 1900, createdAt: 5_000, arkTxid: "" },
  ];
  const history = [
    { id: "aabbccdd".repeat(8).slice(0, 64), amount: 1900, createdAt: 5_100 },
  ];
  const keep = filterUnmatchedLocalReceives(local, history);
  assert("drop local-recv once SDK has same amount", keep.length === 0);
  const unmatched = filterUnmatchedLocalReceives(
    [{ id: "local-recv:2", amount: 500, createdAt: 1_000, arkTxid: "" }],
    history,
  );
  assert("keep unmatched other amount", unmatched.length === 1);
}

{
  console.log("\n3) notify credit then catch-up same amount → one row");
  const afterNotify = matchOptimisticReceive(
    [{ id: "local-recv:n", amount: 1900, createdAt: 10_000 }],
    { amountSats: 1900, now: 12_000, source: "funds-notice" },
  );
  assert("catch-up finds notify row", afterNotify === "local-recv:n");
  const secondNotify = matchOptimisticReceive(
    [{ id: "local-recv:n", amount: 500, createdAt: 10_000 }],
    { amountSats: 500, now: 11_000, source: "notify-credit" },
  );
  assert("S7 second notify 500 not amount-deduped", secondNotify === null);
}

{
  console.log("\n4) late materialize after switch / timeout ignored");
  assert(
    "switch drops other wallet",
    shouldCommitWalletWork({
      startedWalletId: "w_mutqs3",
      currentWalletId: "w_pk_i_0",
      startedGen: 1,
      currentGen: 1,
    }) === false,
  );
  assert(
    "timeout bumps gen",
    shouldCommitWalletWork({
      startedWalletId: "w_mutqs3",
      currentWalletId: "w_mutqs3",
      startedGen: 1,
      currentGen: 2,
    }) === false,
  );
  assert(
    "same wallet+gen commits",
    shouldCommitWalletWork({
      startedWalletId: "w_mutqs3",
      currentWalletId: "w_mutqs3",
      startedGen: 3,
      currentGen: 3,
    }) === true,
  );
}

{
  console.log("\n5) switch Home shows new wallet ack/cache, never previous");
  const shown = switchHomeBalance({
    cached: { total: 0, available: 0, boarding: 0 },
    ack: { total: 0, available: 0, boarding: 0 },
  });
  assert("empty child shows 0 not 6795", shown.total === 0);
  const fromAck = switchHomeBalance({
    cached: { total: 0, available: 0, boarding: 0 },
    ack: { total: 8695, available: 8695, boarding: 0 },
  });
  assert("prefer ack when cache empty", fromAck.total === 8695);
  const kept = previousBalanceForWallet(
    { total: 6795 },
    "w_mutqs3",
    "w_pk_i_0",
  );
  assert("keeping previous does not cross wallets", kept === null);
  const same = previousBalanceForWallet(
    { total: 6795 },
    "w_mutqs3",
    "w_mutqs3",
  );
  assert("same wallet may keep previous", same?.total === 6795);
}

{
  console.log("\n6) change never gets a receive row");
  for (const source of ["notify-skip-change", "home-post-send", "change-hold"] as const) {
    const d = shouldRecordOptimisticReceive({
      amountSats: 1200,
      source,
      isOwnChange: true,
    });
    assert(`${source} skip`, d.record === false);
  }
  const persistChange = shouldRecordOptimisticReceive({
    amountSats: 1200,
    source: "persist-adopt",
    isOwnChange: true,
  });
  assert("persist change skip", persistChange.record === false);
  const persistInbound = shouldRecordOptimisticReceive({
    amountSats: 1900,
    source: "persist-adopt",
    isOwnChange: false,
  });
  assert("persist real inbound after home-post-send records", persistInbound.record === true);
}

{
  console.log("\n7) per-wallet cooldown");
  const until = { w_mutqs3: 60_000 };
  assert(
    "A cooling",
    isWalletCoolingDown(until, "w_mutqs3", 10_000) === true,
  );
  assert(
    "B not cooling",
    isWalletCoolingDown(until, "w_pk_i_0", 10_000) === false,
  );
  assert(
    "A after cool",
    isWalletCoolingDown(until, "w_mutqs3", 60_000 + ACTIVITY_REMATERIALIZE_COOL_MS) === false,
  );
}

{
  console.log("\n8) history budget — no two serialized 10s calls");
  const start = 0;
  assert("full budget", remainingHistoryBudgetMs(start, 0) === ACTIVITY_HISTORY_BUDGET_MS);
  assert("after 8s", remainingHistoryBudgetMs(start, 8_000) === 2_000);
  assert("spent", remainingHistoryBudgetMs(start, 10_000) === 0);
  assert(
    "no vtxos after timeout",
    shouldFetchVtxoFallback({ rowCount: 0, remainingMs: 0 }) === false,
  );
  assert(
    "vtxos if empty + leftover",
    shouldFetchVtxoFallback({ rowCount: 0, remainingMs: 2_000 }) === true,
  );
  assert(
    "skip vtxos when history is thick",
    shouldFetchVtxoFallback({ rowCount: 11, remainingMs: 8_000 }) === false,
  );
}

if (failed > 0) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nAll activityRefresh checks passed.");
