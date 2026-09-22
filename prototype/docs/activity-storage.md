# Basic Wallet — account activity storage

Canonical rules for multi-wallet history. Product UX: [`ux-ui-spec.md`](./ux-ui-spec.md). Arkade engine: [`arkade-wallet-tech-spec.md`](./arkade-wallet-tech-spec.md).

Inspired by Edge’s [core transaction database](https://github.com/EdgeApp/edge-plans/blob/master/2026-09/edge-core-transaction-database.md) **shape**, not its runtime (no WebView SQL bridge, no sqlite3mc amalgamation, no plugin authorizer).

## Central invariant

**The account database is disposable.** Nothing UI-critical lives only there without a rebuild path.

| Layer | File / store | Holds | Rebuild |
|-------|----------------|--------|---------|
| Engine cache | `basic-wallet-{network}-{walletId}.db` (SDK repos) | VTXO / UTXO / SDK `transactions` | Network resync via Arkade SDK |
| Account DB | `basic-account-{network}.db` | `wallet_registry`, `activity_idx`, `tx_meta`, `fiat_rate`, FTS | Rematerialize from engines + local meta |
| Secrets | Android Keystore | Mnemonic per `wallet_id` + DB encryption key (all networks) | User restore / passkey |

## Multi-wallet

- Registry rows: `kind` = `arkade` \| `lightning` \| `multisig`.
- Home shows **selected** wallet only (never a sum).
- Switcher (`01c`) + Add wallet (`14*`) create extra Arkade HD wallets (CSPRNG entropy for extras).
- One open Arkade engine at a time (selected wallet).

## Activity path

1. On `reloadWallet` / incoming notify / send: `materializeFromArkadeWallet` → upsert `activity_idx`.
2. Activity UI reads **DB first** (filter `wallet_id = selected`).
3. Pull-to-refresh: engine reload then rematerialize.
4. Notes live in `tx_meta` and feed FTS (`activity_fts`). **Factory reset keeps `tx_meta`** (and the local Path C cipher blob); both are wiped only on uninstall / clear app data.
5. Fiat: fill-on-write via `fiat_rate` + spot lookup; never blocks list reads.
6. Lightning: `upsertLightningPayments` writes the **same** `activity_idx` shape.

## Encryption (all networks)

**Mainnet and Mutinynet:** `basic-account-{network}.db` and engine `basic-wallet-{network}-*.db` **must** be SQLCipher-encrypted at rest (aligned UX). Mnemonic remains Keystore-only. This is a ship blocker for any network that holds user data, not optional polish.

### Chosen stack

Use **`expo-sqlite` config plugin `useSQLCipher: true`** ([Expo SQLite docs](https://docs.expo.dev/versions/latest/sdk/sqlite/#sqlcipher)), not a hand-vendored Edge-style amalgamation.

```json
["expo-sqlite", { "enableFTS": true, "useSQLCipher": true }]
```

Requires a **dev-client / EAS rebuild** (not Expo Go). After `openDatabase*`, **before any other statement**:

```ts
PRAGMA key = "x'<64 hex>'";  // raw 32-byte key preferred over passphrase+KDF on login path
-- then WAL / foreign_keys / busy_timeout
```

### Key material

| Rule | Detail |
|------|--------|
| Generate | 32 random bytes once per install (or per account identity), store in **SecureStore / Keystore** (`basic.account.db.key.v1`) |
| Scope | Same key for account + engine DBs on **both** mainnet and mutinynet |
| Never | Hardcode key; derive from mnemonic (couples DB open to seed load and complicates multi-wallet); put key in AsyncStorage |
| Unlock | Same device-unlock / biometrics policy as other SecureStore secrets; no second user passphrase for the local DB |
| Rotate | Optional later; wipe+rebuild is always valid (disposable invariant) |

Align with Edge’s lesson: **assert encryption actually engaged** (unknown `PRAGMA` is silently ignored). Probe that the file header is **not** plaintext `SQLite format 3\0`, and that a wrong key fails open.

### Scope

| File | Mainnet | Mutinynet |
|------|---------|-----------|
| `basic-account-{network}.db` | SQLCipher **required** | SQLCipher **required** |
| `basic-wallet-{network}-*.db` (engine) | SQLCipher **required** (same key) | SQLCipher **required** (same key) |
| Auto-backup | Exclude account + engine DBs from Android auto-backup / iOS backup | same |

Migration from an existing plaintext install: **delete file + rematerialize** (no in-place encrypt of live rows). Document in release notes.

### Implementation checklist

- [x] `app.json` / config plugin: `useSQLCipher: true` + FTS on
- [x] `openNetworkDatabase`: set key immediately after open; fail closed if cipher probe fails
- [x] SecureStore slot for DB key; create on first open
- [x] Exclude DB paths from backup (`allowBackup: false`)
- [ ] Automated test: wrong key → open fails; file header not plaintext
- [x] Engine-cache DBs: same cipher policy as account DB
- [x] Watch `libcrypto.so` merge conflicts if other native crypto deps appear (known Expo SQLCipher pitfall)

## Code map

| Module | Role |
|--------|------|
| `app/src/account/accountDb.ts` | Open / migrate account SQLite |
| `app/src/account/sqliteCipher.ts` | SQLCipher open + probe (all networks) |
| `app/src/account/walletRegistry.ts` | Switcher registry + selected id |
| `app/src/account/activityStore.ts` | Upsert / read / search |
| `app/src/account/txMeta.ts` | Notes / name / category |
| `app/src/account/fiatRate.ts` | Rate cache + backfill |
| `app/src/account/lightningActivity.ts` | LN → activity_idx adapter |
| `app/src/wallet/persistentStorage.ts` | Per-wallet SDK SQLite |
| `app/src/security/mnemonicStore.ts` | Per-wallet Keystore slots |
| `app/src/security/accountDbKey.ts` | DB encryption key |
| `app/src/config/networkPrefs.ts` | Active network + custom ASP |

## Non-goals

- Edge `EdgeTx` / `makeTx` / plugin SQL fence
- Vendoring sqlite3mc by hand (prefer Expo SQLCipher plugin)
- uint256 amount encoding (sats `INTEGER` is enough until multi-asset)
