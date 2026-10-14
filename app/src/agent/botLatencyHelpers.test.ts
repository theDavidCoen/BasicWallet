import assert from "node:assert/strict";
import {
  BOT_WORKING_ACK,
  BRIDGE_EVENT_WINDOW_MS,
  formatWorkingAckStatus,
  findRecentLocalTurn,
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
const turns: PendingLocalTurn[] = [
  { localId: "m1", body: "buy €10 Amazon gift card", at: now },
];

// Simulate NIP-59 wrap.created_at (random up to 2 days back) — must NOT be used.
// Bridge must use envelope/rumor time instead.
const nip59FakeWrapMs = now - 36 * 3600 * 1000;
assert.ok(
  Math.abs(nip59FakeWrapMs - now) > BRIDGE_EVENT_WINDOW_MS,
  "precondition: fake wrap time outside window",
);

const withEnvelopeTime = takePendingLocalTurn(turns, {
  body: "buy €10 Amazon gift card",
  eventTimeMs: now - 500, // envelope.sentAt ≈ local send
  now,
});
assert.ok(withEnvelopeTime, "envelope/rumor time bridges");
assert.equal(withEnvelopeTime?.localId, "m1");
assert.equal(turns.length, 0);

turns.push({ localId: "m2", body: "ciao", at: now });
assert.equal(
  takePendingLocalTurn(turns, {
    body: "ciao",
    eventTimeMs: nip59FakeWrapMs, // wrong: wrap.created_at style
    now,
  }),
  null,
  "randomized wrap-like timestamp must not bridge",
);
assert.equal(turns.length, 1, "pending preserved after bad eventTime");
assert.ok(findRecentLocalTurn(turns, { body: "ciao", now }));

const bridged = takePendingLocalTurn(turns, {
  body: "ciao",
  eventTimeMs: now,
  now,
});
assert.ok(bridged);
assert.equal(turns.length, 0);

console.log("botLatencyHelpers.test.ts: ok");
