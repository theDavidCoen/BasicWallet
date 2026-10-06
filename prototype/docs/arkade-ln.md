# Arkade Lightning (intents)

**Status: shipped on `main` in v0.9.0** ([release](https://github.com/theDavidCoen/BasicWallet/releases/tag/v0.9.0); PR [#24](https://github.com/theDavidCoen/BasicWallet/pull/24)).

Pay BOLT11 / LNURL / Lightning Address from an **Arkade seed** (Personal) via `@arkade-os/swap` (`client.pay`). Receive has no Lightning chip: when a solver mints a BOLT11 for the requested POS/BIP21 amount, it is embedded as `lightning=` on the unified URI.

Not Boltz. Not the optional Connect Lightning Node row. HD `walletMode` stays mandatory. Confirm + biometrics; no auto-pay.

Engine rules stay in [`arkade-wallet-tech-spec.md`](./arkade-wallet-tech-spec.md) §3. UX: [`ux-ui-spec.md`](./ux-ui-spec.md) §6–§7, §12.
