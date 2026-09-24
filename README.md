# Basic Wallet

**Experimental Bitcoin / Arkade wallet.** Not a finished product.

Basic is a personal playground: an Expo Android app used to prototype wallet UX and features that would be useful in a real Bitcoin wallet (Arkade VTXOs, Lightning via intents, contacts, Nostr backup, and related flows). It is developed in the open so ideas can be tried quickly, not so you should trust it with savings.

## Warning: do not use in production

- **Do not** store meaningful funds in Basic.
- **Do not** treat signed alphas as audited releases.
- This codebase has **not** gone through independent professional code review.
- APIs, storage, and security assumptions change between alphas.

If you run the app or study the repo, **verify the code yourself**. Read the sources you care about (wallet creation, mnemonic storage, send/receive, backup, Nostr identity). You are also encouraged to use **frontier LLMs** (and other tools) to review risky paths, but treat model output as a second opinion, not a substitute for your own judgment.

Use at your own risk. There is no warranty.

## What is Basic?

Basic (`app.basic.wallet`) is an experimental mobile wallet built with **Expo / React Native**, focused on:

| Area | What it explores |
|------|------------------|
| **Arkade** | Soft wallet over [Arkade](https://arkade.money) (VTXOs), always in **HD** mode |
| **Bitcoin UX** | Receive / send, activity, multi-wallet switcher, recovery |
| **Lightning** | User-linked node (e.g. BTCPay / LNDHub) and Arkade↔Lightning **intents** (not Boltz) |
| **Backup** | Passkey-oriented onboarding, Advanced Backup via Nostr and/or home server |
| **Contacts** | Local encrypted contacts, share over Nostr gift wraps |
| **Ops hygiene** | Reproducible Android APK recipe, minimal permissions, SQLCipher for account DB |

Network defaults: development tends toward Mutinynet; release builds target mainnet Arkade (`https://arkade.computer`), with Settings to switch network / custom ASP.

This is **not** an AKRLabs / arkade.money product. It depends on the Arkade SDK as a technical ingredient while product UX lives in this repo (`prototype/docs/`).

## What it can do today (alpha)

Capabilities evolve quickly; check Settings → About for the build version and git commit. In recent alphas you can typically:

- Create or restore an Arkade seed wallet (HD)
- Receive Arkade funds and send to addresses / contacts
- **Multisend** — one Arkade send to several `ark…` recipients (amounts per line; activity shows all destinations)
- Browse activity and manage multiple wallets
- Connect a Lightning node (BTCPay LND REST, LNDHub) for node balance / LN flows
- Collaborative offboard and unilateral exit related settings (escape hatches)
- Set app PIN / biometrics gates for sensitive actions
- Export recovery phrase only after presence checks (screen capture blocked where wired)
- **Continue with passkey** — platform WebAuthn / Credential Manager **PRF** derives Personal seed + Nostr identity (see below)
- Manage a Nostr identity; Advanced Backup (Nostr relays and/or home server)
- Maintain contacts (npub, NIP-05, BIP-353, etc.) and share a contact over Nostr
- Prefer mainnet or Mutinynet (and optional custom ASP) from Settings

Expect bugs, incomplete screens, and breaking changes between `0.x` alphas.

### Passkey PRF — what we have vs hardening

**PRF** (Pseudo-Random Function) is a WebAuthn extension: the authenticator (phone OS / password manager) derives secret bytes from the passkey + an app salt, without exposing the passkey itself. Basic uses that 32-byte output as the wallet root.

**What works today (Android focus):**

- `react-native-passkeys` against Android Credential Manager (and iOS where PRF exists)
- Fixed public salt `basic.wallet.passkey.prf.v1` → 256-bit root
- Root → Personal BIP39 mnemonic; same root → deterministic Nostr nsec (`HKDF …nostr.sk.v1`)
- Indexed child wallets from the same root; rematerialize on **Continue with passkey**
- Relying party `basic.davidcoen.it` with Digital Asset Links (release + debug certs) — see [`docs/passkey-assetlinks.md`](./docs/passkey-assetlinks.md)
- Discoverable get preferred after wipe so the OS picker avoids a silent wrong wallet
- Needs a device/OS that actually returns PRF (practically Android 14+ / recent iOS); otherwise Basic falls back to other create/restore paths

**What “PRF hardening” still means (wishlist):**

- Treat PRF as the **only** default onboarding entropy on supported devices (less `__DEV__` / CSPRNG dual-path confusion)
- Stronger handling when PRF is missing (clear UX, no accidental new passkey)
- Broader device matrix, iOS parity, and fewer edge cases around credential id vs discoverable credentials
- Ongoing review that PRF bytes never hit logs/UI and that rpId / assetlinks stay aligned with signing keys

## Repository layout

| Path | Role |
|------|------|
| [`app/`](./app/) | Expo client (TypeScript) |
| [`prototype/docs/`](./prototype/docs/) | Product / UX / Arkade tech specs |
| [`docs/`](./docs/) | Reproducible builds, passkey asset links, notes |
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

- **Pay in Chat** — chat-adjacent payment UX (Penpot page; product TBD)
- **Multi-asset** — USDT / EUR-linked stablecoin corridors when intents exist
- **Hardware wallet & multisig** — colder signing paths beyond the soft wallet
- **Passkey PRF hardening** — see [Passkey PRF](#passkey-prf--what-we-have-vs-hardening) above (PRF already ships; harden defaults and edge cases)
- **Richer Lightning** — smoother Arkade↔LN intents, clearer node vs Personal UX
- **Contacts** — richer identifiers, better share/receive reliability across relays
- **iOS** — first-class iOS build (Android is the current focus)
- **License + public audit trail** — ship a `LICENSE` on GitHub and keep reproducible artifacts easy to verify

Specs that drive this list: [`prototype/docs/ux-ui-spec.md`](./prototype/docs/ux-ui-spec.md), [`prototype/docs/arkade-wallet-tech-spec.md`](./prototype/docs/arkade-wallet-tech-spec.md), [`prototype/docs/backup-passkey-nostr.md`](./prototype/docs/backup-passkey-nostr.md).

## Contributing / feedback

Issues and thoughtful review are welcome. Prefer concrete findings (file + risk) over generic “looks fine.”

If you only want a production-ready Arkade experience, use the official [arkade.money](https://arkade.money) wallet instead of Basic.

## License

License file may still be pending on this repo (`APP_LICENSE_URL` in-app may be `#`). Do not assume redistribution rights until a `LICENSE` is published.
