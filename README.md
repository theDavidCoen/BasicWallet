# Basic Wallet

> **Experimental Bitcoin / Arkade wallet.** Not a finished product. You may lose funds!

Basic is a personal vibe-coded playground: an Expo Android app used to prototype wallet UX and features that would be useful in a real Bitcoin wallet (Arkade VTXOs, Lightning via intents, contacts, Nostr backup, Fiat Mode, and related flows). It is developed in the open so ideas can be tried quickly, not so you should trust it with savings.

**How to use:** see [`docs/how-to-use.md`](./docs/how-to-use.md) (basic + advanced features and Home/Send shortcuts).

**Translators / new languages:** see [`docs/i18n-translators.md`](./docs/i18n-translators.md).

## Warning: do not use in production

- **Do not** store meaningful funds in Basic.
- **Do not** treat signed alphas as audited releases.
- This codebase has **not** gone through independent professional code review.
- APIs, storage, and security assumptions change between alphas.

If you run the app or study the repo, **verify the code yourself**. Read the sources you care about (wallet creation, mnemonic storage, send/receive, backup, Nostr identity, Fiat Mode swaps). You are also encouraged to use **frontier LLMs** (and other tools) to review risky paths, but treat model output as a second opinion, not a substitute for your own judgment.

Use at your own risk. There is no warranty.

## Download

Latest release: **[v0.9.2](https://github.com/theDavidCoen/BasicWallet/releases/tag/v0.9.2)** (arm64-v8a APK + SHA256).

All builds: [Releases](https://github.com/theDavidCoen/BasicWallet/releases). Prefer verifying the checksum before install.

## What is Basic?

Basic (`app.basic.wallet`) is an experimental mobile wallet built with **Expo / React Native**, focused on:

| Area | What it explores |
|------|------------------|
| **Arkade** | Soft wallet over [Arkade](https://arkade.money) (VTXOs), always in **HD** mode |
| **Bitcoin UX** | Receive / send, activity, multi-wallet switcher, recovery |
| **Fiat Mode** | Per-wallet stable unit (DePix/BRL mainnet, USDT Mutinynet) via Arkade swaps |
| **Bitcoin Maxi Mode** | Default ON: inbound alt-assets → sats when Fiat Mode is off |
| **Lightning** | **Arkade intents** (Personal Send BOLT11 / LNURL / Lightning Address; BIP21 receive may embed `lightning=`) plus optional user-linked node (BTCPay / LNDHub). Not Boltz. |
| **Backup** | Passkey-oriented onboarding, Advanced Backup via Nostr and/or home server |
| **Contacts** | Local encrypted contacts, share over Nostr gift wraps |
| **Ask Cursor** | Optional on-device Nostr bot (Cursor Cloud Agents) under Chat & Pay; **New session** / `/new` / `/stop` for the bot thread |
| **Language** | Settings → Language: System default (OS → English fallback) or pin English / Italian / Portuguese |
| **Bluetooth pair** | Move an account to a nearby phone from the welcome screen (encrypted Bluetooth; no QR/NFC) |
| **Ops hygiene** | Reproducible Android APK recipe, minimal permissions, SQLCipher for account DB |

Network defaults: development tends toward Mutinynet; release builds target mainnet Arkade (`https://arkade.computer`), with Settings to switch network / custom ASP.

This is **not** an AKRLabs / arkade.money product. It depends on the Arkade SDK as a technical ingredient while product UX lives in this repo (`prototype/docs/`).

## What it can do today (alpha)

Capabilities evolve quickly; check Settings → About for the build version and git commit. In recent alphas you can typically:

- Create or restore an **Arkade seed wallet (HD)**
- Receive Arkade funds and send to addresses / contacts
- **Multisend** — one Arkade send to several `ark…` recipients (amounts per line; activity shows all destinations)
- **Fiat Mode** — hold a stable unit on the selected Arkade wallet; enter/exit via Home R$ / ₿; inbound auto-swap while on
- **Bitcoin Maxi Mode** — quietly convert inbound designated stables to sats when Fiat Mode is off (default ON)
- Browse activity and manage **multiple wallets**
- **Connect a Lightning node** (BTCPay LND REST, LNDHub) for node balance / LN flows
- **Arkade Lightning** — from a Personal (Arkade seed) wallet: pay BOLT11 / LNURL / Lightning Address via the intents corridor (Confirm + biometrics, no auto-pay); Receive BIP21 may embed a minted `lightning=` invoice when a solver can mint for the amount
- Collaborative offboard and **unilateral exit** related settings (escape hatches)
- Set app PIN / biometrics gates for sensitive actions
- Export recovery phrase only after presence checks (screen capture blocked where wired)
- **Continue with passkey** (WebAuthn / Credential Manager PRF → Personal seed + Nostr identity)
- **Pair with Bluetooth** — move wallets / nsec to a nearby phone on the welcome screen (lobby code + biometrics; passkeys stay on Device 1)
- **Manage a Nostr identity** (kind 0 profile broadcast from Identity); Advanced Backup (Nostr relays and/or home server), including Fiat/Maxi prefs in the Path C package
- Maintain **contacts** (npub, NIP-05, BIP-353, etc.) and share a contact over Nostr
- **Pay in Chat** — Home **Chat & Pay** hub; 1:1 Nostr threads with text plus send/request (Arkade + Lightning BOLT11 for human contacts); classic Send stays separate
- **Ask Cursor** — paste a Cursor API key in Settings → Provider Settings → Cursor; then use **Ask Cursor** in Chat & Pay (owner-only bot; shopping MCPs stay on your Cursor Dashboard). **New session** / `/new` clears the bot thread without relay revive; `/stop` cancels in-flight work
- **Language** — Settings → Language: follow the phone (unsupported OS languages fall back to English) or pin **English**, **Italiano**, or **Português**
- **Closed-app alerts** (Android, opt-in) — opaque tray wake (“New Pay message”) for Pay in Chat / contact share while the app is closed; never amounts or memos; classic receives still catch up on open
- Prefer mainnet or Mutinynet (and optional custom ASP) from Settings

Expect bugs, incomplete screens, and breaking changes between `0.x` alphas.

Gestures (Activity pull, Home pull-down resync, POS/Scan swipes, Send Enter/Paste/My wallets/Scan, Fiat Mode icon): [`docs/how-to-use.md`](./docs/how-to-use.md#shortcuts--gestures). Bluetooth pair / fast login: [`docs/how-to-use.md`](./docs/how-to-use.md#bluetooth-pair--fast-login).

## Repository layout

| Path | Role |
|------|------|
| [`app/`](./app/) | Expo client (TypeScript) |
| [`notifier/`](./notifier/) | Closed-app push sidecar (Nostr kind 1059 → opaque FCM); deploy beside strfry |
| [`prototype/docs/`](./prototype/docs/) | Product / UX / Arkade tech specs |
| [`docs/`](./docs/) | How to use, i18n translators guide, reproducible builds, passkey asset links, notes |
| [`scripts/`](./scripts/) | Release APK build helpers |
| [`dist/`](./dist/) | Local release APKs + checksums (when built) |

App-level develop notes: [`app/README.md`](./app/README.md).

## Build / develop

```bash
cd app
npm install
npx expo prebuild --platform android   # if android/ is missing
npx expo run:android
```

Reproducible release APK (signed with the offline release keystore): see [`docs/reproducible-builds.md`](./docs/reproducible-builds.md) and `scripts/build-release-apk.sh`.

Release checksums may be PGP-signed with fingerprint `5351632CBBF23EF29F1815ACD270A7681AE508EA` (David Coen).

## Future / wishlist

Ideas on the roadmap (design, Penpot, or partial code; not commitments):

- **Multi-asset** — more stable corridors when intents exist (Fiat Mode already explores DePix/USDT)
- **Hardware wallet & multisig** — colder signing paths beyond the soft wallet
- **Passkey PRF hardening** — PRF already ships; harden defaults and edge cases
- **Richer Lightning** — more solvers / corridors; clearer node vs Personal UX (Personal Arkade LN pay + BIP21 embed shipped in 0.9.0)
- **Contacts** — richer identifiers, better share/receive reliability across relays
- **iOS** — first-class iOS build (Android is the current focus)
- **License + public audit trail** — ship a `LICENSE` on GitHub and keep reproducible artifacts easy to verify

Specs that drive this list: [`prototype/docs/ux-ui-spec.md`](./prototype/docs/ux-ui-spec.md), [`prototype/docs/arkade-wallet-tech-spec.md`](./prototype/docs/arkade-wallet-tech-spec.md), [`prototype/docs/backup-passkey-nostr.md`](./prototype/docs/backup-passkey-nostr.md).

## Contributing / feedback

Issues and thoughtful review are welcome. Prefer concrete findings (file + risk) over generic “looks fine.”

To add or improve UI translations (folder layout, namespaces, System default, PR tips): [`docs/i18n-translators.md`](./docs/i18n-translators.md).

If you only want a production-ready Arkade experience, use the official [arkade.money](https://arkade.money) wallet instead of Basic.

## License

License file may still be pending on this repo (`APP_LICENSE_URL` in-app may be `#`). Do not assume redistribution rights until a `LICENSE` is published.
