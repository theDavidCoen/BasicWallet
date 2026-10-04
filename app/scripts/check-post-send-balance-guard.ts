/**
 * Post-send change-pending adopt (H2 / 8695→6569 / +2126).
 * Run: npx tsx scripts/check-post-send-balance-guard.ts
 */
import {
  decidePostSendLiveAdopt,
  inboundNoticeDelta,
  legacyDecidePostSendLiveAdopt,
  shouldWriteAckFromLive,
} from "../src/wallet/postSendBalanceGuard";

let failed = 0;

function assert(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("postSendBalanceGuard scenarios\n");

const PRE = 8695;
const AMOUNT = 1000;
const OPT = PRE - AMOUNT; // 7695 after applyLocalSpend

// --- David's first-run shape: spent vtxo 2126, change 1126 pending ---
{
  console.log("1) 8695/1000/2126 — live = preSend − spentVtxos while suppressed");
  const live = PRE - 2126; // 6569
  const legacy = legacyDecidePostSendLiveAdopt({
    suppressed: true,
    preSendTotal: PRE,
    liveTotal: live,
    optimisticTotal: OPT,
    ackTotal: OPT,
  });
  const next = decidePostSendLiveAdopt({
    suppressed: true,
    preSendTotal: PRE,
    liveTotal: live,
    optimisticTotal: OPT,
    ackTotal: OPT,
  });
  assert("legacy would adopt (bug)", legacy.adoptLive === true, JSON.stringify(legacy));
  assert("fix keeps optimistic (change-pending)", next.adoptLive === false && next.reason === "change-pending");
  assert(
    "must not lower ack to 6569",
    shouldWriteAckFromLive({ suppressed: true, liveTotal: live, ackTotal: OPT }) === false,
  );
  const heldOptimistic = OPT;
  const afterReturn = PRE; // 8695 after +1000 back
  const notice = inboundNoticeDelta({
    optimisticAfterSend: heldOptimistic,
    liveAfterReturn: afterReturn,
  });
  assert("return notice is +1000 not +2126", notice === 1000, `got ${notice}`);
  const buggyNotice = afterReturn - live; // if Home adopted 6569
  assert("buggy path would toast +2126", buggyNotice === 2126);
}

// --- Live repro spend-drop shape: 7358 = 8695 − 1000 − 337 ---
{
  console.log("\n2) live repro spend-drop 7358 (change 337 pending)");
  const live = 7358;
  const legacy = legacyDecidePostSendLiveAdopt({
    suppressed: true,
    preSendTotal: PRE,
    liveTotal: live,
    optimisticTotal: OPT,
    ackTotal: OPT,
  });
  const next = decidePostSendLiveAdopt({
    suppressed: true,
    preSendTotal: PRE,
    liveTotal: live,
    optimisticTotal: OPT,
    ackTotal: OPT,
  });
  assert("legacy would adopt 7358", legacy.adoptLive === true);
  assert("fix keeps 7695", next.adoptLive === false && next.reason === "change-pending");
}

// --- stale pre-send indexer ---
{
  console.log("\n3) live still ≈ preSend — keep optimistic (α86)");
  const next = decidePostSendLiveAdopt({
    suppressed: true,
    preSendTotal: PRE,
    liveTotal: PRE,
    optimisticTotal: OPT,
    ackTotal: OPT,
  });
  assert("stale-presend keep", next.adoptLive === false && next.reason === "stale-presend");
}

// --- change settled: live matches optimistic ---
{
  console.log("\n4) change settled — live ≈ optimistic — adopt ok");
  const next = decidePostSendLiveAdopt({
    suppressed: true,
    preSendTotal: PRE,
    liveTotal: OPT,
    optimisticTotal: OPT,
    ackTotal: OPT,
  });
  assert("aligned adopt", next.adoptLive === true && next.reason === "aligned-or-above");
}

// --- not suppressed ---
{
  console.log("\n5) guard expired — adopt live");
  const next = decidePostSendLiveAdopt({
    suppressed: false,
    preSendTotal: PRE,
    liveTotal: 6569,
    optimisticTotal: OPT,
    ackTotal: OPT,
  });
  assert("not-suppressed adopt", next.adoptLive === true);
}

console.log(failed === 0 ? "\nAll scenarios passed." : `\n${failed} scenario(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
