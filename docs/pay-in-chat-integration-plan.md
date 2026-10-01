# Pay in Chat — integration plan

**Branch:** `david/payinchat`  
**Status:** plan only (no Expo feature implementation in this commit)  
**Product:** Basic Wallet (`app.basic.wallet`)  
**Penpot:** file `0d808482-264d-8195-8008-a46d9fbf8810`, page **Pay in Chat** (`97cefe33-8926-46c5-adc6-31a445d3ce35`) on `http://192.168.1.104:9001`  
**Design source:** `prototype/penpot_pay_in_chat.py` + yellow notes on the live page  
**Product UX (canonical prose):** `prototype/docs/ux-ui-spec.md` §11–§12  
**Date:** 2026-10-01

---

## 1. Executive summary

Pay in Chat is a Revolut-inspired **1:1 P2P thread** where text, payment cards, and payment requests live together. Visual language stays Basic (black canvas, JetBrains Mono, white primary CTAs, outlined secondaries). It does **not** replace classic Send (`03*` / `SendScreen`) for paste, QR, or multi-recipient flows.

**MVP:** BTC-only, private Contacts directory, Nostr **NIP-17 gift-wrap** for async request/pay signaling (same family as contact share + planned `09*`), payment cards in an encrypted local chat store, Request · Send above the composer, **never** instant-send (slide / confirm gate), resume-sync when app opens (push later, opt-in, opaque).

**Reuse heavily:** Contacts (`08*`), contact share gift-wrap (`contactShare.ts` / `contactShareWatch.ts`), Send amount + destination resolution, Arkade HD send + LN intents, fiat captions, SQLCipher account DB.

**Do not build yet:** multi-asset corridors (`15j` USDT / EUR*), GIF/stickers, OS contacts, a Basic plaintext chat server, background poll as the closed-app solution.

---

## 2. Penpot inventory (verified live)

Logged into Penpot on `.104` (2026-10-01). Page **Pay in Chat** exists with **10 phone boards** + yellow notes:

| Board | Purpose (from yellow notes + frames) |
| ----- | ------------------------------------ |
| **15 Pay in Chat** | Thread: text bubbles + payment cards (`You sent` / `You received`) + Request · Send + composer |
| **15b Send amount** | Bottom sheet over dimmed thread: amount + memo → Continue |
| **15c Request** | Sheet: amount + memo; subtitle `NIP-17 gift wrap · Bitcoin only` → Send request |
| **15d Slide confirm** | Scrim + sheet: amount, `to Alice · ark…`, elastic **slide to send** |
| **15e Incoming request** | Card `Request · pending` + **Decline** / **Pay** |
| **15f Empty thread** | First open: “No messages yet” + privacy hint |
| **15g Choose contact** | Pay hub: search, +, recent rows (name, last activity, date, unread badge) |
| **15h Amount** | Full-screen keypad, amount `0`, Send disabled, balance pill |
| **15i Amount ready** | Amount entered, Send enabled, fiat caption |
| **15j Choose asset** | Future: BTC · USDT · EUR* chips + Personal balances |

### Key copy (from boards)

- CTAs: `← Request`, `Send →`, `Continue`, `Send request`, `slide to send`, `Pay`, `Decline`, `Done`
- Payment cards: `You sent` / `You received` + sats primary + `≈ EUR …` + optional memo + time
- Empty: `Private chat with Bob. Encrypted with your account data. Send or request sats anytime.`
- Request sheet: `Ask Alice for a receive address via encrypted Nostr request`
- Send sheet: `SEND TO ALICE` / `From Personal · ark`
- Asset future: `EUR* = EUR-based stablecoin (future).`

### Media gap

RPC PNG export (`export-binfile` / `export-shape`) returned 400/404 from this Penpot build. Boards were inventoried via `get-page` + reconstructed from `penpot_pay_in_chat.py`. Screenshots: open the page in the Penpot UI on `.104` if pixel refs are needed.

---

## 3. Product goals / UX

### Goals

1. Make paying a **known contact** feel like chatting: one thread, payments as first-class messages.
2. Keep Basic’s **honesty** (fees, offline, expired requests) and **never instant-send**.
3. Stay a **Bitcoin payment app** with a thin social layer (no GIF chrome, no Revolut blue).
4. Preserve privacy: private Contacts only; encrypted-at-rest history; relays see ciphertext / metadata only.

### Non-goals (UX)

- Group chats, broadcast channels, public profiles.
- Replacing classic Send for QR / paste / Multisend.
- Shipping multi-asset pay from chat before corridors are live.

### Visual rules (align Penpot + `ux-ui-spec` §1)

- JetBrains Mono; logo tap → Home; muted captions `#B3B3B3` / `#999999`.
- Outgoing: white bubbles/cards; incoming: `#0D0D0D` + `#333` stroke.
- Persistent dual CTA above composer; composer placeholder `Type a message…`.

---

## 4. User flows

### 4.1 Entry

```
A) Settings → Contacts → (future) open chat affordance
   or Pay hub 15g → tap contact → thread (15 / 15f)

B) Home → Send → pick contact that has chat history
   → optional: land on thread instead of classic Send
   (product choice — see open questions)

C) Deep link / notification (post-MVP opt-in push)
   → thread focused on request / payment card
```

### 4.2 Send from chat (happy path)

1. Open thread with Alice (npub / NIP-05 / ark / lnurl as stored).
2. Tap **Send →**.
3. Amount UI: prefer full keypad `15h`/`15i` **or** compact sheet `15b` (pick one primary for MVP; keep the other as polish). Destination is **locked** to the open contact (no Choose Recipient).
4. Optional memo / note.
5. Tap **Send** / **Continue** → confirm sheet `15d` (slide).
6. Auth: biometrics / App PIN / hardware when required (same as classic Send).
7. Wallet executes (Arkade `send` to `ark…`, or LN intent / node pay per destination kind).
8. On success: insert payment card `You sent` in thread; optional local text echo of memo; navigate stays on thread (no forced FundsSent full screen, or show as sheet then dismiss).

### 4.3 Request from chat

1. Tap **← Request**.
2. Sheet `15c`: amount + memo → **Send request**.
3. App builds a **gift-wrap pay-request** (see §5) to contact’s npub (resolve NIP-05 if needed).
4. Outgoing request card appears (`Request · pending`).
5. Peer accepts → may return a **fresh receive address** (gift-wrap reply); requester’s card updates; payer path uses that address on slide.
6. Decline / expire → card status updates; no fake “delivered”.

### 4.4 Incoming request (pay)

1. Watcher unwraps gift-wrap → thread shows `15e` card.
2. **Pay** → amount prefilled → `15d` slide → send.
3. **Decline** → publish decline signal (or local-only decline if peer offline; see open questions) → card `declined`.

### 4.5 Text chat

1. Composer sends encrypted text event (gift-wrap or sealed DM — §5).
2. Appears as bubble; no payment semantics.

### 4.6 Fail / offline

| Situation | UX |
| --------- | -- |
| No Nostr identity | Gate Request (and optionally chat text) with “Create Nostr identity” → `NostrIdentity` |
| Contact has no npub / NIP-05 | Allow **Send** if ark/LN id exists; disable **Request** + text until a Nostr id is added |
| Relay unreachable | Queue outgoing locally (`pending_out`); show “Waiting for network”; flush on resume |
| ASP / wallet send fails | Keep confirm sheet error; request card stays pending if money not moved |
| Soft seed → `bc1…` only | Block per §7; inline error; no slide |
| Amount > balance | Send disabled; caption |
| Request expired | Card `expired`; Pay disabled |
| Peer never online | No fake checkmarks; optional “Sent · not confirmed by peer” for requests |

### 4.7 Offline / app killed

- **v1:** sync on foreground / unlock only (`ux-ui-spec` §12).
- Catch-up query on gift-wrap `#p` (pattern already in `contactShareWatch.ts`).
- One subscription per process; always `stop` on logout / network remount.

---

## 5. Protocol / data model

### 5.1 Design principles

- **No Basic chat server** that can read plaintext.
- Prefer **NIP-17 gift wrap** (kind **1059**) for async P2P payloads (already used for contact share).
- Chat history is **local-first** in SQLCipher account DB; relays are transport, not source of truth for the timeline UI.
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
  asset: "btc"; // v1
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

### 5.3 Thread identity

- Local thread key = `contact_id` (stable local UUID from Contacts).
- Transport addressing = peer **pubkey** (from npub / resolved NIP-05).
- If contact gains/changes npub, migrate carefully (open question: multi-pubkey history).

### 5.4 Local schema (account DB)

Extend `basic-account-{network}.db` (SQLCipher). Chat is **not** disposable activity rematerialization; treat like Contacts (user data). Document backup implications (Path C / pair package should include chat or explicitly exclude — open question).

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
| Amount spoof in UI | Always re-validate request payload before slide; never trust card UI state alone |
| Replay | `requestId` + expiry + ignore duplicate `nostr_event_id` |
| Phishing push | Opaque push only; never sats/memo in notification body |
| Watcher leaks | Single demux; `stop` in `finally`; ban `Promise.race` on subscribe |
| Seed exposure | Chat never touches mnemonic; payments go through existing `requireUserPresence` |
| Duress | Duress mode must not reveal real threads (align with existing duress rules) |

URI alternative (rejected for MVP as primary): putting `bitcoin:` / `arkade:` URIs in plain kind-1 notes. Keep URIs as **optional paste fallback** inside classic Send, not the chat transport.

---

## 6. Mapping Penpot → existing Basic code

| Penpot | Existing | Gap |
| ------ | -------- | --- |
| 15g Choose contact | `ContactsListScreen` + `ContactPickList` | New **Pay hub** variant (last activity, unread); or reuse list with “Chat” action |
| 15 / 15f Thread | — | **New** `ChatThreadScreen` |
| Bubbles / cards | Theme `colors` / `ui` | New components `ChatTextBubble`, `ChatPaymentCard`, `ChatRequestCard` |
| Request · Send bar | — | New `ChatActionBar` |
| Composer | TextInput patterns | New `ChatComposer` |
| 15b / 15c sheets | `InteractiveBottomSheet` | New sheet contents |
| 15h / 15i Amount | `SendScreen` amount + keypad (partial) | Extract shared `AmountKeypad` / balance pill |
| 15d Slide | Penpot elastic slider; Send today uses **Confirm send** button | Shared `SlideToSend` (also upgrade classic Send) |
| 15e Incoming | Contact share offer UI pattern | Request card actions |
| 15j Asset | Fiat / swap corridors partially exist | **Gate** non-BTC |
| Header avatar | `contactInitials` | Reuse |
| Nostr gift-wrap | `contactShare.ts` (`wrapEvent`), `contactShareWatch.ts` | Generalize demux + pay/chat parsers |
| Send execution | `SendScreen.onSend`, `arkMultiSend`, LN resolve | Call shared `executePayToIdentifier(...)` |
| Fiat caption | fiat modules | Reuse |
| Identity | `nostr/identityStore.ts` | Prerequisite for Request/text |

Navigation additions (`RootStackParamList`):

```ts
PayHub: undefined;                 // 15g (optional if Contacts doubles)
ChatThread: { contactId: string; focusRequestId?: string };
// sheets can be in-screen state rather than stack routes
```

Entry wiring:

- `ContactsListScreen`: long-press or trailing **Chat** → `ChatThread`.
- Optional Home / Send row: “Pay” → `PayHub`.
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
    executeChatPay.ts        # bridge to wallet send / LN
  components/chat/
    ChatActionBar.tsx
    ChatComposer.tsx
    ChatTextBubble.tsx
    ChatPaymentCard.tsx
    ChatRequestCard.tsx
    ChatAmountSheet.tsx
    ChatRequestSheet.tsx
    SlideToSend.tsx          # shared with Send later
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

- Prefer **in-thread sheets** (15b/15c/15d) over stack pushes so the thread remains under the scrim (matches Penpot).
- Amount full-screen (15h/15i) can be a stack push if keypad needs space; return to thread after slide success.

---

## 8. Dependencies: Arkade SDK / ASP / Lightning

| Capability | Status in Basic (α44 baseline) | Pay in Chat need |
| ---------- | ------------------------------ | ---------------- |
| HD Arkade wallet | Required / shipped | Send to `ark…` from chat |
| `Wallet.send` / multi-send helpers | Present (`arkMultiSend.ts`, SendScreen) | Reuse for payment cards |
| ASP connectivity | Network prefs + About probe | Fail honestly if offline |
| LN intents (`@arkade-os/swap`) | Spec’d; corridor availability varies | Pay LN-address / BOLT11 contacts when Personal LN path live |
| Linked LN node | LNDHub / BTCPay connect | Alternate rail when switcher on Lightning |
| Fresh receive address | HD rotation | Request accept → return ark address |
| Fiat rates | Present | Card captions |
| Unilateral exit | Unrelated | Out of scope |
| Boltz | Forbidden | Never use |

**Lightning status for chat MVP:** ship with **Arkade address pay** as the reliable path; LN when destination resolves to bolt11/lnurl/lightning address **and** the current wallet mode can pay it (same gates as SendScreen). If solver/node unavailable, disable Pay on that identifier with caption (honesty §16).

---

## 9. Phased implementation

### Phase 0 — Prep (docs / spikes)

- [x] Branch `david/payinchat` + this plan.
- [ ] Confirm open questions with David (§12).
- [ ] Spike: multiplex gift-wrap demux without breaking contact share.
- [ ] Spike: extract amount keypad + confirm control from SendScreen.

### Phase 1 — MVP (shippable BTC chat)

1. **Schema** `chat_thread` / `chat_message` / `chat_outbox` + migrations.
2. **Gift-wrap demux** + parsers for text + pay_request + reply + decline + receipt.
3. **ChatThreadScreen** empty + text send/receive (npub contacts only).
4. **Pay hub or Contacts entry** (15g or Chat action).
5. **Send from chat** → amount sheet/keypad → confirm → Arkade send → payment card.
6. **Request** → outgoing pending card; incoming Pay/Decline.
7. Foreground catch-up; outbox flush; watcher stop on teardown.
8. Gate: no OS contacts, no multi-asset, no push.

**Exit criteria:** Alice↔Bob on mutinynet can request, pay, and see cards; kill app; reopen; history intact; no leaked WS subscriptions after logout.

### Phase 2 — Polish

- Elastic **SlideToSend** shared with classic Send (replace Confirm button).
- Compact sheet path `15b` vs full keypad — match Penpot dual entry.
- Unread badges, date dividers, fiat captions, memo display.
- Link payment cards ↔ Activity detail.
- Decline/expire timers; better offline copy.
- Pair / Path C backup policy for chat history.

### Phase 3 — Notifications (opt-in)

- Opaque FCM/APNs/UnifiedPush via **notifier sidecar** watching kind 1059.
- Never put sats/memo in push body.
- Default remains resume-sync.

### Phase 4 — Multi-asset (`15j`)

- Enable USDT / EUR* only when intent corridors are product-ready.
- Until then: UI may exist behind feature flag or disabled rows.

---

## 10. File touch list (expected)

| Path | Change |
| ---- | ------ |
| `docs/pay-in-chat-integration-plan.md` | This plan |
| `prototype/docs/ux-ui-spec.md` | Already §12; tweak only if decisions change |
| `prototype/docs/activity-storage.md` | Document chat tables + backup stance |
| `app/src/chat/**` | New module |
| `app/src/components/chat/**` | New UI |
| `app/src/screens/ChatThreadScreen.tsx` | New |
| `app/src/screens/PayHubScreen.tsx` | New (optional) |
| `app/src/navigation/types.ts` | Routes |
| `app/src/navigation/RootNavigator.tsx` | Register screens |
| `app/src/screens/ContactsListScreen.tsx` | Entry to chat |
| `app/src/contacts/contactShareWatch.ts` | Demux refactor |
| `app/src/account/accountDb.ts` | Migrations |
| `app/src/screens/SendScreen.tsx` | Extract shared amount/confirm (later) |
| `app/src/theme/**` | Only if new tokens needed |

No Penpot Python changes required unless boards drift.

---

## 11. Risks

| Risk | Severity | Notes |
| ---- | -------- | ----- |
| Gift-wrap UX latency / relay flakiness | High | Outbox + honest pending states |
| Second Nostr subscription leaks bandwidth | High | Must demux; follow SDK watcher rule |
| Chat history vs disposable account DB story | Med | Contacts already broke “fully disposable”; chat same class |
| Confirm UX mismatch (button vs slide) | Med | Spec wants slide; code has button |
| LN corridor not always available | Med | Feature-detect; Ark-first |
| Contact without Nostr id | Med | Partial features only |
| Backup size / privacy if chat in Path C | Med | Decide before enable |
| Scope creep (15j, push, groups) | High | Hard gate in MVP |

---

## 12. Open questions for David

1. **Primary amount UI for MVP:** full keypad (`15h`/`15i`) or sheet (`15b`)? (Recommend keypad for parity with Send; sheet as alternate.)
2. **Confirm control:** implement elastic slide now for chat only, or extract shared SlideToSend and also replace Send’s “Confirm send”?
3. **Entry:** Chat action on Contacts rows only, or also a top-level Pay hub (`15g`) from Home/Send?
4. **Text chat in MVP:** ship real encrypted text, or payment-cards-only with composer disabled until Phase 2?
5. **Request accept:** always return a **fresh ark address** via reply, or allow paying a pre-known contact ark id without round-trip?
6. **Decline signaling:** publish `pay_decline` gift-wrap, or local-only decline if we want less relay traffic?
7. **Backup:** include chat history in Path C / Bluetooth pair package, or exclude until encrypted export is designed?
8. **Push:** any desire to schedule notifier sidecar soon, or strictly resume-sync for first release?
9. **Classic Send takeover:** when picking a contact from Send, open chat thread or stay on classic Send?
10. **EUR\* label:** freeze display name (EURx vs other) before any UI flag lands.

---

## 13. Out of scope

- Implementing Expo screens in this plan commit (except optional stubs if needed later).
- Group / multi-party chat; reactions; GIFs; stickers; voice.
- OS contacts / READ_CONTACTS.
- Basic-operated plaintext chat backend.
- Boltz or any non-intent LN bridge.
- Direct soft-wallet on-chain `bc1→bc1` from chat (same §7 gates).
- Multisig cosign threads (separate product surface §13).
- iOS-first work (Android APK remains first ship).
- Replacing Multisend or classic QR Send.
- Shipping USDT / EUR* pay-in-chat before corridors are live.
- Background-only WorkManager poll as the closed-app notification strategy.

---

## 14. Acceptance checklist (when implementing)

- [ ] Penpot boards 15–15i covered by Expo (15j gated).
- [ ] Request · Send persistent; slide/confirm required; no instant send.
- [ ] BTC-only; balance pill visible before Send enables.
- [ ] No OS contacts; no plaintext server.
- [ ] Gift-wrap demux; one subscription; stopped on teardown.
- [ ] Offline/fail states honest; expired requests not payable.
- [ ] Payments settle via existing Arkade/LN paths; cards reflect real results.
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
