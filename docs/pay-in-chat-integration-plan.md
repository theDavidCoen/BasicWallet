# Pay in Chat — integration plan

**Branch:** `david/payinchat`  
**Status:** plan + entry points (Home CTA, Settings row, stub Pay hub)  
**Product:** Basic Wallet (`app.basic.wallet`)  
**Penpot:** file `0d808482-264d-8195-8008-a46d9fbf8810`, page **Pay in Chat** (`97cefe33-8926-46c5-adc6-31a445d3ce35`) on `http://192.168.1.104:9001`  
**Design source:** `prototype/penpot_pay_in_chat.py` + yellow notes on the live page  
**Product UX (canonical prose):** `prototype/docs/ux-ui-spec.md` §11–§12  
**Date:** 2026-10-01  
**Decisions locked:** 2026-10-01 (David); hub placement locked 2026-10-01

---

## 1. Executive summary

Pay in Chat is a Revolut-inspired **1:1 P2P thread** where text, payment cards, and payment requests live together. Visual language stays Basic (black canvas, JetBrains Mono, white primary CTAs, outlined secondaries). It does **not** replace classic Send (`03*` / `SendScreen`) for paste, QR, or multi-recipient flows. Classic Send stays classic Send: picking a contact there does **not** divert into chat.

**MVP:** private Contacts directory, Nostr **NIP-17 gift-wrap** for async request/pay/text signaling (same family as contact share + planned `09*`), **real encrypted text messages** + payment cards in an encrypted local chat store, Request · Send above the composer, **never** instant-send (**classic Confirm send** + **biometrics after**, same family as SendScreen; Penpot `15d` slide-to-send is **not** the chat confirm for MVP). First release is **resume-sync only** (foreground / unlock catch-up; **no** push/sidecar yet).

**Assets (choose UI `15j`):** **BTC** plus the **two stables already in code** — mainnet **BRL / DePix**, Mutinynet **USDT** (labels from `depixAssets.ts` / Fiat Mode). Not a speculative EUR* chip; multi-asset chat reflects what Basic already supports today.

**Entry:** **Chat & Pay** Pay hub (`15g`) from Home CTA card + Settings row (placement locked below). Amount UI: **full-screen keypad** (`15h`/`15i`) like classic Send; sheet `15b` is not primary.

**Pay destination:** use the **contact’s stored ark address** when present; if missing, **round-trip** (request reply with a fresh ark address). **Decline** publishes `pay_decline` on Nostr. Chat history is recovered from **Nostr**, not transferred via Bluetooth pair.

**Reuse heavily:** Contacts (`08*`), contact share gift-wrap (`contactShare.ts` / `contactShareWatch.ts`), Send amount + destination resolution, Arkade HD send + LN intents, Fiat Mode / `depixAssets` corridors, fiat captions, SQLCipher account DB.

**Do not build yet:** GIF/stickers, OS contacts, a Basic plaintext chat server, push/notifier sidecar, background poll as the closed-app solution, speculative EUR* (or other) assets beyond today’s corridors.

---

## 2. Penpot inventory (verified live)

Logged into Penpot on `.104` (2026-10-01). Page **Pay in Chat** exists with **10 phone boards** + yellow notes:

| Board | Purpose (from yellow notes + frames) |
| ----- | ------------------------------------ |
| **15 Pay in Chat** | Thread: text bubbles + payment cards (`You sent` / `You received`) + Request · Send + composer |
| **15b Send amount** | Bottom sheet over dimmed thread: amount + memo → Continue (**not primary MVP**; keypad wins) |
| **15c Request** | Sheet: amount + memo; subtitle `NIP-17 gift wrap · Bitcoin only` → Send request |
| **15d Slide confirm** | Scrim + sheet: amount, `to Alice · ark…`, elastic **slide to send** (**Penpot reference only**; chat MVP uses classic Confirm send + biometrics, not slide) |
| **15e Incoming request** | Card `Request · pending` + **Decline** / **Pay** |
| **15f Empty thread** | First open: “No messages yet” + privacy hint |
| **15g Choose contact** | Pay hub: search, +, recent rows (name, last activity, date, unread badge) |
| **15h Amount** | Full-screen keypad, amount `0`, Send disabled, balance pill (**MVP primary**) |
| **15i Amount ready** | Amount entered, Send enabled, fiat caption |
| **15j Choose asset** | Choose asset: Penpot shows BTC · USDT · EUR* (outdated). **MVP:** BTC + network stable already in app (mainnet BRL/DePix, Mutinynet USDT) |

### Key copy (from boards)

- CTAs: `← Request`, `Send →`, `Continue`, `Send request`, `Confirm send` (chat MVP; Penpot also has `slide to send` on `15d`, not used for chat), `Pay`, `Decline`, `Done`
- Payment cards: `You sent` / `You received` + sats primary + `≈ EUR …` + optional memo + time
- Empty: `Private chat with Bob. Encrypted with your account data. Send or request sats anytime.`
- Request sheet: `Ask Alice for a receive address via encrypted Nostr request`
- Send sheet: `SEND TO ALICE` / `From Personal · ark`
- Asset choose (MVP): reuse app labels — BTC; mainnet **BRL / DePix**; Mutinynet **USDT**. Penpot `EUR*` copy is obsolete for this plan.

### Media gap

RPC PNG export (`export-binfile` / `export-shape`) returned 400/404 from this Penpot build. Boards were inventoried via `get-page` + reconstructed from `penpot_pay_in_chat.py`. Screenshots: open the page in the Penpot UI on `.104` if pixel refs are needed.

---

## 3. Product goals / UX

### Goals

1. Make paying a **known contact** feel like chatting: one thread, payments as first-class messages.
2. Keep Basic’s **honesty** (fees, offline, expired requests) and **never instant-send** (Confirm send + biometrics after).
3. Stay a **Bitcoin payment app** with a thin social layer (no GIF chrome, no Revolut blue).
4. Preserve privacy: private Contacts only; encrypted-at-rest history; relays see ciphertext / metadata only.

### Non-goals (UX)

- Group chats, broadcast channels, public profiles.
- Replacing classic Send for QR / paste / Multisend; do not divert classic Send into chat.
- Speculative assets (EUR*, etc.) beyond corridors already shipped in Basic.
- Push / notifier sidecar in the first Pay in Chat release (resume-sync only).
- Penpot slide-to-send as the chat confirm gate (classic Confirm send wins for chat MVP).

### Visual rules (align Penpot + `ux-ui-spec` §1)

- JetBrains Mono; logo tap → Home; muted captions `#B3B3B3` / `#999999`.
- Outgoing: white bubbles/cards; incoming: `#0D0D0D` + `#333` stroke.
- Persistent dual CTA above composer; composer enabled in MVP (`Type a message…`) for **real encrypted text**.

---

## 4. User flows

### 4.1 Entry

```
A) Home → Chat & Pay CTA card → Pay hub (15g) → tap contact → thread (15 / 15f)
   Placement (locked): card titled "Chat & Pay", same horizontal span as
   Receive+Send, just above the Activity bottom-sheet handle.

B) Settings → Chat & Pay row → same Pay hub (15g)

C) Settings → Contacts → (optional) open chat affordance
   → thread (secondary to Pay hub)

D) Classic Send stays classic Send
   Picking a contact from Send does NOT open the chat thread

E) Deep link / notification (post–first-release; push not in v1)
   → thread focused on request / payment card
```

### 4.2 Send from chat (happy path)

1. Open thread with Alice (npub / NIP-05 / ark / lnurl as stored).
2. Tap **Send →**.
3. Amount UI: **full-screen keypad** `15h`/`15i` (primary; sheet `15b` not primary). Destination is **locked** to the open contact (no Choose Recipient). Balance / asset pill can open `15j` to pick **BTC** or the network’s existing stable (mainnet BRL/DePix, Mutinynet USDT).
4. Optional memo / note.
5. Tap **Send** / **Continue** → **classic Confirm send** sheet (reuse SendScreen confirm pattern; **not** Penpot `15d` slide).
6. Auth: **biometrics after** Confirm send (App PIN / hardware when required; same as classic Send).
7. Wallet executes (Arkade `send` to contact’s stored `ark…` if present; otherwise after request reply with fresh ark address, or LN intent / node pay per destination kind).
8. On success: insert payment card `You sent` in thread; optional local text echo of memo; navigate stays on thread (no forced FundsSent full screen, or show as sheet then dismiss).

### 4.3 Request from chat

1. Tap **← Request**.
2. Sheet `15c`: amount + memo → **Send request**.
3. App builds a **gift-wrap pay-request** (see §5) to contact’s npub (resolve NIP-05 if needed).
4. Outgoing request card appears (`Request · pending`).
5. Peer accepts → may return a **fresh receive address** (gift-wrap reply) when the payer needs one; requester’s card updates; payer path uses that address on Confirm send.
6. Decline / expire → card status updates; no fake “delivered”.

### 4.4 Incoming request (pay)

1. Watcher unwraps gift-wrap → thread shows `15e` card.
2. **Pay** → amount prefilled → classic Confirm send → biometrics after → send.
   - Destination: **contact’s ark address** if present; else **round-trip** for a fresh ark address via `pay_request_reply`, then pay.
3. **Decline** → publish **`pay_decline`** gift-wrap on Nostr → card `declined`.

### 4.5 Text chat

1. Composer sends an encrypted text event (gift-wrap / NIP-17 — §5). **MVP includes real encrypted text** (not cards-only).
2. Appears as a bubble; no payment semantics.
3. Length-capped; same outbox / offline rules as other gift-wrap payloads.

### 4.6 Fail / offline

| Situation | UX |
| --------- | -- |
| No Nostr identity | Gate Request **and** text chat with “Create Nostr identity” → `NostrIdentity` |
| Contact has no npub / NIP-05 | Allow **Send** if ark/LN id exists; disable **Request** + text until a Nostr id is added |
| Relay unreachable | Queue outgoing locally (`pending_out`); show “Waiting for network”; flush on resume |
| ASP / wallet send fails | Keep confirm sheet error; request card stays pending if money not moved |
| Soft seed → `bc1…` only | Block per §7; inline error; no Confirm send proceed |
| Amount > balance | Send disabled; caption |
| Request expired | Card `expired`; Pay disabled |
| Peer never online | No fake checkmarks; optional “Sent · not confirmed by peer” for requests |
| Contact has no ark address | Round-trip: request reply with fresh ark before paying |

### 4.7 Offline / app killed

- **First release:** **resume-sync only** — sync on foreground / unlock (`ux-ui-spec` §12). **No** push / notifier sidecar in v1.
- Catch-up query on gift-wrap `#p` (pattern already in `contactShareWatch.ts`).
- One subscription per process; always `stop` on logout / network remount.
- **History recovery:** chat history is recovered from **Nostr** (gift-wrap catch-up), **not** transferred via Bluetooth pair / Path C package.

---

## 5. Protocol / data model

### 5.1 Design principles

- **No Basic chat server** that can read plaintext.
- Prefer **NIP-17 gift wrap** (kind **1059**) for async P2P payloads (already used for contact share).
- Chat history is **local-first** in SQLCipher account DB for UI; relays are transport. After wipe / new device, history is **recovered from Nostr**, not from Bluetooth pair transfer.
- Payment **settlement** is always on Arkade / LN / allowed L1 — chat only carries **intent + receipts metadata**, never custody.

### 5.2 Message envelope (proposed v1)

All gift-wrap rumors are JSON with a discriminating `type`:

```ts
// Shared header
type ChatEnvelopeV1 = {
  v: 1;
  type:
    | "basic.wallet.chat.text"
    | "basic.wallet.chat.pay_request"
    | "basic.wallet.chat.pay_request_reply"
    | "basic.wallet.chat.pay_decline"
    | "basic.wallet.chat.payment_receipt";
  threadContactHint?: string; // optional display; never trust alone
  sentAt: number; // ms
};

type ChatText = ChatEnvelopeV1 & {
  type: "basic.wallet.chat.text";
  body: string; // plain text, length-capped
};

type PayRequest = ChatEnvelopeV1 & {
  type: "basic.wallet.chat.pay_request";
  requestId: string; // uuid
  amountSats: number;
  memo?: string;
  asset: "btc" | "depix" | "usdt"; // network-gated: mainnet btc|depix, mutinynet btc|usdt
  expiresAt: number;
  // Requester may omit address; payer can ask for fresh addr via reply,
  // or requester includes preferred receive hint:
  preferredReceive?: { kind: "ark" | "bolt11" | "lnurl"; value?: string };
};

type PayRequestReply = ChatEnvelopeV1 & {
  type: "basic.wallet.chat.pay_request_reply";
  requestId: string;
  status: "accept" | "address";
  // Fresh HD Arkade address (or BOLT11) for the sender to pay
  payTo: { kind: "ark" | "bolt11"; value: string };
};

type PayDecline = ChatEnvelopeV1 & {
  type: "basic.wallet.chat.pay_decline";
  requestId: string;
};

type PaymentReceipt = ChatEnvelopeV1 & {
  type: "basic.wallet.chat.payment_receipt";
  paymentId: string;
  direction: "out" | "in"; // from authoring client's view — peer re-labels on ingest
  amountSats: number;
  memo?: string;
  txid?: string;
  rail: "arkade" | "lightning" | "onchain";
  relatedRequestId?: string;
};
```

**Contact share** remains `basic.wallet.contact.share` (existing). Inbox watcher should become a **multiplexed gift-wrap demux** (one WS, many parsers) instead of a second subscription.

**Decline:** always publish `basic.wallet.chat.pay_decline` (locked).

**Pay destination (locked):** prefer contact’s stored ark address; if missing, round-trip via `pay_request_reply` with a fresh ark address before Confirm send.

### 5.3 Thread identity

- Local thread key = `contact_id` (stable local UUID from Contacts).
- Transport addressing = peer **pubkey** (from npub / resolved NIP-05).
- If contact gains/changes npub, migrate carefully (open question: multi-pubkey history).

### 5.4 Local schema (account DB)

Extend `basic-account-{network}.db` (SQLCipher). Chat is **not** disposable activity rematerialization; treat like Contacts (user data). **Bluetooth pair / Path C does not transfer chat history**; recovery is Nostr catch-up after identity restore.

```sql
CREATE TABLE chat_thread (
  contact_id TEXT PRIMARY KEY,
  peer_pubkey TEXT,           -- hex, nullable until known
  last_message_at INTEGER,
  unread_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE chat_message (
  id TEXT PRIMARY KEY,          -- local uuid
  contact_id TEXT NOT NULL,
  kind TEXT NOT NULL,           -- text | payment | request | system
  direction TEXT NOT NULL,      -- in | out
  body_text TEXT,
  amount_sats INTEGER,
  fiat_caption TEXT,
  memo TEXT,
  status TEXT,                  -- pending|sent|failed|paid|declined|expired
  request_id TEXT,
  payment_id TEXT,
  nostr_event_id TEXT,          -- gift-wrap id when known
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (contact_id) REFERENCES … -- logical; contacts table already exists
);

CREATE INDEX chat_message_contact_time ON chat_message(contact_id, created_at);
CREATE TABLE chat_outbox (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  recipient_pubkey TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  last_error TEXT
);
```

Payment cards should also **link** to `activity_idx` when a tx materializes (`payment_id` / txid), so Activity and Chat stay consistent without duplicating settlement truth.

### 5.5 Security & trust

| Risk | Mitigation |
| ---- | ---------- |
| Impersonation | Only chat with Contacts the user saved; show npub/NIP-05 in header; never trust display name alone |
| Relay metadata | Gift-wrap still leaks timing / that two pubkeys talk; document honestly |
| Amount spoof in UI | Always re-validate request payload before Confirm send; never trust card UI state alone |
| Replay | `requestId` + expiry + ignore duplicate `nostr_event_id` |
| Phishing push | Opaque push only; never sats/memo in notification body |
| Watcher leaks | Single demux; `stop` in `finally`; ban `Promise.race` on subscribe |
| Seed exposure | Chat never touches mnemonic; payments go through existing `requireUserPresence` (biometrics after Confirm) |
| Duress | Duress mode must not reveal real threads (align with existing duress rules) |

URI alternative (rejected for MVP as primary): putting `bitcoin:` / `arkade:` URIs in plain kind-1 notes. Keep URIs as **optional paste fallback** inside classic Send, not the chat transport.

---

## 6. Mapping Penpot → existing Basic code

| Penpot | Existing | Gap |
| ------ | -------- | --- |
| 15g Choose contact | `ContactsListScreen` + `ContactPickList` | New **Pay hub** from Home (icon/position TBD); last activity, unread |
| 15 / 15f Thread | — | **New** `ChatThreadScreen` |
| Bubbles / cards | Theme `colors` / `ui` | New components `ChatTextBubble`, `ChatPaymentCard`, `ChatRequestCard` |
| Request · Send bar | — | New `ChatActionBar` |
| Composer | TextInput patterns | New `ChatComposer` (**MVP: real encrypted text**) |
| 15b / 15c sheets | `InteractiveBottomSheet` | Request sheet `15c` yes; amount sheet `15b` not primary |
| 15h / 15i Amount | `SendScreen` amount + keypad (partial) | Extract shared `AmountKeypad` / balance pill (**MVP primary**) |
| 15d Slide | Penpot elastic slider; Send today uses **Confirm send** button | Chat MVP: **reuse classic Confirm send** + biometrics after; do **not** ship Penpot slide for chat. Shared `SlideToSend` is a later classic-Send polish, not chat MVP |
| 15e Incoming | Contact share offer UI pattern | Request card actions; Decline → `pay_decline` |
| 15j Asset | Fiat Mode / `depixAssets.ts` (BRL/DePix mainnet, USDT Mutinynet) | Choose UI shows **BTC + existing network stable** only; no EUR* |
| Header avatar | `contactInitials` | Reuse |
| Nostr gift-wrap | `contactShare.ts` (`wrapEvent`), `contactShareWatch.ts` | Generalize demux + pay/chat parsers; history recover from Nostr |
| Send execution | `SendScreen.onSend`, `arkMultiSend`, LN resolve | Call shared `executePayToIdentifier(...)`; prefer contact ark, else round-trip |
| Fiat caption | fiat modules | Reuse |
| Identity | `nostr/identityStore.ts` | Prerequisite for Request/text |

Navigation additions (`RootStackParamList`):

```ts
PayHub: undefined;                 // 15g from Home
ChatThread: { contactId: string; focusRequestId?: string };
// confirm + request sheets can be in-screen state rather than stack routes
```

Entry wiring:

- **Home → Pay hub** (`15g`) — primary (icon/position TBD).
- `ContactsListScreen`: optional long-press or trailing **Chat** → `ChatThread` (secondary).
- Classic **Send** stays on classic Send (no divert into chat).
- Do **not** add a fifth primary tab in MVP (`ux-ui-spec` recommendation #7).

---

## 7. Architecture (Basic modules)

```
app/src/
  chat/
    types.ts                 # envelopes + local message kinds
    chatStore.ts             # SQLCipher CRUD threads/messages/outbox
    chatNostr.ts             # wrap/unwrap publish helpers
    chatWatch.ts             # demux gift-wrap → chatStore (+ handoff contact share)
    payRequest.ts            # create/accept/decline/expire state machine
    executeChatPay.ts        # bridge to wallet send / LN (contact ark or round-trip)
  components/chat/
    ChatActionBar.tsx
    ChatComposer.tsx         # encrypted text in MVP
    ChatTextBubble.tsx
    ChatPaymentCard.tsx
    ChatRequestCard.tsx
    ChatAmountKeypad.tsx     # full-screen 15h/15i (primary)
    ChatRequestSheet.tsx
    ChatConfirmSend.tsx      # classic Confirm send (not slide)
  screens/
    PayHubScreen.tsx         # 15g
    ChatThreadScreen.tsx     # 15 / 15e / 15f
  navigation/
    types.ts + RootNavigator # routes
  contacts/
    contactShareWatch.ts     # refactor → shared giftWrapWatch or call chatWatch
```

### State

- Thread screen: local React state + `chatStore` subscriptions (same listener pattern as contact share inbox).
- Outbox flusher: boot + AppState active (debounced), not a tight poll loop.
- Unread badges on Pay hub / Contacts rows from `chat_thread.unread_count`.

### Navigation / sheets

- Prefer **in-thread sheets** for Request (`15c`) and Confirm send over stack pushes so the thread remains under the scrim.
- Amount **full-screen keypad** (`15h`/`15i`) is a stack push (primary MVP); return to thread after Confirm send + biometrics success.
- Do **not** use Penpot `15d` slide as the chat confirm control.

---

## 8. Dependencies: Arkade SDK / ASP / Lightning

| Capability | Status in Basic (α44 baseline) | Pay in Chat need |
| ---------- | ------------------------------ | ---------------- |
| HD Arkade wallet | Required / shipped | Send to `ark…` from chat |
| `Wallet.send` / multi-send helpers | Present (`arkMultiSend.ts`, SendScreen) | Reuse for payment cards |
| ASP connectivity | Network prefs + About probe | Fail honestly if offline |
| LN intents (`@arkade-os/swap`) | Spec’d; corridor availability varies | Pay LN-address / BOLT11 contacts when Personal LN path live |
| Linked LN node | LNDHub / BTCPay connect | Alternate rail when switcher on Lightning |
| Fresh receive address | HD rotation | Round-trip when contact has no ark; request accept → return ark address |
| Contact stored ark id | Contacts model | Prefer for pay when present |
| Fiat rates | Present | Card captions |
| Unilateral exit | Unrelated | Out of scope |
| Boltz | Forbidden | Never use |

**Lightning status for chat MVP:** ship with **Arkade address pay** as the reliable path; LN when destination resolves to bolt11/lnurl/lightning address **and** the current wallet mode can pay it (same gates as SendScreen). If solver/node unavailable, disable Pay on that identifier with caption (honesty §16).

---

## 9. Phased implementation

### Phase 0 — Prep (docs / spikes)

- [x] Branch `david/payinchat` + this plan.
- [x] Lock amount UI, confirm UX, entry, pay destination, decline, history recovery, classic Send (2026-10-01).
- [x] Lock text-in-MVP, resume-sync-only v1, assets = BTC + existing stables (2026-10-01).
- [x] Lock Pay hub label **Chat & Pay** + Home/Settings placement (2026-10-01).
- [x] Stub Expo entry: Home CTA + Settings row + `PayHubScreen` empty state.
- [ ] Spike: multiplex gift-wrap demux without breaking contact share.
- [ ] Spike: extract amount keypad + Confirm send (+ biometrics) from SendScreen for chat reuse.

### Phase 1 — MVP (shippable Pay in Chat)

1. **Schema** `chat_thread` / `chat_message` / `chat_outbox` + migrations.
2. **Gift-wrap demux** + parsers for text + pay_request + reply + decline + receipt.
3. **ChatThreadScreen** empty + **encrypted text** send/receive (composer live).
4. **Pay hub from Home + Settings** (15g): label **Chat & Pay**; Home card above Activity handle; Settings Account row. (Stub shipped; thread list next.)
5. **Send from chat** → full-screen keypad → optional `15j` (BTC + network stable already in app) → classic Confirm send → biometrics after → Arkade / corridor send (contact ark or round-trip) → payment card.
6. **Request** → outgoing pending card; incoming Pay/Decline (`pay_decline` on Nostr).
7. **Resume-sync only:** foreground catch-up from Nostr; outbox flush; watcher stop on teardown. No Bluetooth pair chat transfer. No push/sidecar.
8. Gate: no OS contacts; no speculative EUR*; no divert from classic Send.

**Exit criteria:** Alice↔Bob on mutinynet can text, request, pay (BTC and/or USDT per network), and see bubbles/cards; kill app; reopen; history intact (Nostr catch-up); no leaked WS subscriptions after logout.

### Phase 2 — Polish

- Unread badges, date dividers, fiat captions, memo display.
- Link payment cards ↔ Activity detail.
- Decline/expire timers; better offline copy.
- Optional compact amount sheet `15b` as alternate (keypad remains primary).
- Shared `SlideToSend` for **classic Send** only if product wants it later; **not** required for chat (chat stays Confirm send).

### Phase 3 — Notifications (post–first-release)

- First release stays **resume-sync only**. Push / opaque FCM/APNs/UnifiedPush via **notifier sidecar** (kind 1059) is a later phase if desired.
- Never put sats/memo in push body when push ships.

### Phase 4 — Asset choose polish (`15j`)

- MVP already exposes **BTC + existing network stable** (mainnet BRL/DePix, Mutinynet USDT) via app corridors/labels.
- Later: only add new chips when new corridors ship in Basic — **no** speculative EUR* naming track in this plan.

---

## 10. File touch list (expected)

| Path | Change |
| ---- | ------ |
| `docs/pay-in-chat-integration-plan.md` | This plan |
| `prototype/docs/ux-ui-spec.md` | Already §12; tweak only if decisions change |
| `prototype/docs/activity-storage.md` | Document chat tables; Nostr recovery; exclude from Bluetooth pair |
| `app/src/chat/**` | New module |
| `app/src/components/chat/**` | New UI |
| `app/src/screens/ChatThreadScreen.tsx` | New |
| `app/src/screens/PayHubScreen.tsx` | New — Chat & Pay hub (15g) |
| `app/src/screens/HomeScreen.tsx` | Chat & Pay CTA card (span Receive+Send, above Activity handle) |
| `app/src/screens/SettingsScreen.tsx` | Chat & Pay row → PayHub |
| `app/src/navigation/types.ts` | Routes (`PayHub`, later thread/amount) |
| `app/src/navigation/RootNavigator.tsx` | Register screens |
| `app/src/screens/ContactsListScreen.tsx` | Optional secondary entry to chat |
| `app/src/contacts/contactShareWatch.ts` | Demux refactor |
| `app/src/account/accountDb.ts` | Migrations |
| `app/src/screens/SendScreen.tsx` | Extract shared amount keypad + Confirm send for chat reuse; Send stays classic |
| `app/src/theme/**` | Only if new tokens needed |

No Penpot Python changes required unless boards drift.

---

## 11. Risks

| Risk | Severity | Notes |
| ---- | -------- | ----- |
| Gift-wrap UX latency / relay flakiness | High | Outbox + honest pending states |
| Second Nostr subscription leaks bandwidth | High | Must demux; follow SDK watcher rule |
| Chat history vs disposable account DB story | Med | Contacts already broke “fully disposable”; chat same class; recover from Nostr, not pair |
| Confirm UX vs Penpot `15d` | Low | **Decided:** classic Confirm send + biometrics for chat; Penpot slide is reference only |
| LN corridor not always available | Med | Feature-detect; Ark-first |
| Contact without Nostr id | Med | Partial features only |
| Contact without ark address | Low | Round-trip locked |
| Scope creep (push, groups, speculative assets) | High | v1 = resume-sync only; assets = existing corridors only |

---

## 12. Decisions + open questions

### Locked (2026-10-01)

| # | Topic | Decision |
| - | ----- | -------- |
| 1 | **Primary amount UI** | Full-screen keypad (`15h`/`15i`), like classic Send. Sheet `15b` is **not** primary. |
| 2 | **Confirm control** | Classic **Confirm send** + **biometrics after**. **Not** Penpot slide-to-send for chat. |
| 3 | **Entry** | Label **Chat & Pay**. **Home:** CTA **card** spanning left edge of Receive → right edge of Send, just above the Activity bottom-sheet handle → Pay hub (`15g`). **Settings:** Account row **Chat & Pay** → same hub. |
| 4 | **Text chat in MVP** | **Real encrypted text messages** (gift-wrap). Not payment-cards-only. |
| 5 | **Request / pay destination** | Pay using **contact’s ark address** if present; if missing, **round-trip** with a fresh ark address. |
| 6 | **Decline** | Publish **`pay_decline`** on Nostr. |
| 7 | **History / backup** | Chat history recovered from **Nostr**, **not** transferred via Bluetooth pair. |
| 8 | **Closed-app sync (v1)** | **Resume-sync only**. No push / notifier sidecar in the first release. |
| 9 | **Classic Send** | From classic Send, **stay on classic Send** (do not divert into chat). |
| 10 | **Assets / `15j`** | Show **BTC + the two assets already in code** (mainnet **BRL / DePix**, Mutinynet **USDT**). Use existing app corridor labels — **not** a speculative EUR* chip. |

### Still open

None for entry/placement. Remaining work is protocol + thread UI (Phase 1 items 1–3, 5–8).

---

## 13. Out of scope

- Full chat protocol / thread UI in the entry-point stub (schema, gift-wrap demux, composer — Phase 1).
- Group / multi-party chat; reactions; GIFs; stickers; voice.
- OS contacts / READ_CONTACTS.
- Basic-operated plaintext chat backend.
- Boltz or any non-intent LN bridge.
- Direct soft-wallet on-chain `bc1→bc1` from chat (same §7 gates).
- Multisig cosign threads (separate product surface §13).
- iOS-first work (Android APK remains first ship).
- Replacing Multisend or classic QR Send; diverting classic Send into chat.
- Speculative EUR* (or other) assets beyond corridors already in Basic.
- Push / notifier sidecar in the first Pay in Chat release (resume-sync only).
- Background-only WorkManager poll as the closed-app notification strategy.
- Penpot slide-to-send as chat confirm (classic Confirm send + biometrics instead).
- Transferring chat history via Bluetooth pair / Path C.

---

## 14. Acceptance checklist (when implementing)

- [ ] Penpot boards 15–15i covered by Expo; `15j` shows BTC + existing network stable only; amount = full keypad; confirm = Confirm send + biometrics (not slide).
- [ ] Request · Send persistent; Confirm send + biometrics required; no instant send.
- [ ] Encrypted text composer works in MVP (bubbles + outbox).
- [x] Pay hub reachable from Home (Chat & Pay card) and Settings; classic Send does not divert into chat.
- [ ] Pay uses contact ark when present; else round-trip fresh ark; Decline publishes `pay_decline`.
- [ ] Balance / asset pill visible before Send enables; assets match `depixAssets` / Fiat Mode corridors.
- [ ] No OS contacts; no plaintext server; no push in v1 (resume-sync only).
- [ ] Gift-wrap demux; one subscription; stopped on teardown; history recoverable from Nostr (not Bluetooth pair).
- [ ] Offline/fail states honest; expired requests not payable.
- [ ] Payments settle via existing Arkade/LN/stable paths; cards reflect real results.
- [ ] Duress / seed rules unchanged.

---

## 15. References

- Penpot generator: `prototype/penpot_pay_in_chat.py`
- UX: `prototype/docs/ux-ui-spec.md` §11 Contacts & Nostr, §12 Pay in Chat
- Arkade engine: `prototype/docs/arkade-wallet-tech-spec.md`
- Storage: `prototype/docs/activity-storage.md`
- Contact share (gift-wrap precedent): `app/src/contacts/contactShare.ts`, `contactShareWatch.ts`
- Mind: `~/Mind/topics/basic-wallet/`
- NIP-17: gift wrap / kind 1059 (`nostr-tools/nip17`)
