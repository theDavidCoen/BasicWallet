# Basic Wallet — Passkey, backup, and recovery

Canonical product rules for onboarding and backup. **Must match Penpot boards** in `penpot_rebuild_clean.py` (yellow notes in `penpot_apply_round3.py`). Interactive clicks live on page **11 Prototype**.

Related: [`ux-ui-spec.md`](./ux-ui-spec.md) (product UX), [`arkade-wallet-tech-spec.md`](./arkade-wallet-tech-spec.md) (Arkade engine).

## Penpot layout (design pages)

| Section | Boards |
|---------|--------|
| **00 · Onboarding** | `11 Onboarding Create`, `11b Terms of Use (passkey)`, `11b2 Terms of Use (device only)`, `11c Passkey not found`, `11d Ready`, `12 Advanced Backup`, `12d Nostr backup`, `12e Home server backup`, `12f Import nsec warning`, `12b Restore seed`, `12c Restore nsec`, `12h Restore home server` |
| **10 · Add wallet** | `14 Add wallet`, `14b Create without passkey`, `14c Name new wallet` |
| **06 · Settings** | `05e Backup`, `05h Passkey status`, `05d Nostr identity`, `05i Export nsec warning`, `05j Export nsec reveal`, `05k Generate identity warning`, `11e Export recovery phrase` (export is Settings-only) |

Board ids stay like `11 …` / `05 …`; section titles use the middle dot (`00 · Onboarding`).

---

## Goals

1. Default path feels like Glow/Breez: **passkey = key derivation** (WebAuthn PRF), not a server account.
2. Cross-OS restore: **encrypted multi-wallet package** (Nostr and/or home server) with **mandatory passphrase**.
3. Never silently create a new wallet when the expected passkey is missing → always `11c`.
4. Motion entropy only when adding an **extra** wallet without passkey (**never** first-run).
5. First wallet is an **Arkade HD** wallet (`walletMode: "hd"`). No seed words on onboarding.

## Threat model (short)

| Asset | Who must not get it |
|-------|---------------------|
| Wallet seeds | Relays, home server, Basic servers, OS screenshots |
| Passkey PRF output | Never leaves authenticator; app gets derived bytes only after UV |
| Backup passphrase | User only; required to unwrap Nostr/home packages |
| nsec | Device secure storage; paste is advanced + warned |

Recovery options: synced passkey, **24-word phrase** (Settings export), or **nsec + passphrase** package.

---

## Canonical captions (exact UI strings)

```
# Onboarding Create (taglines)
No seed phrase in setup.
OS passkey + multi-cloud backups.

# Restore hub (12b / 12c / 12h)
Restore won't use Passkey.
Seed = single wallet.
nsec / home server = encrypted package
(multiple wallets).

# Passkey missing (11c)
Continue with passkey found no match.
A new passkey = a different wallet.
Restore below, or try another account.

# Every Nostr / home package + passphrase screen
Lose this passphrase = lose wallet access.
Save it offline. Basic cannot recover it.

# Passphrase enable hint (12d / 12e)
Recommended: generate ~20+ random characters in a password manager and paste here. Do not use a short or memorable phrase.
# Terms of Use (11b / 11b2) — shared body
You alone control your keys and backups.
If you lose them with no backup, your bitcoin is gone.

Imported wallets are not automatically synced. Set up a Nostr or Home Server backup sync.

Basic is zero-knowledge:
• We cannot see your balances or transactions
• We cannot move, freeze, or recover your funds
• We cannot reset a lost passkey or passphrase
• We never store your seed or mnemonic
```

---

## Path A — Passkey (default)

1. Create WebAuthn passkey (iCloud Keychain / Google Password Manager / compatible PM).
2. `PRF(passkey, salt)` → 256-bit root → **BIP39 24-word** mnemonic (internal; never shown at create).
3. Fixed salt may derive Nostr identity; labeled child wallets for the switcher.
4. Wallet factory: Arkade `Wallet.create({ walletMode: "hd", … })`.
5. **Passkey onboarding is always cross-device.** `11b Terms of Use (passkey)` shows only **Across your devices** (never the device-only card).
6. Settings `05h` may still surface device-only risk if the OS later reports unsynced credentials.

### Happy path (first run)

```
11 Onboarding Create
  CTA "Continue"
→ 11b Terms of Use (passkey)   [Across your devices + ZK terms]
  CTA "I understand · Continue"
→ 11d Ready  ("YOU'RE READY" / "Opening wallet…")
  auto ~2s (prototype after-delay)
→ 01 Home   (wallet label: Personal)
```

### Without passkey (first run)

```
11 Onboarding Create
  CTA "Continue without passkey"
→ 11b2 Terms of Use (device only)   [This device only + same ZK terms]
  CTA "I understand · Continue"
→ 12 Advanced Backup
```

### Scenes

| Board | On-screen role |
|-------|----------------|
| `11 Onboarding Create` | Logo + taglines (**Your payments app…** / multi-cloud backups). Primary CTA: **Continue** (passkey). Text link under it: **Continue without passkey**. Footer: **Seed phrase or nsec? Restore here.** |
| `11b Terms of Use (passkey)` | Title **TERMS OF USE**. Card: **Across your devices** only. Shared ZK responsibilities. CTA: **I understand · Continue** → Ready. |
| `11b2 Terms of Use (device only)` | Title **TERMS OF USE**. Card: **This device only** only. Same ZK body. CTA → Advanced Backup. Hint: never mark safe without another backup. |
| `11c Passkey not found` | Same **Seed \| nsec \| Server** restore hub as `12b`, title **PASSKEY MISSING**, plus try other account / Create NEW semantics. Never silent new wallet. |
| `11d Ready` | **YOU'RE READY** · Passkey synced · Opening wallet… · **no CTA** (auto → Home). |
| `05h Passkey status` | Settings: Sync · Authenticator · **Export recovery phrase** · **Backup options** → `05e`. |
| `11e Export recovery phrase` | **Settings only.** 24 words after **biometrics and/or password/PIN**. Never onboarding. Never plaintext elsewhere. |

### Forbidden

- Seed create/export on first-run onboarding.
- Falling through to a new passkey when the expected one is missing (always `11c`).

---

## Path B — Extra wallet without passkey

**Not** first-run. Onboarding **Continue without passkey** opens Path C (Advanced Backup), not motion entropy.

```
01c Wallet switcher → + Create wallet
→ 14 Add wallet
   · With passkey → 14c Name new wallet
   · Without passkey → 14b Create without passkey → 14c Name new wallet
```

| Board | Copy / role |
|-------|-------------|
| `14 Add wallet` | ADD WALLET · With passkey (derive labeled wallet) · Without passkey (motion). |
| `14b Create without passkey` | ADD ENTROPY · motion pad · entropy meter · Continue to name wallet. |
| `14c Name new wallet` | NAME WALLET · label field · **Create wallet**. |

---

## Path C — Advanced encrypted package (cross-OS)

Solves iPhone → Android when passkey does not sync. **No seed reveal.**

### Entry

- Onboarding: **Continue without passkey** → `11b2 Terms of Use (device only)` → `12 Advanced Backup`
- Settings `05e`: **Nostr package + passphrase** → `12d`; **Home server + passphrase** → `12e`

### Package

- All wallets under one Nostr identity (seeds/descriptors/metadata for the switcher).
- AEAD ciphertext on relays or home server.
- `wrap_key = PBKDF2-SHA256(nsec || passphrase, salt, 50_000)` → AES-256-GCM — passphrase **always** required; nsec alone must not decrypt.
- **50k iters** for mobile UX; UI must recommend a **password-manager random** passphrase (~20+ chars). Weak memorable phrases are unsafe at this cost.
- Cipher blob stores `iters`; older blobs without it decrypt with legacy **210_000**.

### Scenes

| Board | Role |
|-------|------|
| `12 Advanced Backup` | ADVANCED BACKUP · cards **Nostr relays** / **Home server** · passphrase-loss caption. |
| `12d Nostr backup` | Relays + passphrase + confirm · **Enable Nostr backup**. |
| `12e Home server backup` | URL + **Nextcloud username + application password** and/or **Bearer token** + passphrase · Enable (WebDAV upload). |
| `12f Import nsec warning` | Gate before external nsec; social nsec OK if passphrase added. |

After enable on onboarding Path C → `11d Ready` → Home (same ready beat as Path A).

---

## Restore

### Entries

| From | Goes to |
|------|---------|
| Onboarding footer **Seed phrase or nsec? Restore here.** | `12b Restore seed` (Seed tab) |
| Passkey continue with no match | `11c Passkey not found` (same hub, missing caption) |
| Settings `05e` → **Restore wallet** | `12b Restore seed` |

### Hub (Seed \| nsec \| Server)

| Board | Tab body |
|-------|----------|
| `12b Restore seed` | BIP39 24 words + optional BIP39 passphrase · **Restore wallet** |
| `12c Restore nsec` | nsec + **backup passphrase · required** · multi-wallet package |
| `12h Restore home server` | URL + (username + app password and/or token) + nsec + passphrase · WebDAV download |

Segment control switches tabs (`Seed` / `nsec` / `Server`). Caption = `RESTORE_CAPTION` (or `PASSKEY_MISSING_CAPTION` on `11c`).

---

## Settings backup surfaces

### `05e Backup`

Sub: “Passkey by default. Encrypted package for cross-OS restore.”

| Row | Destination |
|-----|-------------|
| Passkey / OS cloud (status) | (info) / → `05h` |
| Export recovery phrase | `11e` |
| Nostr package + passphrase | `12d` |
| Home server + passphrase | `12e` |
| Restore wallet | `12b` |

Footer hint: lose backup passphrase → lose encrypted package access.

### `05d Nostr identity`

Profile: npub · NIP-05 · display name · Lightning address · about.

| Row / link | Destination |
|------------|-------------|
| Export nsec | `05i` → `05j` (screenshots blocked on reveal) |
| Import nsec | `12f` → restore nsec flow |
| Encrypted backup | `05e` / `12d` |
| Generate new identity | `05k` |

---

## Scene map

```
Onboarding (00 · Onboarding):
11 Create ─Continue (passkey)──► 11b Terms (passkey) ─I understand──► 11d Ready ─~2s──► Home
         │                              └ no match ──────────► 11c (Seed|nsec|Server)
         ├─Continue without passkey (text)──► 11b2 Terms (device only) ─► 12 Advanced ─► 12d / 12e ─► 11d Ready ─► Home
         └─Seed phrase or nsec? Restore here.─► 12b | 12c | 12h

Add wallet (10 · Add wallet) — extra only:
14 Hub → With passkey → 14c Name
       → Without passkey → 14b Motion → 14c Name

Settings (06 · Settings):
05h Passkey → 11e Export 24 words
05e Backup  → 11e | 12d | 12e | 12b
05d Nostr   → 05i→05j export · 12f import · 05k generate · encrypted backup
```

---

## Implementation notes (React Native / Expo)

- **App:** Expo → native **Android `.apk`**, package id **`app.basic.wallet`**. Not a PWA. Selectable network (mainnet / mutinynet + optional custom ASP).
- **Reproducible builds** required (same revision → verifiable APK).
- **Minimal permissions** only — see [`ux-ui-spec.md`](./ux-ui-spec.md) §0.
- **Seed security (highest priority):** mnemonic **only** in Android **Keystore**-backed storage. **Never** plaintext in UI, logs, or clipboard except **export** (`11e` / equivalent), and then **only after biometrics and/or password/PIN**. `FLAG_SECURE` on export. No seed on onboarding.
- Prefer platform WebAuthn / passkey APIs with **PRF** via `react-native-passkeys` (`app/src/onboarding/passkeyPrf.ts`). Requires verified `rpId` (`EXPO_PUBLIC_PASSKEY_RP_ID` / `basic.davidcoen.it`) with assetlinks + AASA; PRF needs Android 14+ / iOS 18+.
- Detect and surface authenticator **backup eligibility** / sync flags (`05h`; passkey create path is always cross-device on `11b`).
- Fail closed on wrong backup passphrase or failed export auth.
- Engine: Arkade HD + intents LN + unilateral exit v1 — see [`arkade-wallet-tech-spec.md`](./arkade-wallet-tech-spec.md). Screens: [`ux-ui-spec.md`](./ux-ui-spec.md).

## References

- Glow: https://github.com/breez/glow-web  
- Breez passkey: https://sdk-doc-spark.breez.technology/guide/passkey.html  
- Passkey login spec: https://github.com/breez/passkey-login/blob/main/spec.md  
- `./ux-ui-spec.md` · `./arkade-wallet-tech-spec.md`
