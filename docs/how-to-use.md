# How to use Basic

**Experimental wallet.** Do not store meaningful funds. Read the [README](../README.md) warnings first.

This page covers everyday flows, gestures/shortcuts, and advanced options as of the current alpha on `main` (aligned with the latest APK linked below).

License: [MIT](../LICENSE) (same as the repo; Settings → About links to the GitHub blob).

## First launch

1. Create with **passkey** (recommended) or continue **without passkey** (device-only + Advanced Backup).
2. Or **restore** from seed / Nostr package / home server (onboarding **Restore options** chip, or Settings → Restore).
3. Or **pair** from a logged-in nearby phone (onboarding **pair** chip) — see [Bluetooth pair / fast login](#bluetooth-pair--fast-login).
4. Prefer a backup before you receive funds: passkey and/or Advanced Backup (Nostr / home server).

Settings → About shows version + git commit for the APK you installed.

## Basic features

### Home

- **Balance** — tap the amount to hide/show; tap **⇅** (when not in Fiat Mode) to cycle sats / fiat display units.
- **Receive / Send** — primary actions under the balance.
- **Chat & Pay** — entry under Receive/Send (bubble + title + hint; unread badge when needed). Opens the Pay in Chat hub (Ask Cursor + human threads).
- **Wallet avatar** (top left) — open the wallet switcher (Arkade Personal / extras, Lightning node wallets).
- **FIAT MODE badge** — shown when Fiat Mode is on for the selected Arkade wallet.

### Receive

- Opens classic Receive (QR / address modes).
- In **Fiat Mode**, default emphasis is the stable unit (BRL via DePix on mainnet, USD/USDT on Mutinynet); Universal BIP21 and Arkade chips remain available.
- **POS** is a side sheet from Home (see [Shortcuts](#shortcuts--gestures)). On an Arkade wallet it builds an amounted BIP21 (may embed `lightning=` when a solver mints). On a **Lightning node** wallet it is a POS-like keypad → BOLT11 + optional memo.
- Linked-node classic Receive also supports amount + optional memo → invoice (same LN stack as Home POS).

### Send

- Destination actions: **Enter**, **Paste**, **My wallets** (when you have other Arkade wallets; hidden on Lightning node wallets), **Scan**.
- **+ Add recipient** for Arkade multisend (several `ark…` lines with amounts). Lightning Send hides Add (single invoice / LNURL / address).
- In Fiat Mode (Arkade), amounts are in the stable unit; pays with the stable asset when possible (or converts as needed for sats destinations).
- **Lightning** destinations (BOLT11 / LNURL / Lightning Address / BIP353 where supported) work from Personal Arkade via the intents corridor, or from a linked node wallet via LNDhub / LND REST — same Confirm + biometrics pattern as Arkade Send.

### Activity

- Bottom sheet from Home (see shortcuts). Tap a row for detail, notes, and related actions.
- Lightning rows show **memo** (when known), **payment hash**, and **preimage** (copy actions); Arkade rows show txid / explorer.

### Pay in Chat

- **Chat & Pay** on Home, or Settings → Nostr → Chat & Pay (or open a contact) → 1:1 thread over Nostr gift wraps.
- Composer for text; **Request** / **Send** for payment cards in the thread (Arkade and Lightning BOLT11 for human contacts when the selected wallet / contact identifiers allow it). Classic Send stays for paste / QR / multisend.
- Unread activity can surface as a Home banner; history is local (encrypted) and recoverable from Nostr when identity/relays allow.

### Ask Cursor

Optional AI helper in Chat & Pay (experimental). Needs a Nostr identity first.

1. Settings → Nostr → **Nostr Identity** — create or import if you do not have one.
2. Settings → Provider Settings → **Cursor** — paste your Cursor API key (from the Cursor Dashboard). Basic validates it and activates an on-device bot; shopping MCPs such as Bitrefill stay on your Cursor Cloud / Dashboard (never entered in Basic).
3. Open **Chat & Pay** (Home or Settings → Nostr → Chat & Pay) → **Ask Cursor**.
4. Chat with suggestion chips or free text. When the bot posts a pay card, **Confirm** + biometrics pays from your selected wallet (Arkade corridor or linked Lightning node, as applicable). The bot thread has no Request/Send composer actions.

**Session controls** (bot thread only):

| Control | What it does |
|---------|--------------|
| **New session** (header) or type `/new` | Clears the local bot thread and stamps a session cut so old relay gift-wraps do not revive the prior chat |
| Type `/stop` | Cancels in-flight Cursor Cloud work for this turn |

Slash commands are exact (`/new`, `/stop`); the composer suggests them as you type `/`.

Disable anytime from Settings → Provider Settings → Cursor. Only your identity npub can message the bot.

### Language

Settings → **Language**:

- **System default** — follow the phone language. If the OS language is not one of English / Italian / Portuguese, the UI falls back to **English**.
- Or pin **English**, **Italiano**, or **Português**.

Translators and contributors adding a new locale: [`i18n-translators.md`](./i18n-translators.md).

### Settings (highlights)

| Row | Purpose |
|-----|---------|
| **Language** | System default (OS → English fallback) or pin English / Italian / Portuguese |
| Bitcoin Maxi Mode | Auto-swap inbound alt-assets → sats when Fiat Mode is off (default ON) |
| Fiat Mode | Enter/exit stable unit mode; pick available stable card |
| Notifications | Android opt-in closed-app alerts (opaque “New Pay message”; default off) |
| **Provider Settings → Cursor** | Cursor API key → activate Ask Cursor in Chat & Pay |
| **Nostr → Nostr Identity** | Create / import / share npub |
| **Nostr → Chat & Pay** | Pay in Chat hub (Ask Cursor + human threads) |
| **Nostr → Contacts** | Private directory; Nostr share |
| Backup | Passkey status, Nostr package, home server (Advanced) |
| Restore | Seed / nsec package / home server |
| Pair with Bluetooth | Move this account to a nearby phone on the welcome screen (Advanced) |
| Connect node / Add wallet | LNDhub or BTCPay LND REST (see [Lightning](#lightning)) |
| Network / ASP | Mainnet, Mutinynet, optional custom ASP (Arkade settings) |
| About | Version, commit, license link, ASP info |

Long-press empty chrome on Home, or tap the rate footer when shown, also opens Settings.

---

## Shortcuts / gestures

These are easy to miss; they are part of the real Home / Send UX.

### Home

| Gesture / control | What it does |
|-------------------|--------------|
| **Pull / drag the bottom handle up** (or tap the handle) | Open **Activity** sheet |
| **Swipe down** from just below the logo | Force **balance + activity** resync (circular spinner while it runs) |
| **Swipe left → right** (LTR) on Home | Open **POS** side page (Arkade: amounted BIP21 / optional `lightning=`; **Lightning node wallet**: keypad + optional memo → BOLT11) |
| **Swipe right → left** (RTL) on Home | Open **Scan QR** side page |
| **Chat & Pay** under Receive/Send | Open Pay in Chat hub |
| **R$** button (header, Arkade wallet) | Enter Fiat Mode sheet |
| **₿** button (header, while Fiat Mode on) | Exit Fiat Mode sheet |
| Tap **balance** | Hide / show amounts |
| **⇅** next to balance | Cycle balance unit (disabled while Fiat Mode is on) |
| Tap **avatar** | Wallet switcher (Arkade + Lightning rows) |
| Long-press empty header chrome | Settings |
| Tap rate footer (when visible) | Settings |
| Mutinynet / exit badges (header) | Explorer or Unilateral Exit hub |

While Activity, POS, or Scan is open, competing Home swipes are locked so sheets do not fight each other.

### Send

| Control | What it does |
|---------|--------------|
| **Enter** | Type / confirm a destination |
| **Paste** | Clipboard → destination (Arkade / Lightning-shaped payloads where supported) |
| **My wallets** | Pick another of your Arkade wallets as destination (Arkade only) |
| **Scan** | Camera QR → destination |
| **+ Add recipient** | Another line for Arkade multisend (hidden on Lightning) |
| **Max** | Fill amount from spendable balance (when applicable) |
| **Clear** | Remove the current destination |

### Receive / POS

| Control | What it does |
|---------|--------------|
| POS side page (Home LTR swipe) | Keypad request flow. Arkade: Fiat Mode can offer Fiat \| Bitcoin URI chips; may embed `lightning=` on BIP21. Lightning node: optional memo → bolt11 QR |
| Classic Receive | Arkade: BIP21 / Arkade / stable (Fiat Mode). Lightning node: amount + optional memo → invoice |
| Edit amount (from QR phase) | Back to keypad (clears a pending LN invoice when applicable) |

---

## Fiat Mode

Per **selected Arkade wallet** only (not on Lightning node rows).

- **Enter** — converts spendable sats to the network stable (mainnet DePix/BRL, Mutinynet USDT/USD) via Arkade asset swap. Biometrics may be required.
- **Exit** — converts the stable back to sats.
- While on: Home shows fiat primary; inbound sats auto-swap to the stable (quiet); Receive/POS use stable units.
- Path C Advanced Backup can store Fiat Mode + Maxi prefs so restore does not lose mode (refresh backup after changing modes).

Do not expect arkade.money-instant UX on every network; Mutinynet ASP timeouts can make CONVERTING / balance settle feel slow.

## Bitcoin Maxi Mode

- Default **ON**.
- When Fiat Mode is **off**, inbound designated stables (DePix/USDT on that network) auto-swap to sats in the background.
- Fiat Mode wins when active (inbound follows Fiat Mode rules).
- Settings → Bitcoin Maxi Mode for status / future toggle.

## Bluetooth pair / fast login

Move an account to a **nearby phone** from the welcome screen over **encrypted Bluetooth** (no QR or NFC).

### Where

| Device | Entry |
|--------|--------|
| **Device 2** (new / welcome) | Onboarding footer chips: **pair** \| **Restore options** |
| **Device 1** (already logged in) | Settings → Advanced → **Pair with Bluetooth** |

### Flow

1. On Device 2, tap **pair**, grant Bluetooth, keep the sheet open (it shows a short pairing code).
2. On Device 1, open **Pair with Bluetooth**, start scan, match the same lobby code, then approve.
3. Device 1 confirms with **biometrics** (presence gate). Both phones must show the same code before approve.

### What transfers

- Arkade wallets (seeds), Nostr **nsec**, and the **backup passphrase** when cloud backup (Nostr / Home) is already on Device 1.
- **Passkeys are not transferred** — Device 2 does not inherit the WebAuthn / PRF credential.

### Backup after pair

- If Device 1 already had **Nostr or Home** Advanced Backup armed → Device 2 gets backup **fully active** (passphrase included on the wire).
- If Device 1 had no cloud backup → Device 2 shows a **No backup set up** reminder on Home until you set one up.

Both phones need Bluetooth (and nearby-devices) permission. Stay within range until Device 2 confirms login.

## Advanced features

### Backup and restore

- **Passkey** — Personal seed + Nostr identity from PRF; rematerialize on a new device with the same passkey.
- **Advanced Backup (Path C)** — passphrase-wrapped AEAD package (wallets, notes, contacts, Fiat/Maxi prefs) on Nostr relays and/or home server (WebDAV). Lose the passphrase → lose the package. Dirty flag clears only after a successful upload; after biometric unlock Basic can flush a pending upload and unlock+retry Nextcloud **423 Locked** once.
- **Restore** — seed words, or nsec + backup passphrase (package), or home server download.
- **Bluetooth pair** — nearby-phone fast login (see [above](#bluetooth-pair--fast-login)); complements restore when Device 1 is still unlocked.

### Contacts

- Local encrypted directory; optional always-on Nostr directory sync (separate from Path C passphrase).
- Share a contact over Nostr gift wraps when identity is set.

### Closed-app alerts (Android)

- Settings → **Notifications** → **Closed-app alerts** (opt-in, off by default; needs a Nostr identity).
- Opaque tray only (“New Pay message”) for Pay in Chat / contact share while Basic is closed — never amounts, memos, or addresses.
- Tap the tray → unlock → Chat thread (or Chat & Pay hub if the contact is unknown). Classic Bitcoin receives still catch up when you open the app (no tray).
- Prefer swipe-away over system **Force stop**; some OEMs block tray wake after force-stop.

### Lightning

Two surfaces (not Boltz; not a full channel-management wallet):

#### Arkade Lightning (intents corridor)

On a **Personal Arkade seed** wallet:

- Classic **Send** accepts BOLT11, LNURL, and Lightning Address (green/red validation + fee quote before Confirm). Confirm + biometrics; no auto-pay.
- Pay in Chat / Ask Cursor invoices can use the same corridor.
- **Receive** stays BIP21 / Arkade / Boarding — when a solver mints for the requested sats amount, the BOLT11 is embedded as `lightning=` on the unified URI (no separate Lightning receive chip). Home POS / amounted Receive use the same embed path when minting succeeds.
- HD wallet mode is required for claim secrets. Details: [`prototype/docs/arkade-ln.md`](../prototype/docs/arkade-ln.md).

#### Linked Lightning node (LNDhub / LND REST)

Optional switcher rows, separate from Arkade Personal. Open **Add wallet → Connect node** (or Settings → Connect node):

| Provider | How to connect | Notes |
|----------|----------------|-------|
| **LNDhub** (LNbits) | Scan or paste `lndhub://admin:…@https://…/lndhub/ext/` (or invoice role) | Prefer **admin** for send + receive; invoice-only can receive |
| **BTCPay LND REST** | BTCPay → Services → LND (REST); paste or scan the config | Macaroon + REST URL stay on device |

Once connected and selected:

- Home shows **node balance**; **Send** is invoice / LNURL / Lightning Address oriented (same Enter / Paste / Scan pattern as Arkade Send).
- **Receive** and Home **POS** use a POS-like keypad with optional **memo**, then a BOLT11 QR; settle polling updates Activity.
- **Activity** detail shows memo, payment hash, and preimage when the hub/node provides them.
- No in-app channel management. NWC / manual macaroon rows are still “soon”.

### Escape hatches

- Collaborative offboard and **Unilateral Exit** wizard / hub (Settings and Home badge when jobs run).
- Advanced; easy to misuse. Prefer small test amounts.

### Security gates

- App lock / biometrics for sensitive actions (backup enable, export phrase, Enter Fiat Mode, etc.).
- Recovery phrase export is gated; screen capture blocked where wired.

---

## Networks

| Context | Typical ASP |
|---------|-------------|
| Release APK | Mainnet `https://arkade.computer` |
| Dev / Settings | Mutinynet or custom ASP |

Switching network can reset wallet engine state — backup first.

## Get the APK

Latest: **[v0.9.5](https://github.com/theDavidCoen/BasicWallet/releases/tag/v0.9.5)** (arm64-v8a).

All releases: [theDavidCoen/BasicWallet/releases](https://github.com/theDavidCoen/BasicWallet/releases). Prefer arm64-v8a builds + verify SHA256 (and PGP on the checksum when present).

Reproducible recipe: [`reproducible-builds.md`](./reproducible-builds.md).

When bumping the “latest APK” link in the [README](../README.md) Download section, update this page to the same release tag in the same commit.
