/**
 * Provider-level post-send persist scenarios (α90 review cases + H2).
 * Run: npx tsx scripts/check-post-send-balance-guard.ts
 */
import {
  CHANGE_HOLD_MAX_MS,
  decidePostSendInbound,
  decidePostSendPersist,
  selectedVtxoSum,
  type PostSendPersistInput,
} from "../src/wallet/postSendBalanceGuard";

let failed = 0;

function assert(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

type Sim = {
  now: number;
  suppressUntil: number;
  holdUntil: number;
  preSend: number | null;
  localSpend: number | null;
  optimistic: number | null;
  selected: number | null;
  home: number;
  ack: number;
};

function persistInput(s: Sim, live: number, extra?: Partial<PostSendPersistInput>): PostSendPersistInput {
  return {
    now: s.now,
    suppressUntil: s.suppressUntil,
    holdUntil: s.holdUntil,
    preSendTotal: s.preSend,
    localSpend: s.localSpend,
    optimisticTotal: s.optimistic,
    selectedVtxoTotal: s.selected,
    liveTotal: live,
    ackTotal: s.ack,
    displayedTotal: s.home,
    ...extra,
  };
}

function applySpend(s: Sim, spend: number, selected?: number | null) {
  s.localSpend = (s.localSpend ?? 0) + spend;
  s.optimistic = s.home - spend;
  s.home = s.optimistic;
  s.ack = s.optimistic;
  s.holdUntil = s.now + CHANGE_HOLD_MAX_MS;
  if (selected != null) s.selected = selected;
}

function poll(s: Sim, live: number, extra?: Partial<PostSendPersistInput>) {
  const d = decidePostSendPersist(persistInput(s, live, extra));
  if (d.adoptLive) s.home = live;
  if (d.writeAck && d.ackTotal != null) s.ack = d.ackTotal;
  return d;
}

const PRE = 8695;
const AMOUNT = 1000;
const SELECTED = 2126;
const LIVE_NO_CHANGE = PRE - SELECTED; // 6569
const OPT = PRE - AMOUNT; // 7695

console.log("postSendBalanceGuard provider scenarios\n");

{
  console.log("1) H2 8695/1000/2126 — hold pending-change, inbound notice +1000");
  const s: Sim = {
    now: 0,
    suppressUntil: 300_000,
    holdUntil: 0,
    preSend: PRE,
    localSpend: null,
    optimistic: null,
    selected: SELECTED,
    home: PRE,
    ack: PRE,
  };
  applySpend(s, AMOUNT, SELECTED);
  assert("optimistic Home 7695", s.home === OPT);
  const d1 = poll(s, LIVE_NO_CHANGE);
  assert("holds 6569 as change-pending", d1.reason === "change-pending" && !d1.adoptLive);
  assert("Home stays 7695", s.home === OPT);
  assert("ack stays 7695", s.ack === OPT);

  const inbound = decidePostSendInbound({
    now: s.now,
    suppressUntil: s.suppressUntil,
    holdUntil: s.holdUntil,
    preSendTotal: s.preSend,
    localSpend: s.localSpend,
    optimisticTotal: s.optimistic,
    selectedVtxoTotal: s.selected,
    liveTotal: LIVE_NO_CHANGE + 1000, // 7569
    ackTotal: s.ack,
    notifyAmount: 1000,
    expectingReceive: true,
  });
  assert(
    "Receive inbound credits +1000 not negative/combined",
    inbound.action === "credit" && inbound.credit === 1000,
    JSON.stringify(inbound),
  );
  s.home += inbound.credit;
  s.ack += inbound.credit;
  assert("Home after inbound 8695", s.home === PRE);

  const changeNotify = decidePostSendInbound({
    now: s.now,
    suppressUntil: s.suppressUntil,
    holdUntil: s.holdUntil,
    preSendTotal: s.preSend,
    localSpend: s.localSpend,
    optimisticTotal: s.optimistic,
    selectedVtxoTotal: s.selected,
    liveTotal: PRE,
    ackTotal: s.ack,
    notifyAmount: 1126,
    expectingReceive: true,
  });
  assert(
    "change does not toast as receive",
    changeNotify.action === "skip-change" && changeNotify.credit === 0,
    JSON.stringify(changeNotify),
  );

  const both = decidePostSendPersist(persistInput(s, PRE));
  assert(
    "poll after inbound+change adopts 8695",
    both.adoptLive && both.homeTotal === PRE,
    JSON.stringify(both),
  );
}

{
  console.log("\n2) failed-but-spent send — no applyLocalSpend, adopt live");
  const s: Sim = {
    now: 1_000,
    suppressUntil: 301_000,
    holdUntil: 0,
    preSend: PRE,
    localSpend: null,
    optimistic: null,
    selected: SELECTED,
    home: PRE,
    ack: PRE,
  };
  const d = poll(s, OPT);
  assert("no-local-spend adopt", d.reason === "no-local-spend" && d.adoptLive);
  assert("Home 7695 not pinned 8695", s.home === OPT);
  assert("ack lowered", s.ack === OPT);
  s.now = 400_000;
  const later = poll(s, OPT);
  assert("after guard not floor-pinned", !later.floorPinned && later.adoptLive);
}

{
  console.log("\n3) Fiat Enter — beginOutboundSend only, adopt dust live");
  const s: Sim = {
    now: 0,
    suppressUntil: 300_000,
    holdUntil: 0,
    preSend: PRE,
    localSpend: null,
    optimistic: null,
    selected: null,
    home: PRE,
    ack: PRE,
  };
  const d = poll(s, 330, { fiatMode: true });
  assert("no-local-spend adopt dust", d.reason === "no-local-spend" && d.adoptLive);
  assert("Home 330", s.home === 330);
  assert("ack 330", s.ack === 330);
}

{
  console.log("\n4) fee not in applyLocalSpend — hold then expiry lowers ack");
  const s: Sim = {
    now: 0,
    suppressUntil: 300_000,
    holdUntil: 0,
    preSend: PRE,
    localSpend: null,
    optimistic: null,
    selected: SELECTED,
    home: PRE,
    ack: PRE,
  };
  applySpend(s, AMOUNT, SELECTED);
  const feeLive = OPT - 50;
  const during = poll(s, feeLive);
  assert("fee held as change-pending during window", during.reason === "change-pending");
  assert("Home still 7695 during hold", s.home === OPT);
  s.now = CHANGE_HOLD_MAX_MS + 1;
  const expired = poll(s, feeLive);
  assert("expiry reason hold-expired", expired.reason === "hold-expired", expired.reason);
  assert("skipFloorPin", expired.skipFloorPin);
  assert("Home adopts fee-depressed live", s.home === feeLive);
  assert("ack lowered to live (not pinned)", s.ack === feeLive);
}

{
  console.log("\n5) inbound during hold on Receive (change still pending)");
  const inbound = decidePostSendInbound({
    now: 1_000,
    suppressUntil: 300_000,
    holdUntil: 1_000 + CHANGE_HOLD_MAX_MS,
    preSendTotal: PRE,
    localSpend: AMOUNT,
    optimisticTotal: OPT,
    selectedVtxoTotal: SELECTED,
    liveTotal: LIVE_NO_CHANGE,
    ackTotal: OPT,
    notifyAmount: 1000,
    expectingReceive: true,
  });
  assert("does not skip with no-net-credit", inbound.action === "credit");
  assert("credit is +1000 not −126", inbound.credit === 1000, JSON.stringify(inbound));

  const homeIn = decidePostSendInbound({
    now: 1_000,
    suppressUntil: 300_000,
    holdUntil: 1_000 + CHANGE_HOLD_MAX_MS,
    preSendTotal: PRE,
    localSpend: AMOUNT,
    optimisticTotal: OPT,
    selectedVtxoTotal: SELECTED,
    liveTotal: LIVE_NO_CHANGE + 1000,
    ackTotal: OPT,
    notifyAmount: 1000,
    expectingReceive: false,
  });
  assert(
    "Home inbound during hold still credits +1000",
    homeIn.action === "credit" && homeIn.credit === 1000,
    JSON.stringify(homeIn),
  );
}

{
  console.log("\n6) guard expiry — adopt live, floor cannot pin");
  const s: Sim = {
    now: CHANGE_HOLD_MAX_MS + 5_000,
    suppressUntil: 300_000,
    holdUntil: CHANGE_HOLD_MAX_MS,
    preSend: PRE,
    localSpend: AMOUNT,
    optimistic: OPT,
    selected: SELECTED,
    home: OPT,
    ack: OPT,
  };
  const stillSuppressed = poll(s, LIVE_NO_CHANGE);
  assert("at 80s still suppressed: hold-expired", stillSuppressed.reason === "hold-expired");
  assert("Home 6569", s.home === LIVE_NO_CHANGE);
  assert("ack 6569", s.ack === LIVE_NO_CHANGE);

  s.now = 310_000;
  const after = poll(s, LIVE_NO_CHANGE);
  assert("after 5m not floor-pinned", !after.floorPinned, after.reason);
  assert("Home stays 6569", s.home === LIVE_NO_CHANGE);
}

{
  console.log("\n7) change never arriving — expiry releases optimistic pin");
  const s: Sim = {
    now: 0,
    suppressUntil: 300_000,
    holdUntil: 0,
    preSend: PRE,
    localSpend: null,
    optimistic: null,
    selected: SELECTED,
    home: PRE,
    ack: PRE,
  };
  applySpend(s, AMOUNT, SELECTED);
  poll(s, LIVE_NO_CHANGE);
  assert("held while waiting", s.home === OPT);
  s.now = CHANGE_HOLD_MAX_MS + 1;
  poll(s, LIVE_NO_CHANGE);
  assert("released to live 6569", s.home === LIVE_NO_CHANGE && s.ack === LIVE_NO_CHANGE);
}

{
  console.log("\n8) below pending-change bound — adopt immediately");
  const s: Sim = {
    now: 0,
    suppressUntil: 300_000,
    holdUntil: 0,
    preSend: PRE,
    localSpend: null,
    optimistic: null,
    selected: SELECTED,
    home: PRE,
    ack: PRE,
  };
  applySpend(s, AMOUNT, SELECTED);
  const d = poll(s, 4000);
  assert("below-change-bound", d.reason === "below-change-bound" && d.adoptLive, d.reason);
  assert("Home 4000", s.home === 4000);
}

{
  console.log("\n9) stale pre-send indexer still kept (α86)");
  const s: Sim = {
    now: 0,
    suppressUntil: 300_000,
    holdUntil: 0,
    preSend: PRE,
    localSpend: null,
    optimistic: null,
    selected: SELECTED,
    home: PRE,
    ack: PRE,
  };
  applySpend(s, AMOUNT, SELECTED);
  const d = poll(s, PRE);
  assert("stale-presend keep", d.reason === "stale-presend" && !d.adoptLive);
  assert("Home 7695", s.home === OPT);
}

{
  console.log("\n10) change settled — live ≥ optimistic, adopt");
  const s: Sim = {
    now: 0,
    suppressUntil: 300_000,
    holdUntil: 0,
    preSend: PRE,
    localSpend: null,
    optimistic: null,
    selected: SELECTED,
    home: PRE,
    ack: PRE,
  };
  applySpend(s, AMOUNT, SELECTED);
  const d = poll(s, OPT);
  assert("aligned adopt", d.reason === "aligned-or-above" && d.adoptLive);
}

{
  console.log("\n11) N3: without expiry release, floor would pin (legacy)");
  const pinned = decidePostSendPersist({
    now: 310_000,
    suppressUntil: 300_000,
    holdUntil: 300_000,
    preSendTotal: PRE,
    localSpend: AMOUNT,
    optimisticTotal: OPT,
    selectedVtxoTotal: SELECTED,
    liveTotal: LIVE_NO_CHANGE,
    ackTotal: OPT,
    displayedTotal: OPT,
  });
  // holdUntil == suppressUntil and now past both → hold-expired + skipFloorPin
  assert(
    "current helper at 310s with holdUntil=300s still skip-pin",
    pinned.reason === "hold-expired" && pinned.skipFloorPin && !pinned.floorPinned,
    JSON.stringify(pinned),
  );
  const wouldPin = decidePostSendPersist({
    now: 310_000,
    suppressUntil: 0,
    holdUntil: 0,
    preSendTotal: PRE,
    localSpend: null,
    optimisticTotal: null,
    selectedVtxoTotal: null,
    liveTotal: LIVE_NO_CHANGE,
    ackTotal: OPT,
    displayedTotal: OPT,
  });
  assert(
    "floor pins only when no expiry release and ack still high",
    wouldPin.floorPinned && wouldPin.reason === "floor-pin",
    JSON.stringify(wouldPin),
  );
}

{
  console.log("\n12) selectedVtxoSum");
  assert("sum 2126", selectedVtxoSum([{ value: 2126 }]) === 2126);
  assert("empty null", selectedVtxoSum([]) == null);
}

{
  console.log("\n13) live repro spend-drop 7358 with selected 1337");
  const s: Sim = {
    now: 0,
    suppressUntil: 300_000,
    holdUntil: 0,
    preSend: PRE,
    localSpend: null,
    optimistic: null,
    selected: 8695 - 7358, // 1337 remaining-unindexed = selected
    home: PRE,
    ack: PRE,
  };
  applySpend(s, AMOUNT, s.selected);
  const d = poll(s, 7358);
  assert("change-pending 7358", d.reason === "change-pending" && s.home === OPT, d.reason);
}

{
  console.log("\n14) S4 change at 90s alone on Receive — no +1126 toast");
  const inbound = decidePostSendInbound({
    now: 90_000,
    suppressUntil: 300_000,
    holdUntil: CHANGE_HOLD_MAX_MS,
    preSendTotal: PRE,
    localSpend: AMOUNT,
    optimisticTotal: OPT,
    selectedVtxoTotal: SELECTED,
    liveTotal: OPT,
    ackTotal: LIVE_NO_CHANGE,
    notifyAmount: 1126,
    expectingReceive: true,
  });
  assert(
    "skip change after 75s hold",
    inbound.action === "skip-change" && inbound.credit === 0,
    JSON.stringify(inbound),
  );
}

{
  console.log("\n15) S4 change at 90s + 1000 return on Receive — toast +1000 not +2126");
  const inbound = decidePostSendInbound({
    now: 90_000,
    suppressUntil: 300_000,
    holdUntil: CHANGE_HOLD_MAX_MS,
    preSendTotal: PRE,
    localSpend: AMOUNT,
    optimisticTotal: OPT,
    selectedVtxoTotal: SELECTED,
    liveTotal: PRE,
    ackTotal: LIVE_NO_CHANGE,
    notifyAmount: 2126,
    expectingReceive: true,
  });
  assert(
    "credits inbound only vs optimistic",
    inbound.action === "credit" && inbound.credit === 1000,
    JSON.stringify(inbound),
  );
}

{
  console.log("\n16) S5 inbound on Home inside the 5m guard — ack capped at optimistic");
  const s: Sim = {
    now: 0,
    suppressUntil: 300_000,
    holdUntil: 0,
    preSend: PRE,
    localSpend: null,
    optimistic: null,
    selected: SELECTED,
    home: PRE,
    ack: PRE,
  };
  applySpend(s, AMOUNT, SELECTED);
  const homeNotify = decidePostSendInbound({
    now: 10_000,
    suppressUntil: s.suppressUntil,
    holdUntil: s.holdUntil,
    preSendTotal: s.preSend,
    localSpend: s.localSpend,
    optimisticTotal: s.optimistic,
    selectedVtxoTotal: s.selected,
    liveTotal: PRE,
    ackTotal: s.ack,
    notifyAmount: 1000,
    expectingReceive: false,
  });
  assert(
    "Home inbound credits +1000 not skipped",
    homeNotify.action === "credit" && homeNotify.credit === 1000,
    JSON.stringify(homeNotify),
  );
  s.home += homeNotify.credit;
  s.ack += homeNotify.credit;
  s.now = CHANGE_HOLD_MAX_MS + 15_000;
  const d = poll(s, PRE);
  assert("Home stays 8695 after credit", s.home === PRE, `home ${s.home}`);
  assert("ack already 8695 — no leftover toast", s.ack === PRE, `ack ${s.ack}`);
  assert("duplicate persist does not re-raise", d.ackTotal === PRE || d.ackTotal === OPT);
}

{
  console.log("\n16b) S5 persist without notify — ack capped, leftover +1000");
  const s: Sim = {
    now: 0,
    suppressUntil: 300_000,
    holdUntil: 0,
    preSend: PRE,
    localSpend: null,
    optimistic: null,
    selected: SELECTED,
    home: PRE,
    ack: PRE,
  };
  applySpend(s, AMOUNT, SELECTED);
  s.now = CHANGE_HOLD_MAX_MS + 15_000;
  const d = poll(s, PRE);
  assert("Home adopts 8695", s.home === PRE);
  assert("ack capped at 7695", s.ack === OPT, `ack ${s.ack}`);
  assert("leftover +1000", s.home - s.ack === 1000);
  assert("writeAck", d.writeAck);
}

{
  console.log("\n17) Xiaomi 8695/800/selected 2000 / live 8232 — do not adopt the gap");
  // Capture 19:09:12 persistBalance live 8232 = optimistic 7895 + 337.
  // This wallet's earlier 1000 send had spend-drop pending change 337
  // (avail 7358 = 8695 − 1000 − 337). This log only proves +337 above
  // optimistic, not that 337 is leftover from that send.
  const s: Sim = {
    now: 0,
    suppressUntil: 300_000,
    holdUntil: 0,
    preSend: 8695,
    localSpend: null,
    optimistic: null,
    selected: 2000,
    home: 8695,
    ack: 8695,
  };
  applySpend(s, 800, 2000);
  assert("optimistic 7895", s.home === 7895);
  const before = decidePostSendPersist(
    persistInput(s, 8232),
  );
  // Pre-fix this was aligned-or-above (live > optimistic). Must hold now.
  assert(
    "holds 8232 as between-optimistic-and-presend",
    before.adoptLive === false &&
      before.reason === "between-optimistic-and-presend",
    JSON.stringify(before),
  );
  const d = poll(s, 8232);
  assert("Home stays 7895", s.home === 7895, `home ${s.home} reason ${d.reason}`);
  assert("ack stays 7895", s.ack === 7895);
  const settled = poll(s, 7895);
  assert("then aligned 7895", settled.reason === "aligned-or-above" && s.home === 7895);
}

{
  console.log("\n18) inbound 500 during hold, change still pending");
  const s: Sim = {
    now: 0,
    suppressUntil: 300_000,
    holdUntil: 0,
    preSend: 8695,
    localSpend: null,
    optimistic: null,
    selected: 2000,
    home: 8695,
    ack: 8695,
  };
  applySpend(s, 800, 2000);
  poll(s, 6695);
  assert("held at 7895 pending change", s.home === 7895);
  const inbound = decidePostSendInbound({
    now: 1_000,
    suppressUntil: s.suppressUntil,
    holdUntil: s.holdUntil,
    preSendTotal: s.preSend,
    localSpend: s.localSpend,
    optimisticTotal: s.optimistic,
    selectedVtxoTotal: s.selected,
    liveTotal: 6695 + 500,
    ackTotal: s.ack,
    notifyAmount: 500,
    expectingReceive: true,
  });
  assert("credits +500", inbound.action === "credit" && inbound.credit === 500, JSON.stringify(inbound));
  s.home += inbound.credit;
  s.ack += inbound.credit;
  assert("Home 8395 (optimistic+inbound)", s.home === 8395);
  poll(s, 6695 + 500);
  assert("persist does not snap back to 7895", s.home === 8395);
  const dup = decidePostSendInbound({
    now: 2_000,
    suppressUntil: s.suppressUntil,
    holdUntil: s.holdUntil,
    preSendTotal: s.preSend,
    localSpend: s.localSpend,
    optimisticTotal: s.optimistic,
    selectedVtxoTotal: s.selected,
    liveTotal: 6695 + 500,
    ackTotal: s.ack,
    notifyAmount: 500,
    expectingReceive: true,
  });
  assert("duplicate notify no second credit", dup.credit === 0, JSON.stringify(dup));
  poll(s, 8395);
  assert("change settled, Home stays 8395", s.home === 8395);
}

{
  console.log("\n19) inbound 500 during hold, change already settled");
  const s: Sim = {
    now: 0,
    suppressUntil: 300_000,
    holdUntil: 0,
    preSend: 8695,
    localSpend: null,
    optimistic: null,
    selected: 2000,
    home: 8695,
    ack: 8695,
  };
  applySpend(s, 800, 2000);
  poll(s, 7895);
  assert("aligned 7895", s.home === 7895);
  const gap = poll(s, 8395);
  assert(
    "persist holds 8395 in the gap",
    gap.reason === "between-optimistic-and-presend" && s.home === 7895,
    gap.reason,
  );
  const inbound = decidePostSendInbound({
    now: 1_000,
    suppressUntil: s.suppressUntil,
    holdUntil: s.holdUntil,
    preSendTotal: s.preSend,
    localSpend: s.localSpend,
    optimisticTotal: s.optimistic,
    selectedVtxoTotal: s.selected,
    liveTotal: 8395,
    ackTotal: s.ack,
    notifyAmount: 500,
    expectingReceive: true,
  });
  assert("credits +500", inbound.action === "credit" && inbound.credit === 500, JSON.stringify(inbound));
  s.home += inbound.credit;
  s.ack += inbound.credit;
  assert("Home 8395", s.home === 8395);
  const dup = decidePostSendInbound({
    now: 2_000,
    suppressUntil: s.suppressUntil,
    holdUntil: s.holdUntil,
    preSendTotal: s.preSend,
    localSpend: s.localSpend,
    optimisticTotal: s.optimistic,
    selectedVtxoTotal: s.selected,
    liveTotal: 8395,
    ackTotal: s.ack,
    notifyAmount: 500,
    expectingReceive: true,
  });
  assert("no double credit", dup.credit === 0, JSON.stringify(dup));
  poll(s, 8395);
  assert("persist leaves 8395", s.home === 8395);
}

console.log(failed === 0 ? "\nAll scenarios passed." : `\n${failed} scenario(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
