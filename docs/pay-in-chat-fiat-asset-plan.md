# Pay in Chat — asset-aware cards + Fiat Mode DePix spend

**Branch:** `david/payinchat`  
**Status:** Phase A+B implementation on `david/payinchat`  
**Date:** 2026-10-01  
**Parent plan:** [`pay-in-chat-integration-plan.md`](./pay-in-chat-integration-plan.md)  
**Exploration:** store `internal/chat-fiat-maxi-interaction.md` (current behavior audit)

---

## 1. Executive summary

Chat settlement today is **always Arkade BTC (sats)**. Cards always render `"… sats"`. Fiat Mode wallets that hold only DePix/USDT **cannot** pay via chat, even though classic Send already converts stables → sats with `convertDepixToSatsForPay`.

David’s product intent:

1. **Per-viewer denomination on cards** — sender sees what they spent in *their* mode; receiver sees what they got (or will get) in *their* mode. Cross-mode paths rely on existing auto-swap hooks (Fiat inbound sats → DePix/USDT; Maxi inbound stables → sats). Chat still settles in **sats on the wire**; we do **not** invent chat-side DePix VTXO transfers in v1 of this work.
2. **Fix DePix-only chat pay** — before chat Send / Request Pay, reuse classic Send’s stable→sats conversion when Fiat Mode spendable sats are insufficient but designated stable balance can cover.

This plan covers protocol (gift-wrap fields + backward compat), sender spend, receiver display, Request Pay, phases, files, risks, open questions, and explicit DePix-only acceptance criteria.

---

## 2. Current behavior (as shipped on `david/payinchat`)

### 2.1 Settlement

| Path | Behavior |
| ---- | -------- |
| Chat Send | `ChatAmountScreen` → Confirm → `executeChatPay` → `prepareDustSafeSend` / `waitForSendOrSpendDrop` with `amountSats` |
| Request Pay | `ChatRequestCard` **Pay** → biometrics inside `executeChatPay` (no amount screen) |
| Asset on request | `sendPayRequest({ asset: "btc" })` hardcoded; `ChatAsset = "btc" \| "depix" \| "usdt"` exists but UI never picks stables for settlement |
| Classic Send | If Fiat Mode and destination wants sats: prompt → `convertDepixToSatsForPay(need)` → user taps Send again |

### 2.2 Mode hooks (global, not chat-specific)

| Mode | Inbound | Outbound relevant to chat |
| ---- | ------- | ------------------------- |
| **Fiat Mode** | `maybeAutoSwapInboundSats` quiet-swaps meaningful sats Δ → designated stable (mainnet DePix / Mutinynet USDT), dust reserved | Chat **does not** call `convertDepixToSatsForPay` |
| **Bitcoin Maxi** (default ON, outside Fiat) | Poll designated stable atomic; on increase quiet-swap → sats | Chat only sends sats, so Maxi inbound-asset swap is irrelevant for chat receives |

### 2.3 Cards / store

- `ChatPaymentCard` / `ChatRequestCard`: primary line is always `{amountSats} sats`.
- Local row has `fiatCaption` column; **never written or rendered**.
- Receipt envelope (`payment_receipt`) carries `amountSats` only (no asset / display fields).
- POS in chat (`ReceivePosPanel` `chat-send` / `chat-request`) may **type** in fiat when `fiatMode`, but confirm still converts to sats and the card still shows sats.

### 2.4 Critical gap

Fiat Mode wallet with **DePix/USDT only** (carrier dust sats): chat Send/Pay balance check uses BTC `spendable` → **Insufficient balance** / dust errors. Classic Send already handles this conversion path.

---

## 3. Desired product UX

### 3.1 Principles

1. **Settlement truth = sats** for v1 chat rail (same Arkade send path). Stables are a **spend source** (sender) and/or **post-swap home balance** (Fiat receiver), not a second chat settlement rail yet.
2. **Card truth = viewer’s mode** at render time (and optionally a frozen caption stored at event time for history honesty).
3. **Sender spent / receiver got:**
   - Outgoing card: denomination of **what this wallet spent** (Fiat sender → BRL or USDT display of the payment; Maxi/sats sender → sats).
   - Incoming card: denomination of **what this wallet ends with in its mode** (Fiat → R$/USDT after auto-swap or estimate; Maxi → sats).
4. **Requests:** requester’s pending card shows the amount in the **requester’s input denomination**; payer’s incoming request card shows an amount they can act on (sats primary if Maxi; fiat equivalent if Fiat Mode, with sats subline optional).

### 3.2 UX matrix

Network stable = **BRL (DePix)** on mainnet, **USDT** on Mutinynet. Below “Fiat” means Fiat Mode on; “Maxi” means not Fiat (Maxi Mode ON as today).

| Sender → Receiver | Wire (settlement) | Sender “You sent” | Receiver “You received” | Notes |
| ----------------- | ----------------- | ----------------- | ----------------------- | ----- |
| **Fiat → Fiat** | sats | R$ / USDT (entered / spent) | R$ / USDT (after auto-swap, or estimate until settled) | Both sides in stable mental model; sats are intermediate |
| **Fiat → Maxi** | sats | R$ / USDT | **sats** | Receiver keeps sats (Maxi does not swap sats away) |
| **Maxi → Fiat** | sats | **sats** | R$ / USDT (after auto-swap) | Fiat `maybeAutoSwapInboundSats` |
| **Maxi → Maxi** | sats | sats | sats | Status quo cards, still OK |
| **Mutinynet** | same | USDT labels | USDT labels | Use `fiatStableForNetwork` / `depixAssets` display codes, never mainnet DePix copy |
| **Mainnet** | same | BRL / DePix labels | BRL labels | Same |

**Pending request (requester Fiat):** card shows R$/USDT they asked for (from keypad), not only sats.  
**Incoming request (payer Fiat):** show R$/USDT ≈ of `amountSats` (spot) as primary or equal-weight, so Pay feels consistent with Home; still settle `amountSats`.  
**Incoming request (payer Maxi):** keep sats primary.

### 3.3 Confirm UI

Before biometrics / Confirm send:

- Show **spend denomination** for the sender (Fiat: “Pay R$ X (≈ N sats)” or “Convert ~R$ Y → N sats then send”).
- If conversion is required: reuse classic Send copy family (“Convert to sats” / fee applies), then proceed to send (prefer **one continuous flow** for chat: convert → wait settle → send, rather than “tap Send again”, unless reuse forces the two-step for safety).

---

## 4. Protocol (gift-wrap)

### 4.1 Canonical fields today

```ts
pay_request: { amountSats, asset: "btc"|"depix"|"usdt", … }
payment_receipt: { amountSats, rail, … }  // no asset
```

Existing peers always send `asset: "btc"`. Parsers **reject** unknown `asset` values (`isAsset` whitelist).

### 4.2 Proposed wire rules (v1 asset-aware, backward compatible)

**Keep `amountSats` as the only settlement amount** on request + receipt. Do not require a schema bump (`v` stays `1`) if we only add **optional** fields ignored by old clients.

| Field | Where | Purpose |
| ----- | ----- | ------- |
| `amountSats` | request, receipt | **Required.** Exact sats to pay / that were paid. |
| `asset` | request | Keep. Meaning for v1: **requester’s display intent**, not “send this VTXO asset”. Continue default `"btc"`. When Fiat requester enters stable keypad, set `asset` to `"depix"` (mainnet) or `"usdt"` (mutiny) **and** still fill `amountSats` from spot conversion at request time. Old payers that only read `amountSats` still work. |
| `displayAmount`? (optional) | request, receipt | Human display units at authoring time (e.g. `12.34` BRL). Old clients ignore. |
| `displayCode`? (optional) | request, receipt | `"BRL"` / `"USDT"` / `"sats"`. |
| `fiatCaption` | **local DB only** | Render string; may be recomputed on view if spot changes for *incoming pending* requests; freeze on paid receipts when possible. |

**Receipt recommendation:** still publish `amountSats` (settlement). Optionally add `displayAmount` / `displayCode` from **sender’s** view of what they spent (helps Fiat→Maxi peer show a secondary line later). Receiver’s primary card line is always **local mode**, not blind trust of peer display fields.

**Do not** (v1): put atomic DePix amounts as the sole payable field; send chat payments as asset VTXOs; break parse of `asset: "btc"`-only historical requests.

### 4.3 Backward compatibility

| Peer / payload | Behavior |
| -------------- | -------- |
| Old request `asset: "btc"` + `amountSats` | Unchanged; Fiat payer may still convert stables→sats to pay |
| New request `asset: "depix"|"usdt"` + `amountSats` | Old app: if it already accepts those enum values in parser (it does) but UI ignored asset → still pays `amountSats`. New app: uses `asset` / `displayAmount` for requester card primary |
| Old receipt (sats only) | New Fiat receiver: convert locally for display via spot / post-swap balance heuristic |
| Missing optional display fields | Derive caption from `amountSats` + local `fiatMode` + spot |

---

## 5. Sender spend path (DePix-only fix + Send)

### 5.1 Shared helper (extract / reuse)

Classic Send (`SendScreen` ~986–1025): Fiat Mode + sats destination → alert → `convertDepixToSatsForPay(need)`.

Plan:

1. Extract a small shared helper (name TBD, e.g. `ensureSatsForPay`) used by classic Send **and** chat:
   - Inputs: `satsNeeded`, Fiat Mode hooks, current `spendable`, `depixDisplay`.
   - If `spendable >= satsNeeded` (+ dust rules): no-op.
   - If Fiat Mode and stable balance can fund: run `convertDepixToSatsForPay`, wait until `spendable` covers need (poll/balance refresh with timeout + cancel), then return.
   - Else: throw honest insufficient (stable and/or sats).
2. Call from:
   - `ChatAmountScreen.onConfirmSend` (before `executeChatPay`)
   - `ChatThreadScreen.onPayRequest` (before `executeChatPay`)
   - Optionally leave classic Send on the helper for one code path

### 5.2 `executeChatPay` changes

- Keep settlement sats-only.
- Accept optional pre-converted path (caller ensures sats) **or** accept an injected `ensureSats` hook so the module stays free of React context.
- After success, when inserting local payment row: set `fiatCaption` (and later `displayAmount` on receipt publish) from sender mode.

### 5.3 Confirm copy

| Situation | Confirm / alert |
| --------- | ---------------- |
| Maxi / sats enough | `Send N sats to {name}` (status quo) |
| Fiat, sats enough (dust/carrier) | Prefer show **R$/USDT primary**, sats secondary |
| Fiat, need convert | `Convert ~{stable} to sats, then send N sats? Fee applies.` → convert → send (chat one-shot preferred) |

---

## 6. Receiver display path

### 6.1 Render rules (`ChatPaymentCard` / `ChatRequestCard`)

Introduce a small formatter (e.g. `formatChatAmountView`) taking:

- `amountSats`
- `direction` (`in` | `out`)
- `viewerFiatMode`, `networkId`, spot rate, optional stored `fiatCaption` / request `asset` / `displayAmount`

| Viewer | Direction | Primary line | Secondary (optional) |
| ------ | --------- | ------------ | -------------------- |
| Fiat ON | out | R$/USDT spent (stored caption or spot from sats) | `≈ N sats` |
| Fiat ON | in | R$/USDT (prefer post-swap / stored; else estimate from sats) | `≈ N sats` until swap settles |
| Fiat OFF | out/in | `N sats` | optional ≈ fiat if Home rates enabled (nice-to-have, not required for this plan) |

**Pending auto-swap:** Fiat incoming payment may briefly show sats or `≈ R$ … (converting…)`, then refresh caption when `depixDisplay` / activity reflects fill. Avoid lying that DePix already arrived before swap completes.

### 6.2 Request cards

- Outgoing request (Fiat requester): primary = display units from keypad / `displayAmount`; keep `amountSats` for payer.
- Incoming request (Fiat payer): primary = ≈ stable of `amountSats`; Pay still spends sats (after convert if needed).
- Maxi either side: sats primary.

### 6.3 Ingest

- On `pay_request` / `payment_receipt`: store `amountSats`; if optional display fields present, seed `fiatCaption`.
- Do **not** require peer mode knowledge on the wire for v1; each client renders for **itself**.

---

## 7. Request Pay (biometrics-only) + conversion

Current: `onPayRequest` → `executeChatPay` with presence inside; no convert.

Plan:

1. Pre-flight: resolve destination (unchanged).
2. `ensureSatsForPay(msg.amountSats)` when Fiat Mode.
3. Then `executeChatPay` (biometrics once at send; if convert UI needs an extra confirm, do convert confirm **before** presence, presence only for the Arkade send — avoid double biometric unless product asks).
4. Busy spinner already on the card; extend copy if converting (“Converting…”).

Acceptance for this path is included in §11.

---

## 8. Phased implementation

### Phase A — DePix-only chat pay (blocker fix)

1. Shared `ensureSatsForPay` (or inline reuse of `convertDepixToSatsForPay` + wait).
2. Wire into chat Send confirm + Request Pay.
3. Confirm / error copy aligned with classic Send.
4. Manual test matrix on Mutinynet: Fiat wallet with USDT only pays chat Send + Request Pay.

**Ship criterion:** §11 DePix-only acceptance all green. Cards may still show sats.

### Phase B — Card denomination (viewer mode)

1. `formatChatAmountView` + render in `ChatPaymentCard` / `ChatRequestCard`.
2. Populate `fiatCaption` on local insert (send + ingest).
3. Fiat requester request cards show stable primary.
4. Optional secondary sats line.

### Phase C — Protocol optional display fields

1. Add optional `displayAmount` / `displayCode` on request + receipt publish/parse (ignore-unknown).
2. Fiat keypad request sets `asset` to network stable + display fields; `amountSats` still set.
3. Cross-device: Fiat↔Maxi card matrix from §3.2.

### Phase D — Polish (optional / later)

- Continuous convert→send without “tap again”.
- Live refresh of Fiat incoming caption when auto-swap completes.
- Choose-asset `15j` for chat only if product still wants explicit BTC vs stable **intent** beyond Fiat Mode keypad (not required to close DePix-only gap).

---

## 9. File touch list (expected)

| Area | Files |
| ---- | ----- |
| Plan / docs | `docs/pay-in-chat-fiat-asset-plan.md` (this), cross-link in `docs/pay-in-chat-integration-plan.md` |
| Spend convert | `app/src/fiat/FiatModeProvider.tsx` (`convertDepixToSatsForPay`), new helper under `app/src/fiat/` or `app/src/chat/`, `app/src/screens/SendScreen.tsx` (optional extract) |
| Chat pay | `app/src/chat/executeChatPay.ts`, `app/src/screens/ChatAmountScreen.tsx`, `app/src/screens/ChatThreadScreen.tsx` |
| Protocol | `app/src/chat/types.ts`, `chatEnvelope.ts`, `chatActions.ts`, `chatIngest.ts` |
| Cards / UI | `app/src/components/chat/ChatPaymentCard.tsx`, `ChatRequestCard.tsx`, optional `formatChatAmount.ts` |
| Store | `app/src/chat/chatStore.ts` (if new columns beyond `fiat_caption`; prefer reuse caption first) |
| Assets / rates | `app/src/fiat/depixAssets.ts`, existing fiat rate helpers used by Home/POS |

No Penpot regen required for Phase A; Phase B should match Penpot payment card “primary + ≈ secondary” pattern already noted in the parent plan.

---

## 10. Risks

| Risk | Mitigation |
| ---- | ---------- |
| Convert then send races (balance not yet spendable) | Wait/poll spendable with timeout; surface failure; do not send partial |
| Double spend / stacked swap jobs | Reuse single-flight `runJob` in FiatModeProvider; never start a second convert while busy |
| Wrong denomination after fee | Primary Fiat amounts are **estimates**; sats line is settlement truth; copy “≈” |
| Old clients ignore new display fields | Always send `amountSats`; optional fields only |
| Fiat incoming card shows R$ before swap | Pending state / secondary “converting”; refresh on balance |
| `convertDepixToSatsForPay` converts **full** stable balance today (not exact `satsNeeded`) | Document as status quo with classic Send; open question whether to trim to need+fee |
| Dust / min vtxo after convert | Re-check dust and spendable after convert before `executeChatPay` |
| Watcher / swap pollers | Keep existing cancel discipline; no new `Promise.race` on subscriptions |

---

## 11. Acceptance criteria — DePix-only chat pay (Phase A)

All of the following on **Mutinynet** (USDT) and smoke on **mainnet** (DePix) when available:

1. **Fiat Mode wallet with designated stable balance and only dust/carrier sats** can complete **Chat Send** to a contact with a stored ark address; payment receipt appears; peer receives sats.
2. Same wallet can complete **Request Pay** (biometrics-only on incoming request card) for a pending `amountSats` request; no amount screen.
3. If stable balance cannot cover the sats need (after fee), user sees an **honest error** (no silent fail, no stuck spinner).
4. If sats balance already covers the need, **no** convert prompt / job is started.
5. Convert uses the **same** FiatModeProvider path as classic Send (`convertDepixToSatsForPay` / shared helper), not a second swap stack.
6. Classic Send convert behavior remains intact (regression).
7. Maxi-only wallets (no Fiat Mode) are unchanged: still pay sats directly with no convert UI.

Phase B/C acceptance (cards): Fiat↔Maxi matrix in §3.2 matches primary denominations on both devices for Send and for paid request flows.

---

## 12. Decisions + open questions

### Locked (2026-10-02)

| # | Decision |
| - | -------- |
| 1 | **Targeted convert (B):** when Fiat Mode lacks sats, convert only `satsNeeded` + fee pad; leave remaining stable balance in fiat (not classic Send’s full-balance convert). |
| 2 | **One-shot** chat Confirm: Confirm → convert if needed → biometrics → send (not classic Send’s two-step). |
| 3 | **Freeze** fiat captions at send/receive time (historical; do not recompute when spot moves). |
| 5 | Maxi users see **sats only** on cards — no ≈ USD/EUR secondary in Phase B. |
| 6 | Fiat **requester pads** `amountSats` for expected inbound sats→stable swap fees (same idea as Universal BIP21 receive). |
| 4 | **Wire may carry display metadata**, but cards follow the **viewer’s mode**, not the counterparty’s asset choice. Maxi always sees sats only (never “requested in BRL”). Fiat viewers see their stable (from sats + rate / post-swap). Metadata is for the Fiat party’s own history / formatting, not to educate Maxi about the other side’s denomination. Settlement stays sats; no DePix VTXO chat transfer in v1. |

### Open questions

None — ready to implement when David says go.

---

## 13. References

- Parent: [`docs/pay-in-chat-integration-plan.md`](./pay-in-chat-integration-plan.md) (§5 envelopes, §4 flows, asset decision #10)
- Audit: project store `internal/chat-fiat-maxi-interaction.md`
- Fiat Mode: `docs` / store `fiat-mode-plan.md`; `app/src/fiat/FiatModeProvider.tsx`
- Code anchors: `executeChatPay.ts`, `ChatAmountScreen.tsx`, `ChatThreadScreen.tsx`, `ChatPaymentCard.tsx`, `ChatRequestCard.tsx`, `SendScreen.tsx` (convert), `chat/types.ts`
