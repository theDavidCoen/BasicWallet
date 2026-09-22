# Basic Wallet — Arkade wallet technical spec

Canonical engine rules for the **first onboarding wallet** (and every later Arkade seed wallet). Product UX/UI: [`ux-ui-spec.md`](./ux-ui-spec.md). Passkey / backup: [`backup-passkey-nostr.md`](./backup-passkey-nostr.md). This file owns **SDK/protocol** requirements only.

**Status:** product requirements (implement against current `@arkade-os/sdk` + `@arkade-os/swap`).  
**Client:** Expo → native Android APK, package **`app.basic.wallet`**. Selectable network (mainnet / mutinynet + optional custom ASP; Settings → Arkade → Network). **Reproducible** builds; **minimal permissions**.  
**Seed security:** mnemonic **Keystore-only** at rest; **never** plaintext in UI/logs except user export after **biometrics / password** — [`ux-ui-spec.md`](./ux-ui-spec.md) §0.1.  
**Arkade behavior reference (canonical):** [arkade.money](https://arkade.money) / clone `~/Documenti/Arkade/wallet` ([arkade-os/wallet](https://github.com/arkade-os/wallet)). Match official patterns for create/balance/incoming/restore; adapt to Expo. Do **not** invent watcher/poll loops.  
**Inspiration (structure only):** [edge-arkade-integration](https://github.com/theDavidCoen/edge-arkade-integration) — Edge Grana prototype. That stack used an older SDK with **Boltz**; do **not** copy Boltz paths.

---

## 1. What the first wallet is

| Item | Requirement |
|------|-------------|
| Kind | **Arkade** software wallet (VTXOs under the Arkade operator) |
| Key material | BIP39 24-word mnemonic from passkey PRF (default onboarding) or motion/CSPRNG (extra wallets only) |
| Identity | Prefer `MnemonicIdentity` / `SeedIdentity` from `@arkade-os/sdk` |
| Mode | **HD** — see §2 |
| Label (UX) | Default switcher name **Personal** (tag `main`) |

Lightning from a **user-linked LND / BTCPay / NWC** node is a **separate** switcher row (node balance), not this Arkade wallet. Multisig and hardware are later products on top of other flows.

---

## 2. HD mode (mandatory)

Every `Wallet.create` for a Basic seed wallet **must** pass:

```ts
import { MnemonicIdentity, Wallet } from "@arkade-os/sdk";

const wallet = await Wallet.create({
  identity: MnemonicIdentity.fromMnemonic(mnemonic),
  arkServerUrl /* or arkProvider / indexerProvider */,
  walletMode: "hd",
  // …storage, network, adapters…
});
```

### Why

- Without an explicit `walletMode: "hd"`, the SDK keeps a **single non-rotating receive address**.
- HD allocates fresh receive / signing descriptors (gap restore, privacy, swap secrets).
- Corridor Lightning intents derive preimages from a **freshly allocated signing descriptor** on HD wallets; single-key mode cannot do that and must persist random preimages ([corridor swaps](https://docs.arkadeos.com/intents/reference/corridor-swaps)).

### Hard rules

- Never ship production create/import without `walletMode: "hd"`.
- After create: `restore({ gapLimit })` (Edge used `20`; tune to product QA).
- Do not use `walletMode: "static"` except ephemeral lab fixtures (docs developer-preview examples are not the Basic default).

---

## 3. Lightning ↔ Arkade: Intents only (no Boltz)

| Direction | Mechanism | Package |
|-----------|-----------|---------|
| `arkade:BTC → lightning:BTC` | Intent / RFQ corridor (pay BOLT11) | `@arkade-os/swap` + transport (e.g. `nostrRfqTransport`) |
| `lightning:BTC → arkade:BTC` | Intent / RFQ corridor (receive) | same |
| Asset / other corridors | Intents | `@arkade-os/swap` as documented |

**Forbidden**

- `@arkade-os/boltz-swap`
- Boltz submarine / reverse / `arkToBtc` as the LN or on-chain bridge
- Any UI or plugin path that assumes Boltz swap ids in history

Official docs mark Boltz client/service **retired** — use [Integrate Lightning](https://docs.arkadeos.com/intents/integrate/lightning).

### Edge delta (do not copy)

Edge Grana routed LN and many on-chain exits through Boltz, with ASP settle as fallback. Basic Wallet:

1. LN send/receive from Personal → **intents** (`requestLightningSend` / receive corridor APIs).
2. Everyday **direct on-chain** Send is **not** the soft-wallet path (UX gate: node / multisig / HW) — see `ux-ui-spec.md` §7.
3. Collaborative on-chain offboard / unilateral exit → Settings escape hatches (ASP settle / Unroll), not Boltz and not normal Send.
4. Unilateral exit package/unroll → §4.

Catch `SwapRefusal`, verify `quote.pair`, fund with `payment.fundAmount` (fee = spread), persist/watch contracts; refund stalled sends via documented refund helpers. Prefer HD so swap secrets stay descriptor-derived.

### UX mapping (Penpot)

- Home **Swap** when a **seed** wallet is selected may use asset-intent corridors (e.g. BTC→USDT).
- Home **Swap** when **Lightning node** is selected: **Taproot Assets only if the node supports them**; otherwise the Swap control is **hidden** (product UX: `ux-ui-spec.md` §8).
- Paying BOLT11 from Personal → **intents** (`@arkade-os/swap`), never Boltz.
- **Direct on-chain** Send (`bc1…` → `bc1…`, no swap): **not** from soft Arkade seed alone. Only Lightning node, multisig, or seed **with** hardware — see `ux-ui-spec.md` §7. Soft Personal stays L2 (`ark…`, intents).
- Receive address options: Arkade address + boarding / on-chain as SDK exposes; LN invoice when corridor/solver or linked node applies.

### Send / offboard (engine)

- Soft wallet Send: off-chain Arkade + LN intents. Do **not** expose Boltz `arkToBtc` or treat collaborative settle as a normal Send-to-`bc1` path for software-only wallets.
- Collaborative settle / unilateral exit remain **Settings** escape hatches, not everyday Send.

---

## 4. Unilateral exit (day one)

Unilateral exit is a **v1 requirement**, not a later “power user” add-on.

Users must be able to exit to an **external Bitcoin address they control** if the operator is offline, censoring, or untrusted — without depending on collaborative settle.

### Product surface (shipped in Expo)

- Settings → **Unilateral exit** hub: collaborative withdraw vs unilateral prepare/execute.
- Sweep destination: user-pasted external `bc1…` / `tb1…` (app is not a full onchain spend wallet). Settings **Recovery address** is the default for auto-prepare.
- **Graph-mode** package via `UnilateralExit.estimate` / `prepare`; stored as **AES-GCM** (key in SecureStore, ciphertext in AsyncStorage).
- **Auto-prepare** (debounced ~45s after balance ready) when a recovery address is set; fingerprint skips redundant work.
- One-shot Home reminder after Arkade balance ≥ 50 000 sats if no recovery address (dismissible).
- **In-app executor** via `UnilateralExit.Executor` / `execute` with `OnchainWallet` fee funding from the same HD identity (not a website-generated fee key).
- Local readiness: `SQLiteVirtualTxRepository` + `exitDataCapture: { mode: "full" }` so exit branches persist without re-querying the indexer after capture.
- Auth gate (`requireUserPresence`) before prepare, export, and execute; duress must not reveal the real package when that mode ships.

### SDK anchors

- Concepts: [Unilateral exit / security model](https://docs.arkadeos.com/learn/core-concepts/security-and-trust-model#unilateral-exit)
- Process: [Ramps](https://docs.arkadeos.com/wallets/advanced/ramps) + SDK `UnilateralExit` (preferred over legacy `Unroll.Session` for package/executor path)
- Optional external tool: [arkade-unilateral-exit](https://github.com/arkade-os/arkade-unilateral-exit) (export package only; not the default Basic fee path)

### Implementation expectations

- Persist VTXO chains / virtual txs so exit remains possible when the indexer is unreachable (after local capture / prepared package).
- Separate **collaborative offboard** (`Ramps.offboard`) from **unilateral prepare/execute**.
- Fee estimate before prepare; fund fee address only at execute (graph mode).
- Never conflate Boltz on-chain swaps with unilateral exit.

### Liveness

Keep VTXO renewal / settlement so unilateral paths stay economically usable (expiry / depth). Background renewal is OK; surface expiry risk if renewal fails.

---

## 5. Suggested module map (React Native app)

Not binding package names; mirrors Edge plugin responsibilities without Edge/Boltz coupling. Target: RN → Android APK first.

| Area | Responsibility |
|------|----------------|
| Wallet factory | Single-flight `Wallet.create({ walletMode: "hd", … })` per selected `wallet_id`; identity from passkey PRF / restore / CSPRNG for extras |
| Wallet registry | Account SQLite `wallet_registry` — Personal + extra seed wallets + optional Lightning row ([`activity-storage.md`](./activity-storage.md)) |
| Storage (engine) | SDK **wallet + contract + intent + virtualTx** repositories via **expo-sqlite**, **one DB file per network+walletId**, `exitDataCapture.mode: "full"`. Cache only — **mnemonic only via Keystore** (slot per wallet). |
| Storage (account) | `basic-account-{network}.db`: `activity_idx`, `tx_meta`, `fiat_rate`, FTS — disposable, rematerialized from engines. **SQLCipher required on all networks** ([`activity-storage.md`](./activity-storage.md) § Encryption) |
| Balance / history | `getBalance` → Home; Activity reads `activity_idx` (materialize on reload) |
| Send | Soft: `ark…` + LN intents. Direct `bc1…` only if UX allows (node / multisig / HW) |
| Receive | Rotating HD Arkade addresses; boarding address when boarding; while Boarding tab focused, poll `getBalance` (no Esplora `watchAddresses`); **Complete boarding** → `Ramps.onboard` (arkade.money settle path) |
| Swaps | `@arkade-os/swap` only |
| Exit | In-app `UnilateralExit` graph prepare + Executor; collaborative `Ramps.offboard` |
| Watchers | One `notifyIncomingFunds` + 1s debounce `reloadWallet` + always `stop()`; NoWatchEsplora; restore only on import; startup `renewVtxos`; `activityEpoch` refreshes Activity |
| Explorers | Onchain: mutinynet.com / mempool.space; offchain: explorer.mutinynet.arkade.sh / arkade.space (`app/src/config/explorers.ts`, mirrors arkade.money `lib/explorers.ts`) |

---

## 6. Acceptance checklist

- [ ] First onboarding wallet is Arkade with `walletMode: "hd"`.
- [ ] Fresh receive addresses rotate (not a single static address for the life of the wallet).
- [ ] Mnemonic never leaves Keystore as plaintext except authenticated export (biometrics/password).
- [ ] Before first release APK: `basic-account-{network}.db` opened with SQLCipher (`expo-sqlite` `useSQLCipher`) and Keystore-held key (mainnet **and** mutinynet); cipher probe + backup exclusion — see [`activity-storage.md`](./activity-storage.md).
- [ ] Settings → Arkade → Network: switch mainnet/mutinynet + optional custom ASP; confirm → soft remount (`remountAppForNetworkSwitch`).
- [ ] No dependency on `@arkade-os/boltz-swap` or Boltz endpoints.
- [ ] Paying a BOLT11 from Arkade balance uses the intents Lightning send corridor.
- [ ] Receiving into Arkade via Lightning uses the intents receive corridor when a solver exists (surface solver unavailability honestly).
- [x] Unilateral exit is reachable in Settings from first funded wallet; package or unroll path works against current SDK docs.
- [ ] Collaborative settle remains the happy-path offboard when the operator is healthy.

---

## 7. References

- Create wallet: https://docs.arkadeos.com/wallets/getting-started/create-your-wallet  
- Lightning intents: https://docs.arkadeos.com/intents/integrate/lightning  
- Corridor swaps (HD preimage): https://docs.arkadeos.com/intents/reference/corridor-swaps  
- Boltz deprecated: https://docs.arkadeos.com/contracts/lightning-swaps  
- Unilateral exit: https://docs.arkadeos.com/wallets/advanced/ramps  
- **Product reference (Arkade behavior):** https://arkade.money — source `~/Documenti/Arkade/wallet` (`providers/wallet.tsx`, `lib/asp.ts`, `lib/explorers.ts`)  
- Edge reference (Boltz-era): https://github.com/theDavidCoen/edge-arkade-integration  
- Product UX/UI: `./ux-ui-spec.md`  
- Passkey / backup: `./backup-passkey-nostr.md`
- Account activity / multi-wallet storage: `./activity-storage.md`
