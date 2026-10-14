import assert from "node:assert/strict";
import {
  BOT_WORKING_ACK,
  formatWorkingAckStatus,
  isBotWorkingAckBody,
  localBotTurnId,
  nextPollIntervalMs,
  takePendingLocalTurn,
  type PendingLocalTurn,
} from "./botLatencyHelpers";

assert.equal(localBotTurnId("m_abc"), "local:m_abc");

assert.equal(isBotWorkingAckBody(BOT_WORKING_ACK), true);
assert.equal(isBotWorkingAckBody(`${BOT_WORKING_ACK} RUNNING`), true);
assert.equal(isBotWorkingAckBody(`${BOT_WORKING_ACK} Cursor is working…`), true);
assert.equal(isBotWorkingAckBody("Working stopped"), false);
assert.equal(isBotWorkingAckBody(null), false);

assert.equal(formatWorkingAckStatus("CREATING"), `${BOT_WORKING_ACK} Creating…`);
assert.equal(
  formatWorkingAckStatus("RUNNING"),
  `${BOT_WORKING_ACK} Cursor is working…`,
);
assert.ok(isBotWorkingAckBody(formatWorkingAckStatus("RUNNING")));

assert.equal(nextPollIntervalMs(0), 800);
assert.equal(nextPollIntervalMs(14_999), 800);
assert.equal(nextPollIntervalMs(15_000), 1_500);
assert.equal(nextPollIntervalMs(44_999), 1_500);
assert.equal(nextPollIntervalMs(45_000), 2_500);
assert.equal(nextPollIntervalMs(0, 2_500), 2_500, "fixed interval wins");

const now = Date.now();
const nowSec = Math.floor(now / 1000);
const turns: PendingLocalTurn[] = [
  { localId: "m1", body: "ciao", at: now },
];

const stale = takePendingLocalTurn(turns, {
  body: "ciao",
  wrapCreatedAtSec: nowSec - 600,
  now,
});
assert.equal(stale, null, "stale wrap does not take pending");
assert.equal(turns.length, 1, "pending preserved after stale miss");

const fresh = takePendingLocalTurn(turns, {
  body: "ciao",
  wrapCreatedAtSec: nowSec,
  now,
});
assert.ok(fresh);
assert.equal(fresh?.localId, "m1");
assert.equal(turns.length, 0);

assert.equal(
  takePendingLocalTurn(turns, { body: "ciao", wrapCreatedAtSec: nowSec, now }),
  null,
  "empty pending → null",
);

console.log("botLatencyHelpers.test.ts: ok");
