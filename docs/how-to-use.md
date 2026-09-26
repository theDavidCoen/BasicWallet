# How to use Basic

**Experimental wallet.** Do not store meaningful funds. Read the [README](../README.md) warnings first.

This page covers everyday flows, gestures/shortcuts, and advanced options as of the current alpha on `main`.

## First launch

1. Create with **passkey** (recommended) or continue **without passkey** (device-only + Advanced Backup).
2. Or **restore** from seed / Nostr package / home server (Settings → Restore, or onboarding footer).
3. Prefer a backup before you receive funds: passkey and/or Advanced Backup (Nostr / home server).

Settings → About shows version + git commit for the APK you installed.

## Basic features

### Home

- **Balance** — tap the amount to hide/show; tap **⇅** (when not in Fiat Mode) to cycle sats / fiat display units.
- **Receive / Send** — primary actions under the balance.
- **Wallet avatar** (top left) — open the wallet switcher (Arkade Personal / extras, Lightning wallets).
- **FIAT MODE badge** — shown when Fiat Mode is on for the selected Arkade wallet.

### Receive

- Opens classic Receive (QR / address modes).
- In **Fiat Mode**, default emphasis is the stable unit (BRL via DePix on mainnet, USD/USDT on Mutinynet); Universal BIP21 and Arkade chips remain available.
- **POS** is a side sheet (see [Shortcuts](#shortcuts--gestures)).

### Send

- Destination actions: **Enter**, **Paste**, **My wallets** (when you have other Arkade wallets), **Scan**.
- **+ Add recipient** for multisend (several `ark…` lines with amounts).
- In Fiat Mode, amounts are in the stable unit; pays with the stable asset when possible (or converts as needed for sats destinations).

### Activity

- Bottom sheet from Home (see shortcuts). Tap a row for detail, notes, and related actions.

### Settings (highlights)

| Row | Purpose |
|-----|---------|
| Bitcoin Maxi Mode | Auto-swap inbound alt-assets → sats when Fiat Mode is off (default ON) |
| Fiat Mode | Enter/exit stable unit mode; pick available stable card |
| Contacts | Private directory; Nostr share |
| Backup | Passkey status, Nostr package, home server |
| Restore | Seed / nsec package / home server |
| Network / ASP | Mainnet, Mutinynet, optional custom ASP |
| About | Version, commit, ASP info |

Long-press empty chrome on Home, or tap the rate footer when shown, also opens Settings.

---

## Shortcuts / gestures

These are easy to miss; they are part of the real Home / Send UX.

### Home

| Gesture / control | What it does |
|-------------------|--------------|
| **Pull / drag the bottom handle up** (or tap the handle) | Open **Activity** sheet |
| **Swipe left → right** (LTR) on Home | Open **POS** (point of sale / request) side page |
| **Swipe right → left** (RTL) on Home | Open **Scan QR** side page |
| **R$** button (header, Arkade wallet) | Enter Fiat Mode sheet |
| **₿** button (header, while Fiat Mode on) | Exit Fiat Mode sheet |
| Tap **balance** | Hide / show amounts |
| **⇅** next to balance | Cycle balance unit (disabled while Fiat Mode is on) |
| Tap **avatar** | Wallet switcher |
| Long-press empty header chrome | Settings |
| Tap rate footer (when visible) | Settings |
| Mutinynet / exit badges (header) | Explorer or Unilateral Exit hub |

While Activity, POS, or Scan is open, competing Home swipes are locked so sheets do not fight each other.

### Send

| Control | What it does |
|---------|--------------|
| **Enter** | Type / confirm a destination |
| **Paste** | Clipboard → destination (Arkade / Lightning-shaped payloads where supported) |
| **My wallets** | Pick another of your Arkade wallets as destination |
| **Scan** | Camera QR → destination |
| **+ Add recipient** | Another line for multisend |
| **Max** | Fill amount from spendable balance |
| **Clear** | Remove the current destination |

### Receive / POS

| Control | What it does |
|---------|--------------|
| POS side page (from Home swipe) | Keypad request flow; Fiat Mode can offer Fiat \| Bitcoin URI chips |
| Classic Receive modes | BIP21 / Arkade / stable (when in Fiat Mode) |

---

## Fiat Mode

Per **selected Arkade wallet** only.

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

## Advanced features

### Backup and restore

- **Passkey** — Personal seed + Nostr identity from PRF; rematerialize on a new device with the same passkey.
- **Advanced Backup (Path C)** — passphrase-wrapped AEAD package (wallets, notes, contacts, Fiat/Maxi prefs) on Nostr relays and/or home server (WebDAV). Lose the passphrase → lose the package.
- **Restore** — seed words, or nsec + backup passphrase (package), or home server download.

### Contacts

- Local encrypted directory; optional always-on Nostr directory sync (separate from Path C passphrase).
- Share a contact over Nostr gift wraps when identity is set.

### Lightning

- Connect a node (BTCPay LND REST / LNDHub) from Add Wallet / Settings.
- LN send/receive and Arkade↔Lightning intents where wired; not a full Lightning wallet product.

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

GitHub Releases: [theDavidCoen/BasicWallet/releases](https://github.com/theDavidCoen/BasicWallet/releases). Prefer arm64-v8a builds + verify SHA256 (and PGP on the checksum when present).

Reproducible recipe: [`reproducible-builds.md`](./reproducible-builds.md).
