# Arkade Lightning (intents)

**Status: implementing on [`david/arkadeLN`](https://github.com/theDavidCoen/BasicWallet/tree/david/arkadeLN).** Pay BOLT11 from an **Arkade seed** (Personal) via `@arkade-os/swap` (`client.pay`). Receive has no Lightning chip: when a solver mints a BOLT11 for the requested POS/BIP21 amount, it is embedded as `lightning=` on the unified URI.

Not Boltz. Not the optional Connect Lightning Node row. HD `walletMode` stays mandatory.

Engine rules stay in [`arkade-wallet-tech-spec.md`](./arkade-wallet-tech-spec.md) §3. UX: [`ux-ui-spec.md`](./ux-ui-spec.md) §6–§7, §12 (Confirm + biometrics, no auto-pay).
