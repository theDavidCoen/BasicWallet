# Arkade Lightning (intents)

**Status: plan only.** Branch [`david/arkadeLN`](https://github.com/theDavidCoen/BasicWallet/tree/david/arkadeLN). Do not implement until David approves.

Pay BOLT11 from an **Arkade seed** (Personal) via `@arkade-os/swap` corridors (`client.pay`), same product model as [arkade.money](https://arkade.money). Not Boltz. Not the optional Connect Lightning Node row.

Receive LN into Arkade waits on a live solver **base** side. HD `walletMode` stays mandatory.

Engine rules stay in [`arkade-wallet-tech-spec.md`](./arkade-wallet-tech-spec.md) §3. UX: [`ux-ui-spec.md`](./ux-ui-spec.md) §6–§7, §12 (Confirm + biometrics, no auto-pay).
