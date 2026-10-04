/**
 * Scenario checks for chat pay already-settled skip (α93 Xiaomi 2000).
 */
import {
  activityRowMatchesOutboundBubble,
  pickAlreadySettledOutbound,
  shouldRecordChatPayOptimisticActivity,
} from "../src/chat/chatPaySettle";

let failed = 0;
function assert(name: string, cond: boolean) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    console.log(`  FAIL  ${name}`);
    failed += 1;
  }
}

console.log("chatPaySettle scenarios\n");

{
  console.log("1) Xiaomi α92: new bubble must not match historical −2000");
  const now = 1_700_000_000_000;
  const bubbleAt = now - 2_000;
  const history = {
    id: "efacb59027737560deadbeef",
    amount: -2000,
    createdAt: now - 10 * 60_000,
    tags: ["arkade"],
  };
  assert(
    "history predates bubble → no activity match",
    activityRowMatchesOutboundBubble({
      amountSats: 2000,
      bubbleCreatedAt: bubbleAt,
      now,
      row: history,
    }) === false,
  );
  const picked = pickAlreadySettledOutbound({
    amountSats: 2000,
    contactId: "c1",
    excludeMessageId: "m_new",
    now,
    candidates: [
      {
        id: "m_new",
        contactId: "c1",
        amountSats: 2000,
        createdAt: bubbleAt,
        paymentId: "pay1",
        status: "sending",
      },
    ],
    activityRows: [history],
    pendingStampAt: null,
  });
  assert("exclude new bubble → do not skip (send must run)", picked === null);
}

{
  console.log("\n2) α69 retry: failed bubble + activity after bubble → skip");
  const now = 1_700_000_000_000;
  const bubbleAt = now - 60_000;
  const settled = {
    id: "txidsettled0001",
    amount: -2000,
    createdAt: bubbleAt + 5_000,
    tags: ["arkade"],
  };
  assert(
    "activity after bubble matches",
    activityRowMatchesOutboundBubble({
      amountSats: 2000,
      bubbleCreatedAt: bubbleAt,
      now,
      row: settled,
    }) === true,
  );
  const picked = pickAlreadySettledOutbound({
    amountSats: 2000,
    contactId: "c1",
    excludeMessageId: "m_retry_new",
    now,
    candidates: [
      {
        id: "m_fail",
        contactId: "c1",
        amountSats: 2000,
        createdAt: bubbleAt,
        paymentId: "pay_old",
        status: "failed",
      },
      {
        id: "m_retry_new",
        contactId: "c1",
        amountSats: 2000,
        createdAt: now - 1_000,
        paymentId: "pay_new",
        status: "sending",
      },
    ],
    activityRows: [settled],
    pendingStampAt: null,
  });
  assert("skips via prior failed bubble", picked?.messageId === "m_fail");
  assert("txid from activity", picked?.txid === "txidsettled0001");
}

{
  console.log("\n3) error recovery prefers local message");
  const now = 1_700_000_000_000;
  const bubbleAt = now - 30_000;
  const settled = {
    id: "txidhang0001",
    amount: -500,
    createdAt: bubbleAt + 8_000,
    tags: ["arkade"],
  };
  const picked = pickAlreadySettledOutbound({
    amountSats: 500,
    contactId: "c1",
    preferMessageId: "m_cur",
    now,
    candidates: [
      {
        id: "m_cur",
        contactId: "c1",
        amountSats: 500,
        createdAt: bubbleAt,
        paymentId: "pay_cur",
        status: "sending",
      },
    ],
    activityRows: [settled],
    pendingStampAt: null,
  });
  assert("prefer current → skip", picked?.messageId === "m_cur");
}

{
  console.log("\n4) pending stamp only if at/after bubble");
  const now = 1_700_000_000_000;
  const bubbleAt = now - 10_000;
  const stalePending = pickAlreadySettledOutbound({
    amountSats: 800,
    contactId: "c1",
    excludeMessageId: "m_new",
    now,
    candidates: [
      {
        id: "m_fail",
        contactId: "c1",
        amountSats: 800,
        createdAt: bubbleAt,
        paymentId: null,
        status: "failed",
      },
    ],
    activityRows: [],
    pendingStampAt: bubbleAt - 60_000,
  });
  assert("stale pending does not skip", stalePending === null);
  const okPending = pickAlreadySettledOutbound({
    amountSats: 800,
    contactId: "c1",
    excludeMessageId: "m_new",
    now,
    candidates: [
      {
        id: "m_fail",
        contactId: "c1",
        amountSats: 800,
        createdAt: bubbleAt,
        paymentId: null,
        status: "failed",
      },
    ],
    activityRows: [],
    pendingStampAt: bubbleAt + 1_000,
  });
  assert("fresh pending skips", okPending?.messageId === "m_fail");
}

{
  console.log("\n5) converting without activity stays open");
  const now = 1_700_000_000_000;
  const picked = pickAlreadySettledOutbound({
    amountSats: 1000,
    contactId: "c1",
    now,
    candidates: [
      {
        id: "m_conv",
        contactId: "c1",
        amountSats: 1000,
        createdAt: now - 5_000,
        paymentId: "pay",
        status: "converting",
      },
    ],
    activityRows: [],
    pendingStampAt: now - 4_000,
  });
  assert("converting + pending only → no skip", picked === null);
}

{
  console.log("\n6) α94: optimistic Activity only when spend applied");
  assert(
    "real chat send → record optimistic",
    shouldRecordChatPayOptimisticActivity({}) === true,
  );
  assert(
    "skipLocalSpend undefined → record",
    shouldRecordChatPayOptimisticActivity({ skipLocalSpend: false }) === true,
  );
  assert(
    "already-settled / prior hang → no optimistic",
    shouldRecordChatPayOptimisticActivity({ skipLocalSpend: true }) === false,
  );
}

if (failed > 0) {
  console.error(`\n${failed} chatPaySettle check(s) failed`);
  process.exit(1);
}
console.log("\nAll chatPaySettle checks passed.");
