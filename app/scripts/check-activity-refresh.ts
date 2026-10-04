/**
 * Activity refresh + wallet-switch baseline scenarios (α91 Xiaomi).
 * Run: npx tsx scripts/check-activity-refresh.ts
 */
import {
  ACTIVITY_HISTORY_BUDGET_MS,
  ACTIVITY_REMATERIALIZE_COOL_MS,
  CATCH_UP_LOCAL_MAX_AGE_MS,
  CATCH_UP_RECEIVE_TAG,
  coalesceActivityRefresh,
  filterUnmatchedLocalReceives,
  isWalletCoolingDown,
  matchOptimisticReceive,
  outboundSpendTarget,
  persistSpendBreakdown,
  previousBalanceForWallet,
  remainingHistoryBudgetMs,
  shouldBumpMaterializeGenOnFailure,
  shouldCommitWalletWork,
  shouldDropCatchUpLocalReceive,
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

{
  console.log("\n9) catch-up while away — history minutes/hours earlier");
  const rowAt = 36 * 60_000;
  const local = [
    {
      id: "local-recv:away",
      amount: 1900,
      createdAt: rowAt,
      arkTxid: "",
      tags: [CATCH_UP_RECEIVE_TAG],
    },
  ];
  const history = [
    {
      id: "aabbccdd".repeat(8).slice(0, 64),
      amount: 1900,
      createdAt: rowAt - 36 * 60_000,
    },
  ];
  const naive = filterUnmatchedLocalReceives(local, history);
  assert("120s window would keep phantom", naive.length === 1);
  const dropped = filterUnmatchedLocalReceives(local, history, {
    historySucceeded: true,
    historyFetchStartedAt: rowAt + 1_000,
    now: rowAt + 2_000,
  });
  assert("successful later history drops catch-up", dropped.length === 0);
  const inFlight = filterUnmatchedLocalReceives(local, history, {
    historySucceeded: true,
    historyFetchStartedAt: rowAt - 5_000,
    now: rowAt + 2_000,
  });
  assert("fetch started before row is kept (until next)", inFlight.length === 1);
}

{
  console.log("\n10) 500+700 in one catch-up → one +1200 placeholder");
  const local = [
    {
      id: "local-recv:sum",
      amount: 1200,
      createdAt: 10_000,
      arkTxid: "",
      tags: [CATCH_UP_RECEIVE_TAG],
    },
  ];
  const history = [
    { id: "aa".repeat(32), amount: 500, createdAt: 1_000 },
    { id: "bb".repeat(32), amount: 700, createdAt: 2_000 },
  ];
  const kept = filterUnmatchedLocalReceives(local, history, {
    historySucceeded: true,
    historyFetchStartedAt: 11_000,
    now: 12_000,
  });
  assert("summed catch-up drops once history lands", kept.length === 0);
}

{
  console.log("\n11) ack-0 first open whole-balance phantom");
  const local = [
    {
      id: "local-recv:ack0",
      amount: 6795,
      createdAt: 50_000,
      arkTxid: "",
      tags: [CATCH_UP_RECEIVE_TAG],
    },
  ];
  const history = [
    { id: "cc".repeat(32), amount: 6795, createdAt: 1_000 },
  ];
  const kept = filterUnmatchedLocalReceives(local, history, {
    historySucceeded: true,
    historyFetchStartedAt: 51_000,
    now: 52_000,
  });
  assert("ack-0 whole-balance catch-up drops", kept.length === 0);
  assert(
    "age backstop drops catch-up",
    shouldDropCatchUpLocalReceive({
      createdAt: 1_000,
      historySucceeded: false,
      now: 1_000 + CATCH_UP_LOCAL_MAX_AGE_MS + 1,
    }) === true,
  );
}

{
  console.log("\n12) shown then notify same funds — narrow dedupe");
  const shown = [
    {
      id: "local-recv:shown",
      amount: 1900,
      createdAt: 20_000,
      arkTxid: "",
      tags: [CATCH_UP_RECEIVE_TAG],
    },
  ];
  const notify = matchOptimisticReceive(shown, {
    amountSats: 1900,
    now: 20_000 + 15_000,
    source: "notify-credit",
  });
  assert("notify-credit dedupes catch-up shown row", notify === "local-recv:shown");
  const late = matchOptimisticReceive(shown, {
    amountSats: 1900,
    now: 20_000 + 61_000,
    source: "notify-credit",
  });
  assert("notify-credit after 60s not amount-deduped", late === null);
  const s7 = matchOptimisticReceive(
    [{ id: "local-recv:n", amount: 500, createdAt: 10_000 }],
    { amountSats: 500, now: 11_000, source: "notify-credit" },
  );
  assert("S7 two notify 500s still distinct", s7 === null);
}

{
  console.log("\n13) refreshActivity coalesce + timeout gen");
  assert(
    "same wallet joins in-flight",
    coalesceActivityRefresh({
      inFlightWalletId: "w_mutqs3",
      requestedWalletId: "w_mutqs3",
    }) === "join",
  );
  assert(
    "other wallet starts new",
    coalesceActivityRefresh({
      inFlightWalletId: "w_mutqs3",
      requestedWalletId: "w_pk_i_0",
    }) === "start",
  );
  assert(
    "timeout bumps only newest gen",
    shouldBumpMaterializeGenOnFailure({ startedGen: 4, currentGen: 4 }) === true,
  );
  assert(
    "older timeout does not bump newer gen",
    shouldBumpMaterializeGenOnFailure({ startedGen: 3, currentGen: 4 }) === false,
  );
}

{
  console.log("\n14) outbound spend binds to send wallet, not current");
  assert(
    "still on sender → Home",
    outboundSpendTarget({
      outboundWalletId: "w_a",
      currentWalletId: "w_a",
    }) === "apply-home",
  );
  assert(
    "switched away → persist foreign, do not block",
    outboundSpendTarget({
      outboundWalletId: "w_a",
      currentWalletId: "w_b",
    }) === "persist-foreign",
  );
  const next = persistSpendBreakdown({
    preSend: { available: 5000, boarding: 0, total: 5000 },
    spendSats: 800,
  });
  assert("foreign persist is sender minus spend", next.total === 4200);
}

if (failed > 0) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nAll activityRefresh checks passed.");
