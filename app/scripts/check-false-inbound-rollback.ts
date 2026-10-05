/**
 * Scenario checks for false inbound ASP spike rollback (Xiaomi +998/−998).
 * Run: npx tsx scripts/check-false-inbound-rollback.ts
 */
import {
  decideFalseInboundRollback,
  FALSE_INBOUND_ROLLBACK_MS,
  type FalseInboundRollbackInput,
} from "../src/wallet/falseInboundRollback";

let failed = 0;

function assert(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function base(
  over: Partial<FalseInboundRollbackInput> = {},
): FalseInboundRollbackInput {
  return {
    now: 30_000,
    liveTotal: 9495,
    ackTotal: 10493,
    noticeAmount: 998,
    noticeAt: 2_000,
    noticeKind: "arkade",
    catchUpCreditSats: 998,
    notifyFloor: 10493,
    persistAdoptAmount: 998,
    persistAdoptAt: 1_000,
    awaitingRecv: false,
    windowMs: FALSE_INBOUND_ROLLBACK_MS,
    ...over,
  };
}

console.log("falseInboundRollback scenarios\n");

{
  console.log("1) Xiaomi false +998 then −998 (notice-reverse)");
  const r = decideFalseInboundRollback(base());
  assert("rollback", r.rollback);
  assert("healAck", r.healAck);
  assert("dismissNotice", r.dismissNotice);
  assert("clearCatchUpCredit", r.clearCatchUpCredit);
  assert("dropOptimistic", r.dropOptimistic);
  assert("amount 998", r.amount === 998);
  assert("reason notice-reverse", r.reason === "notice-reverse");
}

{
  console.log("2) persist-adopt reverse without notice yet");
  const r = decideFalseInboundRollback(
    base({
      noticeAmount: null,
      noticeAt: null,
      noticeKind: null,
      catchUpCreditSats: null,
      notifyFloor: null,
    }),
  );
  assert("rollback", r.rollback);
  assert("reason persist-adopt-reverse", r.reason === "persist-adopt-reverse");
}

{
  console.log("3) credit-only reverse (notice aged out)");
  const r = decideFalseInboundRollback(
    base({
      noticeAmount: null,
      noticeAt: null,
      noticeKind: null,
      persistAdoptAmount: null,
      persistAdoptAt: null,
      notifyFloor: null,
      catchUpCreditSats: 998,
    }),
  );
  assert("rollback", r.rollback);
  assert("reason credit-reverse", r.reason === "credit-reverse");
}

{
  console.log("4) floor-reverse when notice/credit cleared");
  const r = decideFalseInboundRollback(
    base({
      noticeAmount: null,
      noticeAt: null,
      noticeKind: null,
      persistAdoptAmount: null,
      persistAdoptAt: null,
      catchUpCreditSats: null,
      notifyFloor: 10493,
    }),
  );
  assert("rollback", r.rollback);
  assert("reason floor-reverse", r.reason === "floor-reverse");
}

{
  console.log("5) no rollback when live already matches ack");
  const r = decideFalseInboundRollback(
    base({ liveTotal: 10493, ackTotal: 10493 }),
  );
  assert("no rollback", !r.rollback);
  assert("reason none", r.reason === "none");
}

{
  console.log("6) no rollback when reverse amount mismatches notice");
  const r = decideFalseInboundRollback(
    base({
      noticeAmount: 500,
      persistAdoptAmount: null,
      persistAdoptAt: null,
      catchUpCreditSats: null,
      notifyFloor: null,
    }),
  );
  assert("no rollback", !r.rollback);
}

{
  console.log("7) stale notice outside window");
  const r = decideFalseInboundRollback(
    base({
      now: FALSE_INBOUND_ROLLBACK_MS + 50_000,
      noticeAt: 1_000,
      persistAdoptAmount: null,
      persistAdoptAt: null,
      catchUpCreditSats: null,
      notifyFloor: null,
    }),
  );
  assert("no rollback", !r.rollback);
}

{
  console.log("8) real higher balance is not a reverse");
  const r = decideFalseInboundRollback(
    base({ liveTotal: 12000, ackTotal: 10493 }),
  );
  assert("no rollback", !r.rollback);
}

console.log(
  failed === 0 ? "\nAll scenarios passed." : `\n${failed} scenario(s) failed.`,
);
process.exit(failed === 0 ? 0 : 1);
