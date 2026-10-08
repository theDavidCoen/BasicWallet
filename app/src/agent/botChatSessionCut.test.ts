import assert from "node:assert/strict";
import { CURSOR_BOT_CONTACT_ID } from "./botConstants";
import { shouldSkipBotThreadIngest } from "./botChatSessionCut";

const cut = 1_700_000_000_000;

assert.equal(
  shouldSkipBotThreadIngest({
    contactId: "c_human",
    ignoreBeforeMs: cut,
    sentAtMs: cut - 1,
  }),
  false,
  "human thread never skipped",
);

assert.equal(
  shouldSkipBotThreadIngest({
    contactId: CURSOR_BOT_CONTACT_ID,
    ignoreBeforeMs: 0,
    sentAtMs: cut - 1,
  }),
  false,
  "no cut → do not skip",
);

assert.equal(
  shouldSkipBotThreadIngest({
    contactId: CURSOR_BOT_CONTACT_ID,
    ignoreBeforeMs: cut,
    sentAtMs: cut - 1,
  }),
  true,
  "bot + sentAt before cut → skip",
);

assert.equal(
  shouldSkipBotThreadIngest({
    contactId: CURSOR_BOT_CONTACT_ID,
    ignoreBeforeMs: cut,
    sentAtMs: cut + 5_000,
  }),
  false,
  "bot + sentAt after cut → keep",
);

assert.equal(
  shouldSkipBotThreadIngest({
    contactId: CURSOR_BOT_CONTACT_ID,
    ignoreBeforeMs: cut,
    wrapCreatedAtSec: Math.floor((cut - 60_000) / 1000),
    sentAtMs: cut + 5_000,
  }),
  true,
  "wrap created_at wins over newer sentAt",
);

assert.equal(
  shouldSkipBotThreadIngest({
    contactId: CURSOR_BOT_CONTACT_ID,
    ignoreBeforeMs: cut,
    wrapCreatedAtSec: Math.floor((cut + 1_000) / 1000),
  }),
  false,
  "new wrap after cut → keep",
);

console.log("botChatSessionCut.test.ts: ok");
