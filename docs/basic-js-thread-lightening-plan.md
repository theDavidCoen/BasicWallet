# Basic Wallet — JS-thread lightening plan (no WASM)

Grounded in `main` @ `257ae12` (post #38). Companion analysis: Project Agent Store `internal/basic-js-thread-lag.md` (Basic JS-thread lag).

Goal: keep taps / sheets / Home fluid on Xiaomi by reducing JS-thread contention. No Arkade WASM required for steps 1–8.

**Measure first (every PR):** extend `app/src/home/homeTourPerf.ts` (or add `app/src/diagnostics/jsThreadMarkers.ts`) with:

- `tap→firstPaint` ms (Activity row, wallet avatar, Scan/POS open)
- optional JS FPS during sheet pan (existing tour probe pattern)

Acceptance baseline: capture on Xiaomi `INBIJVCASW5HS4YX` before step 1, then after each shipped step.

---

## Step 1 — Freeze poll `setState` during pan / sheet / tour

### Current code

| Piece | Path |
|-------|------|
| Tour already skips rate/ASP `setState` | `HomeScreen.tsx` (`tourOpenRef`, `[HomeTourRates] poll skip`) |
| Tour UI open flag | `home/useHomeTourUiOpen.ts`, `setHomeTourUiOpen` |
| Sheet open signals | `SheetHost.tsx` → `activityOpen`, `posOpen`, `scanOpen`, `walletOpen` |
| Home pan locks | `HomeScreen.tsx` `sidesLocked` / `homeDragging` |
| Balance poll `setState` | `WalletProvider.tsx` interval ~L3387–3413, `refreshBalance*` |
| ASP pause API (send path) | `pauseAspPolls` / `resumeAspPolls` / `setPosUiHold` |

### Implementation

1. Add `app/src/runtime/uiBusyGate.ts` (module-level):

   - `beginUiBusy(reason)`, `endUiBusy(reason)`, `isUiBusy()`
   - depth counter + optional grace 100–200 ms after last end (sheet spring settle)

2. Wire **begin** when:

   - Home pan starts (Activity/POS/Scan drag) — next to `sidesLocked.value = 1`
   - `SheetHost` opens Activity / POS / Scan / Wallets (`open*` / settle)
   - Tour open (`setHomeTourUiOpen(true)` / existing tour path)

3. Wire **end** on dismiss / pan cancel / tour dismiss; then call existing “refresh on dismiss” paths (`refreshHomeSpotRatesNow("dismiss")`, one `refreshBalanceOnly`).

4. Gate **React state updates** (not the network call itself, or both):

   - `WalletProvider`: before `setBalance` / notice adopt from poll tick — if `isUiBusy()`, stash pending snapshot in a ref, apply on `endUiBusy`
   - `HomeScreen`: ASP/rates intervals — skip `setMutinynetOnline` / `setFiatRates` when busy (mirror tour)

### UX / risks

- Balance/footer can lag 1–2 s during drag; must flush on dismiss.
- Do not freeze `notifyIncomingFunds` apply forever — either queue notice or allow apply with no Home footer churn.

### Acceptance

- Pan Activity sheet on Xiaomi: no balance/rate React updates mid-pan (log gate hits).
- On dismiss: one coalesced refresh; no stuck stale balance >3 s.
- Tour still freezes as today; no regression on Skip/Next taps.

---

## Step 2 — Single Home scheduler (replace N timers)

### Current code

| Timer | Path |
|-------|------|
| Balance `setInterval` | `WalletProvider.tsx` (`BALANCE_POLL_MS` 4s / boost / fallback) |
| Spot rates `setInterval` | `HomeScreen.tsx` ~L469–496 |
| ASP / Mutinynet probe `setInterval` | `HomeScreen.tsx` `ASP_POLL_MS` 15s ~L514–534 |
| Chat unread | `subscribeChatStore` (event-driven; keep) |

### Implementation

1. Add `app/src/home/homeIdleScheduler.ts`:

   - One `setInterval` (1 s tick) or `requestAnimationFrame`-backed coalescer
   - Tasks registered with `{ id, intervalMs, run, paused?: () => boolean }`
   - `pauseAll` / respect `isUiBusy()` from step 1

2. Migrate:

   - Balance poll tick → register as task (WalletProvider owns `run`, scheduler owns timing)
   - Rates + ASP probe → register from HomeScreen mount; unregister on unmount

3. Keep **event paths** outside scheduler: `notifyIncomingFunds`, chat store subscribe, FCM catch-up.

### UX / risks

- Wrong priority → inbound UI feels less “live”. Mitigate: notify remains immediate; scheduler only for fallback polls.
- Double timers during migration — delete old `setInterval` in same PR.

### Acceptance

- Only one recurring timer id for Home fallback work (log / Hermes sampling).
- Idle balance freshness within previous SLA (~4–45 s depending on notify).
- No stacked ticks when returning from background.

---

## Step 3 — Tap → UI from cache; DB/SDK after first paint

### Current code (good pattern to copy)

| Pattern | Path |
|---------|------|
| Detail seed | `navigation/activityDetailSeed.ts` (`offerActivityDetailSeed` / `takeActivityDetailSeed`) |
| List offers seed on tap | `ActivityScreen.tsx` / sheet list |
| Detail paints seed then PK hydrate | `ActivityDetailScreen.tsx` + `getStoredActivity` PK |

### Implementation

Apply the same pattern to remaining “tap then wait” surfaces:

1. **Wallet switcher / edit** — pass wallet record from list; avoid `refreshWalletList` blocking open.
2. **FundsReceived / FundsSent → details** — already has helpers; ensure always seed + `requestAnimationFrame` hydrate.
3. **Contacts edit** — open with `getContact(id)` sync from memory store (already local); defer Nostr kind-0 refresh (already async).
4. **Send from scan** — navigate with parsed destination immediately; resolve LNURL/BIP353 after paint.

Shared helper (optional stub): `app/src/runtime/paintThen.ts`:

```ts
export function paintThen(fn: () => void | Promise<void>): void {
  requestAnimationFrame(() => {
    void Promise.resolve(fn());
  });
}
```

### UX / risks

- Brief incomplete UI (missing stamp/note) for one frame — acceptable if seed has amount/title.
- Never navigate to a blank screen without seed when cache miss — show spinner only then.

### Acceptance

- Activity detail: `tap→paint` ≤ 100 ms wall on Xiaomi with seed (reconfirm prior fix).
- No modal/sheet waits on `materializeFromArkadeWallet` before first paint.

---

## Step 4 — Start Nostr / chat / bot on idle or scene open

### Current code

| Watcher | Start |
|---------|--------|
| Contact gift-wrap | `contactShareWatch.ts` `startContactShareWatch()` — also from module side-effect ~L238 |
| Cursor bot | `botWatch.ts` `startBotWatch()` — side-effect ~L216 / AppState |
| Contacts directory sync | `WalletProvider` `queueContactsDirectoryBootSync` |
| Chat inbound prefer | uses `catchUpGiftWraps` |

### Implementation

1. Remove eager side-effect starts (or gate behind `BASIC_DEFER_NOSTR=1` default on).
2. Add `app/src/nostr/deferredWatchers.ts`:

   - `scheduleDeferredWatchers()` → `InteractionManager.runAfterInteractions` + 1–2 s idle delay after unlock/Home ready
   - `ensureChatWatchers()` called from Chat stack focus
   - `ensureContactsWatchers()` from Contacts focus

3. Closed-app push sidecar stays independent (FCM → `catchUpGiftWrapByEventId`); do not break that path.

4. `startBotWatch` only if Cursor bot contact exists / settings enabled.

### UX / risks

- In-app gift-wrap / bot may arrive later until idle or Chat open.
- First Chat open: show light “syncing…” if catch-up still running.

### Acceptance

- Cold unlock → Home: no `SimplePool` subscribe in first 1 s (log).
- Opening Chat starts watch + catch-up; messages appear.
- Kill-app FCM path still ingests by event id.

---

## Step 5 — Rematerialize only if dirty / pull / notify

### Current code

| API | Path |
|-----|------|
| `refreshActivity({ force? })` | `WalletProvider.tsx` |
| Cool-down / in-flight join | `WalletProvider` rematerialize promise map ~L725+; `activityRefresh.ts` |
| Activity open triggers refresh | `ActivitySheetContent.tsx` ~L94, pull ~L120 |
| Materialize engine | `activityStore.materializeFromArkadeWallet` |

### Implementation

1. Add `app/src/wallet/activityDirty.ts`:

   - `markActivityDirty(walletId, reason)`
   - `consumeActivityDirty(walletId): boolean`
   - Reasons: local send/receive, notify inbound, wallet switch, import/restore

2. Call `markActivityDirty` from: `applyLocalSpend` / `applyLocalReceive` / notify path / `selectWallet` / pay-in-chat hooks.

3. Change Activity open: `refreshActivity()` only if dirty or `force` (pull / `forceResync`).

4. Home focus: never rematerialize (confirm α89 removal stays).

### UX / risks

- Missed dirty → stale Activity until pull. Mitigate: dirty on every write path + notify; add debug log when skipping.

### Acceptance

- Open Activity twice with no payments: second open does not call `materializeFromArkadeWallet`.
- After send/receive: dirty set; next open rematerializes once.
- Pull-to-refresh always rematerializes.

---

## Step 6 — Split `WalletProvider` (fewer re-renders)

### Current code

- Single `WalletContext` (~L284) with large `WalletContextValue` (balance, wallets, activity, funds notice, send guards, provision, …).
- `useWallet()` throws if missing; used widely (Home, sheets, Send, Chat, …).

### Implementation (incremental, 2–3 PRs)

1. **PR6a — read split without breaking API**

   - Internal state stays in one provider component file (or thin facade).
   - Export `useWalletBalance()`, `useWalletList()`, `useFundsNotice()` selecting slices via **separate contexts** updated only when that slice changes.
   - Keep `useWallet()` as composition of hooks for compatibility.

2. **PR6b — migrate hot path**

   - `HomeScreen` → `useWalletBalance` + minimal list fields only.
   - Sheet list → `useWalletList` only.

3. Avoid putting new fields on the mega context.

### UX / risks

- Easy to break call sites; ship behind typecheck + smoke Home/Send/Activity.
- Stale closure if split wrong — prefer contexts over external store unless already used.

### Acceptance

- React Profiler / log: balance poll tick does not re-render `ActivitySheetContent` when closed.
- Home still updates sats live when idle.

---

## Step 7 — One Nostr pool + serialized catch-up

### Current code (`new SimplePool` sites)

| Area | Files |
|------|--------|
| Gift-wrap watch / catch-up | `contacts/contactShareWatch.ts` (incl. live pool + catch-up pool) |
| Bot | `agent/botWatch.ts` |
| Chat publish | `chat/chatNostr.ts` |
| Contact share send | `contacts/contactShare.ts` |
| Directory sync | `contacts/contactsNostrSync.ts` |
| Profile / labels / backup | `nostr/profileMetadata.ts`, `labelDirectory.ts`, `backupBroadcast.ts` |

`catchUpContactShares` already has `catchUpInFlight` single-flight — extend to all catch-ups.

### Implementation

1. `app/src/nostr/sharedPool.ts`:

   - `getSharedPool(): SimplePool` (lazy, `enableReconnect: true` for long-lived)
   - `withSharedPoolPublish(fn)` for one-shot publish paths that today construct+close

2. Replace constructors in watch/catch-up/chat/share/sync (publish-only can keep short-lived pool initially if shared pool lifecycle is tricky — prefer shared).

3. `app/src/nostr/catchUpQueue.ts`:

   - Serialize `catchUpContactShares`, bot catch-up, chat inbound catch-up
   - Coalesce identical `force` requests

### UX / risks

- Shared pool close races — never `pool.close()` from one feature while another subscribes; centralize shutdown on logout/reset (`appReset` / `applyFactoryReset`).
- Slightly delayed parallel catch-ups (by design).

### Acceptance

- Boot/idle: at most one long-lived pool instance.
- Two concurrent `catchUpGiftWraps({force:true})` → one network pass.
- Logout/reset closes pool; next login recreates cleanly.

---

## Step 8 — Activity PK-only + rematerialize queue with ms budget

### Current code

- **PK done:** `getStoredActivity` already `SELECT … LIMIT 1` (do not regress).
- Heavy path: `materializeFromArkadeWallet` + `mapDbRow` JSON parse over full replace writes.
- In-flight join: `activityRefresh.ts` / WalletProvider promise map.

### Implementation

1. Audit remaining list reads that still `readActivityFromDb(limit 500)` + find — eliminate for tap paths.
2. `app/src/wallet/rematerializeQueue.ts`:

   - Enqueue rematerialize jobs per wallet
   - Run with **time budget** (e.g. 8–16 ms): process N SDK pages / map M rows, then `await new Promise(r => setTimeout(r, 0))` yield
   - Respect `isUiBusy()` — pause queue while gesture busy (step 1)

3. UI: Activity list can show DB snapshot immediately; rows stream in as queue commits batches (or single commit at end of job if simpler v1).

### UX / risks

- Partial list flicker if committing batches — v1 can keep one atomic DB write but still yield between SDK fetch and parse chunks.
- Timeouts already documented on Expo; budget must not worsen “empty rematerialize” skips (`skip empty activity rematerialize`).

### Acceptance

- PK path unchanged / still <10 ms hydrate.
- Rematerialize during sheet pan does not freeze UI (queue paused or yielded).
- Pull-to-refresh completes; no duplicate stacked rematerializes.

---

## Sequencing & PR slicing

| Order | PR focus | Depends on |
|------:|----------|------------|
| 1 | `uiBusyGate` + freeze setState | — |
| 2 | `homeIdleScheduler` | 1 (pause when busy) |
| 3 | paint-then audit | — (parallel with 1–2) |
| 4 | deferred Nostr/bot | — (parallel) |
| 5 | activity dirty | — |
| 6 | split WalletProvider | ideally after 1–2 (less noise) |
| 7 | shared pool + catch-up queue | 4 (fewer early starts) |
| 8 | rematerialize budget queue | 1 + 5 |

Do **not** mix step 6 mega-refactor with step 1 in one PR.

Version: bump rc only when shipping a user-visible APK for David to verify (e.g. after 1+2+5).

---

## Out of scope (later)

- Arkade WASM / native SDK
- Native SQLCipher module
- Path C PBKDF2 audit (note in lag doc §8.9 — verify only)

---

## References

- Analysis: Project store `internal/basic-js-thread-lag.md`
- Prior lag fixes: Project store `internal/activity-details-open-lag.md`, `internal/alpha89-perf-fixes-pre-ship.md`
- Hot files: `WalletProvider.tsx`, `HomeScreen.tsx`, `SheetHost.tsx`, `contactShareWatch.ts`, `botWatch.ts`, `activityStore.ts`, `activityRefresh.ts`, `homeTourPerf.ts`
