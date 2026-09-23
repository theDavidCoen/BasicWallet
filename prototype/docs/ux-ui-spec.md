# Basic Wallet — UX / UI spec

Product-wide screens, copy, and interaction rules. Penpot boards in `penpot_rebuild_clean.py` are the visual source; yellow notes in `penpot_apply_round3.py` must stay aligned. **Pay in Chat** boards live on the Penpot page of the same name (`penpot_pay_in_chat.py`).

## Doc map


| Doc                                                          | Owns                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| **This file**                                                | UX/UI across the app                                          |
| `[backup-passkey-nostr.md](./backup-passkey-nostr.md)`       | Passkey, backup, restore flows + exact captions               |
| `[arkade-wallet-tech-spec.md](./arkade-wallet-tech-spec.md)` | Arkade SDK only (HD mode, intents LN, unilateral exit engine) |
| `[activity-storage.md](./activity-storage.md)`               | Multi-wallet registry + account activity DB                   |
| `[../figma-scene-comments.md](../figma-scene-comments.md)`   | Historical review comments / scene annotations                |


Do **not** put Arkade SDK details here. Surface Arkade only where the user sees it (receive types, exit, LN-from-Personal).

**Implementation:** Expo app scaffold in [`../../app/`](../../app/) (`app.basic.wallet`).

---

## 0. Platform


| Item        | Choice                                                                 |
| ----------- | ---------------------------------------------------------------------- |
| Client      | **Expo** → native Android APK (dev client / EAS or local reproducible build — not Expo Go as the product) |
| First ship  | **Android `.apk`**                                                     |
| Package id  | **`app.basic.wallet`** (stable; do not change after first installers ship) |
| Networks    | **Selectable:** Settings → Arkade → Network (mainnet / mutinynet). Optional **custom ASP** URL per network. Confirm → app restarts. Default: **mainnet**. Separate encrypted DBs per network. |
| Not         | PWA / browser-first                                                    |
| Build       | **Reproducible** — same source revision → verifiable APK; public build recipe |
| Permissions | **Minimal only** — see below                                           |
| Secrets     | **Mnemonic / seeds only in Keystore** — see §0.1                       |


iOS (Keychain) can follow later. Do not design flows that only work in a webview/PWA.

### 0.1 Seed & mnemonic security (non-negotiable)

Seed security is the **highest priority** of this app.

| Rule | Detail |
| ---- | ------ |
| At rest | Mnemonic / seed **only** in OS-backed secure storage (**Android Keystore** encrypting an app-private blob). Never AsyncStorage, prefs, logs, crash reports, analytics, or screenshots of intermediate state. |
| Account DB (all networks) | `basic-account-{network}.db` **SQLCipher**-encrypted; key in Keystore. Same for engine caches. See [`activity-storage.md`](./activity-storage.md). |
| In memory | Hold plaintext seed only for the duration of a crypto op; clear when done. No session-long global plaintext mnemonic. |
| UI | **Never** show, log, or copy seed/mnemonic in plaintext during normal use (onboarding, Home, Send, backup enable, sync, etc.). |
| Export exception | The **only** intentional plaintext reveal is **user-initiated export** (e.g. `11e`). **Before** showing or copying words: require **biometrics and/or app password/PIN**. `FLAG_SECURE` on that screen. |
| Passkey path | PRF derives mnemonic internally; still no UI reveal unless export. |
| Fail closed | Wrong biometrics/PIN → no reveal. Backgrounding during export → dismiss/hide words. |

Onboarding must never display seed words — see [`backup-passkey-nostr.md`](./backup-passkey-nostr.md).

### Permissions (allowlist)

Ask **only** when the user starts a feature that needs it. Never request “nice to have” or analytics/tracking permissions.


| Permission / capability            | When                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Camera**                         | Scan QR (Send / Connect / pair flows)                                                                            |
| **Clipboard read (paste)**         | User pastes into a field (address, invoice, nsec, …) — prefer in-field paste; no background clipboard monitoring |
| **Biometrics / device credential** | Lock, confirm sensitive actions, and **always** before seed export                                               |
| **Bluetooth / USB (optional)**     | User starts hardware wallet pair — not at first launch                                                           |
| **Notifications (optional)**       | Only if product later needs payment alerts; default off / not required for core use                              |


**Never request (v1):** OS contacts, location, microphone, SMS/phone, storage broad access (use app-scoped storage), “draw over other apps”, usage access, tracking/Advertising ID, arbitrary network-discovery beyond what the feature needs.

Contacts in-app are a **private directory** — no `READ_CONTACTS`. Paste is explicit in UI fields, not a keylogger-style clipboard watcher (aligns with product clipboard rules elsewhere).

---

## 1. Visual system


| Rule      | Detail                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------- |
| Type      | JetBrains Mono                                                                                  |
| Logo      | Hollow tilted ₿ as “B” + `asic` wordmark (native vectors)                                       |
| Brand     | **Basic** only — never Edge                                                                     |
| Chrome    | No `< home` text back; system back / logo                                                       |
| Logo tap  | Always → **Home**                                                                               |
| FX footer | No floating FX rate strip unless the screen’s job is a quote (Send amount line / Swap quote OK) |
| Titles    | White, consistent weight/size across hubs                                                       |
| Captions  | Muted (`#B3B3B3` / hint `#999999`)                                                              |


Phone frame: 390×844 in Penpot.

---

## 2. Mental model


| Concept                | User sees                                                              | Not                            |
| ---------------------- | ---------------------------------------------------------------------- | ------------------------------ |
| **Personal** (default) | Selected wallet balance on Home; switcher tag `main`                   | Sum of all wallets             |
| **Other seed wallets** | Savings, Travel, … in switcher                                         | Created at first onboarding    |
| **Lightning (node)**   | One or more switcher rows after Connect Lightning Node (tag LNDHub / BTCPay / …) | Channels, liquidity management |
| **Passkey**            | Default create/restore identity                                        | A Basic “account” server       |
| **Contacts**           | Private directory (name + address / npub / NIP-05)                     | OS contacts                    |
| **Multisig**           | Vaults coordinated over Nostr                                          | Default wallet                 |
| **Hardware**           | Optional signer for send / cosign                                      | Imported HW seeds into Basic   |


**Layer posture:** default seed wallets (no hardware) are a **layer-2 payment app** (Arkade off-chain, LN intents, asset swap). **Direct on-chain** Bitcoin address → Bitcoin address (no swap / submarine) is allowed only in the modes in §7.

Copy: prefer wallet names and **Bitcoin**. Say “Arkade” only for address-type labels (`ark…`), Settings advanced (exit / operator), or when the format would otherwise be ambiguous.

---

## 3. Global navigation


| Gesture / control          | Action                                 |
| -------------------------- | -------------------------------------- |
| Tap logo                   | Home                                   |
| Tap-and-hold empty on Home | Settings (prototype: click empty area) |
| Avatar / switcher          | Wallets bottom sheet (`01c` flow: list → edit / add / import / connect*) |
| System back                | Previous sheet step or screen (no in-app `< home` / `< Wallets` text) |
| Sheet scrim / grab         | Close overlay |


---

## 4. Onboarding & backup

Full rules and captions: `[backup-passkey-nostr.md](./backup-passkey-nostr.md)`.

Summary:

- Default: **Continue** (passkey) → Terms of Use (cross-device) → **11d Ready** (~2s) → Home as **Personal**.
- Never show seed create/export on first run.
- **Continue without passkey** (text link under Continue) → Terms of Use (device-only) → Advanced Backup (Nostr / home server), not motion entropy.
- If **OS biometrics are not enrolled**: show **SECURE THIS DEVICE** (recommend enabling Face ID / fingerprint in system settings) and require an **App PIN** before create/restore continues. When biometrics are available, App PIN remains optional unlock fallback (`05c`).
- Motion entropy only for **extra** wallets (`14`*).
- First wallet engine: Arkade HD — see tech spec.

---

## 5. Home & switcher

### Home (`01` / `01b`)

- Balance = **selected** wallet only.
- Receive · Send; **swap affordance** only when §8 says it is visible.
- Tap balance → privacy mask (`01b`); tap again → show.
- Activity hint → sheet (`01d`) → tx details (`01h` / `01i` for LN).

### Switcher (`01c`) — single Wallets sheet

- Seed wallets + **zero or more** Lightning rows (multi-node supported).
- Same sheet steps (OS back pops): **list** → **edit** (›) | **add** | **import** | **connect** (menu → LNDHub / BTCPay → status).
- `+ Create wallet` → add step (passkey child or device entropy path).
- `Connect Lightning Node` → connect steps in this sheet (not a separate Settings hub).
- Edit rename in-sheet; remove seed (`01k`) / remove Lightning (`01m`: funds stay on node) as confirm screens.

### Locks

- `01e` biometrics · `01f` PIN · `01g` Duress Home (decoy).
- Duress must not expose real backup / exit / nsec surfaces.

---

## 6. Receive

Boards: `02 Receive BIP21`, `02b` sheet, `02c` share, `02d` POS.


| Rule                 | Detail                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Primary              | BIP21 share / display                                                                                                            |
| Copy / options modal | BIP21 URL · Native segwit · Taproot · Arkade address · Lightning invoice (if node linked **or** LN-into-wallet corridor is live) |
| Freshness            | New receive address when HD rotation applies (see Arkade tech spec). Do not teach a permanent single QR.                         |
| Boarding vs instant  | If boarding on-chain is shown, label confirm wait vs instant off-chain                                                           |
| POS                  | Charge / request variant (`02d`)                                                                                                 |


---

## 7. Send

Boards: `03` empty → ready → slide early/mid → success; `03f` scan; `08b` Choose Recipient.


| Rule     | Detail                                                               |
| -------- | -------------------------------------------------------------------- |
| Layout   | Balance shared-element to top; same size as Home                     |
| Amount   | Sats entry + fiat rate line                                          |
| To       | Address / npub / contact — paste only inside field                   |
| Slide    | Hidden until amount + recipient set; white fill grows while dragging |
| QR       | Large bottom-center when empty; hidden while slide visible           |
| Fee      | Only when ready                                                      |
| Hardware | When paired and required for the spend, slide hands off to device    |


### Direct on-chain (Bitcoin address → Bitcoin address)

No swap, no submarine, no Arkade intent corridor — plain L1 send to `bc1…` / legacy / Taproot on-chain.

**Allowed only if** the selected context is one of:

1. **Lightning node** wallet row, or
2. **Multisig** vault, or
3. **Seed wallet + hardware wallet** paired for signing

Otherwise **block** the destination (inline error / cannot continue to slide). Soft Arkade wallets without hardware stay **L2-only** on Send.


| Selected               | May send on-chain direct? | Typical Send destinations                        |
| ---------------------- | ------------------------- | ------------------------------------------------ |
| Personal / seed, no HW | No                        | `ark…`, BOLT11 via intents, contacts→L2          |
| Seed + hardware paired | Yes                       | Above + on-chain `bc1…` (device confirms)        |
| Lightning node         | Yes                       | On-chain from node + LN as node supports         |
| Multisig vault         | Yes                       | On-chain per vault policy (+ cosign / HW if any) |


Unilateral exit / collaborative offboard in **Settings** remain escape hatches (not this Send rule) — see Arkade tech spec + §15.

Never brand Boltz. Personal→LN pay = intents (tech spec).

---

## 8. Swap

Boards: `04 Swap BTC to USDT`, `04b` success (and future TA pair boards).

### Visibility (Home affordance)


| Selected wallet                             | Swap on Home                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Lightning (node)**                        | **Shown iff** the linked node **supports Taproot Assets**. Flow = Taproot Assets swap (quote + fee + slide). |
| **Lightning (node)** without Taproot Assets | **Hidden** — no icon, no deep link into `04`.                                                                |
| Seed / Arkade (e.g. Personal)               | Shown for in-app asset swap (mock **BTC → USDT**; corridors per Arkade tech when from Personal).             |


Detect TA support from the node connection (BTCPay / NWC / manual LND capability). Re-check on connect and when selecting the Lightning row. If support is unknown, treat as **unsupported** (hide), never show a dead Swap.

### Behavior when visible

- Lightning + TA: pairs are Taproot Assets on that node (not Boltz; not Arkade intents).
- Seed / Arkade: asset corridors / intents as in `[arkade-wallet-tech-spec.md](./arkade-wallet-tech-spec.md)`; never Boltz.
- Quote + fee + slide + success → Home.
- Personal ↔ external LN pay remains Send/BOLT11 (intents), not this Swap control.

---

## 9. Lightning node

Boards: `06` hub · `06b` BTCPay · `06c` NWC · `06d` Manual LND · `13` Node Status.


| Rule           | Detail                                                        |
| -------------- | ------------------------------------------------------------- |
| Goal           | Surface node balance as switcher row(s) alongside seed wallets |
| Modes (shipped)| **LNDHub** (e.g. LNbits) · **BTCPay** LND REST                |
| Modes (soon)   | NWC · Manual LND (operators)                                  |
| Multi          | Multiple Lightning wallets allowed; each has its own credentials |
| Entry          | **Wallets sheet → Connect Lightning Node** (not Settings)     |
| In-app         | Send/receive only — **no** channel management                 |
| Disconnect     | Clears secrets from device; channel funds remain on node      |
| Home           | Selected Lightning row shows node balance, not Personal       |
| Taproot Assets | Capability flag on the connection; gates Home **Swap** (§8)   |
| Swap           | Only if TA supported; otherwise swap control is absent        |


---

## 10. Settings

Hub `05 Settings` structure (Expo source of truth):

| Block | Rows |
| ----- | ---- |
| (top) | Display currencies → `05b` |
| **Account** (section header) | Privacy `05c` · Nostr identity `05d` · Archived wallets · Contacts `08` · Duress PIN `05g` |
| **Wallet Settings** (section header) | Connected node · Hardware wallet `07` · Multisig `10` · Backup `05e` · Restore |
| **Provider Settings** (section header) | **Arkade** (nested → Arkade Settings screen) |
| (footer) | Reset app (danger) · About `05f` |

**Arkade** nested screen (`05as`): Delegates · Recovery address · Collaborative Exit · Unilateral Exit (danger) → §15.

Passkey export / device status remains under Backup / Privacy flows (`05h`), not as a top-level hub row.


---

## 11. Contacts & Nostr payments

### Contacts (`08`, search, add, edit)

- Bitcoin-only identifiers initially: address, npub, NIP-05.
- No OS contact permission.
- Encrypted with account data.
- Send → Choose Recipient (`08b`).

### Nostr payment request (`09*`)

- Async encrypted requests (Bitcoin only; no multi-chain in v1).
- Flow: contact → amount/memo → gift-wrap → accept returns fresh address → sender confirms on Send slide.
- States: pending / accepted / rejected / expired / cancelled.
- Pay in Chat (§12) reuses the same gift-wrap request path when the user taps **Request** in a thread.

---

## 12. Pay in Chat

Revolut-inspired P2P: payments live in a **1:1 chat thread** with a contact. Visual system stays Basic (black canvas, JetBrains Mono, white primary CTAs, outlined secondaries). No Revolut blue bubbles, no GIF/sticker packs, no OS contacts.

Penpot page **Pay in Chat** (`prototype/penpot_pay_in_chat.py`). Boards:


| Board | Purpose |
| ----- | ------- |
| `15` | Thread: text + payment cards + Request · Send + composer |
| `15b` | Send amount as sheet over chat (compact path) |
| `15c` | Request compose (Nostr gift-wrap) |
| `15d` | Slide confirm over chat scrim |
| `15e` | Incoming request card (Pay · Decline) |
| `15f` | Empty thread (first open) |
| `15g` | Choose contact (fictional / private directory list) |
| `15h` | Amount keypad empty (balance pill, Send disabled) |
| `15i` | Amount keypad ready (Send enabled) |
| `15j` | Choose asset (BTC · USDT · EUR-stable) |


### Mental model

- One thread per **private contact** (name + npub / NIP-05 / lnurl / ark / address as stored in Contacts).
- Timeline events: `text` · `payment` (sent/received) · `request` (pending / paid / declined / expired).
- **Send** and **Request** stay above the composer (always one tap).
- Payment cards are first-class messages: status label, amount, optional fiat caption, memo, time.
- Classic Send (`03*`) remains for paste-address / QR / non-chat flows. Chat is the social path, not a replacement for all Send.

### Entry

1. Contacts / Pay hub (`15g`) → tap contact → thread (`15` or `15f`).
2. From thread → **Send** → amount (`15h` / `15i` or sheet `15b`) → optional asset (`15j`) → slide (`15d`) → card lands in thread.
3. From thread → **Request** → `15c` → outgoing request card until peer acts.
4. Incoming request in thread (`15e`) → **Pay** (prefilled amount → slide) or **Decline**.

### Amount & balance (`15h` / `15i`)

- Large amount field; sats primary when asset is Bitcoin.
- **Asset / balance pill** under the amount (e.g. `Bitcoin · 1,234,567 sats`). Always show the **selected wallet** balance for the chosen asset before Send enables.
- Tap pill → `15j`.
- Optional note; quick presets; numeric keypad.
- **Send** disabled at zero; enabled when amount > 0 and destination/asset valid.
- Fee line: honest preview when known; never invent “No fees” if a corridor has costs.

### Assets (`15j`) — v1 vs future


| When | Assets |
| ---- | ------ |
| **v1 ship** | **Bitcoin only** (Arkade L2 / LN intents / allowed L1 per §7). Hide or disable USDT / EUR* rows if corridors not live. |
| **Future** | Bitcoin · **USDT** · **EUR-based stablecoin** (label TBD, e.g. EURx). Chip row + list with per-asset balances from the selected wallet. |


Copy: prefer asset names users know (**Bitcoin**, **USDT**). Do not brand Boltz. Corridor / swap rules follow §8 and the Arkade tech spec when leaving pure BTC.

### Confirmation

- Basic **never** instant-sends from chat. Same elastic **slide to send** as classic Send (`15d`).
- Hardware / biometrics / App PIN rules unchanged when the spend requires them.
- Soft seed + on-chain `bc1…` still blocked per §7 (inline error; no slide).

### Transport & privacy

- Messages and payment requests: encrypted with account data; Nostr **NIP-17 gift-wrap** for async request/pay signaling (same family as `09*`).
- No Basic chat server that reads plaintext. Relays see ciphertext / metadata only.
- Chat history stored in the encrypted account DB ([`activity-storage.md`](./activity-storage.md)), not in plaintext app prefs.

### Notifications (app closed)


| Mode | Behavior | Recommendation |
| ---- | -------- | -------------- |
| **v1 default** | Sync on foreground / unlock only. Badge inbox when opened. | **Ship this first.** Matches §0 “notifications optional / default off”. |
| **Opt-in push** | User enables alerts → device registers push token + npub with a **notifier** that watches gift-wrap (e.g. kind 1059) on chosen relays. | Opaque payload only (“New Pay message” / contact name at most). **Never** sats, memo, or addresses in the push body. |
| **Home relay** | Self-hosted strfry (or similar) + **sidecar notifier** (FCM / APNs / UnifiedPush). Relay stores events; notifier watches and wakes the device. | Good for power users / testers. Not a required SPOF for all Basic users. Product default must work without David’s `relay.davidcoen.it`. |
| **Background poll alone** | WorkManager / periodic relay fetch. | Unreliable when force-stopped; poor on iOS. **Do not** treat as the closed-app solution. |


Nostr WebSockets die when the app is killed. Push requires a process that stays online (notifier), not the relay protocol alone.

### Watchers / subscriptions

- At most **one** Nostr subscription (or notifier registration) per process for Pay inbox.
- Always keep `stop` / unsubscribe / `AbortSignal`; call in `finally` on logout, disable-notify, or screen teardown.
- Never `Promise.race` a `waitFor*` / long subscribe against a timer without cancelling the loser (see workspace SDK watcher rule).

### Recommendations (product)


| Priority | Recommendation |
| -------- | --------------- |
| 1 | Ship **BTC-only** chat + Request/Send + slide; reuse Contacts + `09*` gift-wrap. |
| 2 | Amount UI shows **balance pill** from day one (even before multi-asset). |
| 3 | Multi-asset (`15j`) as a designed future: UI can exist in Penpot; gate rows until corridors exist. |
| 4 | Push: **opt-in**, opaque, notifier sidecar; v1 = resume sync only. |
| 5 | Keep classic Send for QR/paste; do not force every payment through chat. |
| 6 | No GIF/reaction chrome; Basic stays a Bitcoin payment app with a thin social layer. |
| 7 | Entry from Contacts (`08`) and optional Pay row; avoid a fifth primary tab unless usage demands it. |
| 8 | If offering “use my home relay”, document required kinds (gift-wrap) and write policy; do not soft-depend production UX on one homelab host. |


### Honesty / empty (Pay-specific)

- Empty thread (`15f`): short copy that chat is private and encrypted with account data.
- Peer offline / request expired: update the card status; no fake “delivered”.
- Push denied by OS: stay on resume-sync; do not nag beyond one Settings affordance.
- Asset selected with zero balance: Send stays disabled; caption explains why.

---

## 13. Multisig

Boards: `10` hub · invite · pending · cosign · `10e` Create vault · `10f` Import descriptor.

- Native Bitcoin P2WSH; cosigners via Nostr (NIP-17).
- Invite by npub / NIP-05 — no coordinator server.
- From-scratch: in-app keys only (no pasted weak xpubs at create).
- Import descriptor / BSMS = recovery only.

---

## 14. Hardware

Boards: `07` · `07b` Pair · `07c` Confirm on device.

- Optional signing for send / multisig when paired.
- Seeds never imported from hardware into Basic.
- Slide → device approval instead of software sign.

---

## 15. Unilateral exit (Settings)

User-facing escape if the Arkade operator fails. Engine: `[arkade-wallet-tech-spec.md](./arkade-wallet-tech-spec.md)` §4.


| Board / screen             | Purpose                                                   |
| -------------------------- | --------------------------------------------------------- |
| Settings row               | **Provider Settings** → **Arkade** → **Unilateral Exit** → hub (progress / status). Collaborative Exit = sibling row. |
| Hub                        | Caption + **job cards** (running / paused / recent done). **Stop (resume later)** / **Resume**. **Home**. CTA **Start unilateral exit** (or **Start another…** / **Continue exit**). No Collaborative withdraw and no Edit recovery on this screen (those stay as sibling Arkade Settings rows). Wizard steps are **not** inline on the hub. |
| **1 · Recovery address**   | Wizard only — external sweep destination (not Arkade boarding / fee address). Caption explains CSV locktime after execute, that waiting is normal, and that the user may keep using Basic (receive/send/board) without babysitting onchain delivery. |
| Collaborative Exit         | Sibling Arkade Settings row (not on Unilateral hub). Caption: no CSV lock on collaborative path (operator cosign); CSV is unilateral-only. |
| **2 · Prepare**            | Estimate + prepare graph package (while operator reachable) |
| **3 · Fund fee address**   | Own screen; HD onchain from user seed; Continue when funded |
| **4 · Start execute**      | Starts a **background job**, then returns to hub progress. Leaving the screen does **not** abort. |
| Background / reopen        | Jobs keep running while the app process is alive. After process kill, `running` jobs **auto-resume** on wallet bootstrap / AppState active (executor idempotent). |
| Concurrent exits           | Multiple jobs allowed; hub shows one card each. New funds (boarding / Ark) can be received/sent without touching in-flight jobs; a new prepare excludes VTXOs locked by active jobs. |
| Home indicator             | When any job is running/paused: header badge (`exit in progress` / `N exits`) → hub. |
| Progress lines             | Include CSV ETA. Active cards show a clear **CSV lock** banner: blocks left (height locks) or time remaining + approx blocks (time-based locks), with day/hour/minute estimate. |
| Export                     | Optional share of package JSON (auth-gated; confidential)                             |
| Reminder (Home)            | Once after ≥50k sats if no recovery address; dismiss or tap → Settings                |

Tone: last resort; no “instant”; auth before prepare/export/execute; duress must not leak the real package. Teach: boarding ≠ recovery; fee address is yours but must be funded before Start execute.

Penpot `05u*` boards remain optional polish; Expo screens are the source of truth for v1.

---

## 16. Honesty / empty states


| Situation                            | UI                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------- |
| On-chain `bc1…` on soft seed (no HW) | Block with short copy: L2 payment app; use node, multisig, or pair hardware |
| Passkey device-only                  | Settings `05h` / Backup gate — not on passkey create Terms (`11b`)          |
| Wrong backup passphrase              | Fail closed                                                                 |
| Intent solver refuses / offline      | Reason; retry; no fake success                                              |
| LN receive into Personal unavailable | Disabled + short caption                                                    |
| Node disconnected                    | Switcher row gone; secrets cleared                                          |
| Multisig pending                     | Clear cosigner / status chrome                                              |
| Pay in Chat empty / expired request  | See §12 honesty                                                             |


---

## 17. Prototype backlog

1. ~~Settings **Unilateral exit** + `05u`* boards + wires.~~ Expo hub / prepare / execute shipped; Penpot boards optional.
2. Keep `11 Prototype` routes in sync with `[backup-passkey-nostr.md](./backup-passkey-nostr.md)`.
3. Receive / Send yellow notes: HD rotation; BOLT11 from Personal = intents.
4. Refresh stale “board not drawn yet” lines in `figma-scene-comments.md` when touching that file.
5. Pay in Chat: Expo scaffold (`15g` → thread → amount → slide); wire Penpot notes; gate `15j` non-BTC until corridors exist.
6. Optional: notifier sidecar design for home-relay push (opaque FCM/APNs); not required for v1.

---

## 18. Acceptance (UX)

- [ ] First run → Home **Personal**, no seed words shown.
- [ ] Logo → Home everywhere; hold empty → Settings.
- [ ] Switcher separates seed wallets from Lightning node.
- [ ] Receive options + rotating addresses where HD applies.
- [ ] Send slide / QR / fee rules as above.
- [ ] Node: send/receive only, no channels UI.
- [ ] Backup / restore match backup doc captions.
- [ ] No Edge branding; no Boltz in UI.
- [ ] Soft seed Send rejects direct on-chain; LN node / multisig / seed+HW allow it.
- [ ] Swap hidden when Lightning is selected and the node lacks Taproot Assets.
- [ ] Swap on Lightning uses Taproot Assets when the node supports them.
- [x] Unilateral exit reachable in Settings once boards land.
- [ ] APK build is reproducible from published source/recipe.
- [ ] Only minimal permissions (camera/paste/biometrics/HW as needed); no OS contacts/location/mic/tracking.
- [ ] Package id `app.basic.wallet`; selectable network (mainnet / mutinynet + custom ASP).
- [ ] Mnemonic never plaintext in UI/logs except export after biometrics/password; Keystore at rest.
- [ ] Account + engine DBs SQLCipher + Keystore key on **all** networks (block ship if missing) — [`activity-storage.md`](./activity-storage.md).
- [ ] Pay in Chat: Request · Send in thread; slide confirm; balance visible on amount; BTC-only until multi-asset ships.
- [ ] Pay in Chat: no OS contacts; no plaintext chat server; push opt-in and opaque if present.
- [ ] Pay in Chat: Nostr/inbox watchers always stopped on teardown (no leaked subscribe / `Promise.race`).
