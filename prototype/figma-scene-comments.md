# Figma / Penpot scene comments

Yellow annotations ported from the Figma draft (+ review updates).

## 01 Home

_Board:_ `01 Home`

Source of truth for the visual system. Exact match to the Basic mock: outlined tilted Bitcoin-B logo, centered sats balance, ghost Receive/Send, swap affordance between them.

Balance = selected wallet only. Tap balance → privacy hide (see 01b). No FX rate footer.

Swap affordance: on **Lightning node** selected → Taproot Assets **iff** the node supports them; otherwise **hide** Swap. On seed/Arkade wallets → in-app asset swap (e.g. BTC→USDT); Personal↔LN pay uses intents on Send, not this icon.

## 01b Home — privacy

_Board:_ `01b Home privacy`

Review comment #2: tap balance to hide amounts.

Hidden state shows masked sats + “tap to show”. Same layout as Home otherwise (logo, Receive/Send/swap). No FX footer.

## 02 Receive

_Board:_ `02 Receive BIP21`

Review #3: BIP21 as primary (Arkade-style). Copy opens address-options modal (BIP21 URL, native segwit, Taproot, Ark, Lightning invoice).

Arkade SDK generates fresh on-chain/Ark address. If LND is linked, Lightning invoice is an option in the modal. Logo present. No FX footer.

## 03 Send — empty

_Board:_ `03 Send empty`

From Home, balance animates to the top (shared element). Same balance size as Home (#4).

• amount: manual entry (sats) + fiat rate line (#13)
• to: address / npub / contact — paste only inside field
• **Direct on-chain** (`bc1…`) only if selected = Lightning node, multisig, or seed+hardware; else L2-only (ark / LN intents). See `docs/ux-ui-spec.md` §7.
• Choose Recipient opens private contacts
• slide to confirm is INVISIBLE until amount + recipient are set
• scan QR = large bottom-center affordance (not inside to)
No < home back (#7). No FX footer.

## 03b Send — ready

_Board:_ `03b Send ready`

All fields filled → slide to confirm appears (#8–10).

Fee estimate shows only when ready. QR scan hidden while slide is visible (#9). Slide fill grows white while dragging (#10). Hardware wallet: slide hands off to device signing if paired.

## 04 Swap

_Board:_ `04 Swap BTC to USDT`

Review #11: example flow is BTC → USDT when a **seed** wallet is selected.

If **Lightning node** is selected: Swap is Taproot Assets **only when the node supports TA**; otherwise the Swap control is **hidden** on Home. Never Boltz. See `docs/ux-ui-spec.md` §8.

## 06 Connect Node

_Board:_ `06 Connect Node`

Goal: surface LND funds alongside Arkade wallet on Home.

BTCPay = guided UX. NWC = Nostr-native pairing. Manual LND for operators.

Review #21: in-app only send/receive funds via LND — no channel management.

## 05 Settings

_Board:_ `(board not drawn yet)`

Central hub for power-user features.

• Node: LND via BTCPay link or NWC
• Hardware: Trezor & others
• Nostr: local nsec behind OS passkey; npub shown
• Contacts: private encrypted directory
• Multisig: Nostr-coordinated P2WSH
• Backup: default OS passkey/cloud — never shows seed in onboarding

## 07 Hardware Wallet

_Board:_ `(board not drawn yet)`

Optional signing path for Arkade-managed or watch-only Bitcoin wallets.

On send/multisig, if a hardware device is paired, the confirm slider routes to device approval instead of software signing. Seeds from HW are never imported into Basic.

## 08 Contacts

_Board:_ `(board not drawn yet)`

Private recipient directory (Bitcoin-only initially): name + identifiers (address, npub, NIP-05).

Used by Send → Choose Recipient and Nostr payment requests. No OS contact permission. Encrypted with wallet account data (Arkade-backed).

## 09 Nostr Payment Request

_Board:_ `(board not drawn yet)`

Async encrypted payment requests over Nostr (Bitcoin only — no multi-chain in Basic v1).

Flow: choose contact → amount/memo → gift-wrapped request → recipient accepts & returns fresh address → sender confirms on Send slide.

States: pending / accepted / rejected / expired / cancelled.

## 10 Multisig

_Board:_ `(board not drawn yet)`

Native Bitcoin P2WSH multisig coordinated over Nostr DMs (NIP-17 gift wraps). Invite cosigners by npub/NIP-05 — no coordinator server.

Policy: from-scratch creation uses in-app keys only (no weak foreign xpubs). Import descriptor/BSMS allowed for recovery.

## 11 Onboarding — Create

_Board:_ `(board not drawn yet)`

CRITICAL PRODUCT RULE: never expose seed phrases in the initial wallet configuration.

Default path = OS passkey + vendor cloud backup (iCloud Keychain / Google Password Manager). Creates an **Arkade HD** wallet (`walletMode: "hd"`). Unilateral exit required from v1. LN corridors via intents (Boltz deprecated). Spec: `docs/arkade-wallet-tech-spec.md`.

Advanced users can opt into encrypted Nostr-relay backup or home-server backup.

## 12 Advanced Backup

_Board:_ `(board not drawn yet)`

Alternatives to OS cloud backup:

1) Encrypted backup over Nostr — user may add relays beyond defaults.
2) Encrypted backup to a domestic / self-hosted server.

Both are opt-in. Default onboarding never shows seed words.

## 13 Node Status

_Board:_ `(board not drawn yet)`

Post-connect dashboard for LND. Feeds Home balance split and Swap from/to Lightning.

Disconnect clears macaroon/NWC secrets from device secure storage. Channel funds remain on the node (no in-app channel management).

## Review comments catalog

David review comments (applied to boards):

1 Logo: hollow tilted ₿ as B (vector)
2 Home privacy: tap balance to hide
3 Receive BIP21 + copy → address options modal
4 Send balance same size as Home
5 Screen titles white, consistent size
6 Logo on screens that were missing it
7 Remove “< home” (system back only)
8–9 Better QR scan; hide QR when slide visible
10 Slide: white fill grows while dragging
11 Swap example BTC → USDT
12–19 Remove FX rate footer where marked
13 Amount also shows fiat rate
20 Graphic fix as indicated
21 Node: send/receive only, no channel management
