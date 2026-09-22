# Bug report: `UnilateralExit.prepare` signs HD sweeps with index-0 identity

**Package:** `@arkade-os/sdk`  
**Seen on:** `0.4.73` (also present in `0.5.0-rc.9` source: still `identity: wallet.identity` in `buildSignedSweep`)  
**Setup:** `walletMode: "hd"` + `MnemonicIdentity`  
**Network:** Mutinynet  
**Reported by:** David Coen · 2026-09-21  
**Audience:** Arklabs / SDK (internal)

## Summary

In HD mode, unilateral exit **prepare** builds sweep transactions with `wallet.identity.sign()`. That identity only holds the **index-0** key. VTXOs on rotated receive addresses use other derivation indexes, so `Transaction.finalize()` fails with:

```text
finalize/taproot: empty witness
```

Those VTXOs are then marked `skipped` on the exit package. A wallet with many rotated receives can end up with a package that lists all VTXOs but only includes a small recoverable subset (or none).

This is **not** an indexer / operator-offline issue. Path resolution can succeed; signing fails.

## Field evidence (Mutinynet, 2026-09-21)

HD client session on Mutinynet ASP:

| | |
|---|---|
| Pre-exit Arkade balance | ~**51 000** sats |
| Exit package that completed | swept only **710** sats to recovery (`tb1q3mdw5…`) |
| Leftover | ~**50 345** sats already unrolled onchain (CSV mature), needing `Unroll.completeUnroll` |
| After `completeUnroll` | **49 871** sats delivered to the same recovery (fee 474); recovery total **50 581** with the earlier 710 |

Interpretation: most rotated-index VTXOs never made it into a signed sweep during `prepare` / executor package construction (skipped / empty witness class of failure). The small included subset (710) exited normally; the rest had to be recovered via a separate `completeUnroll` path after bumps were already onchain.

## Scope

| Path | Uses wrong signer? | Notes |
|------|--------------------|--------|
| `UnilateralExit.estimate` / `prepare` → `buildSignedSweep` | **Yes** | `identity: wallet.identity` (index-0) |
| Executor sweeps from that package | Follow-on | Only what prepare signed is executable |
| `Unroll.completeUnroll` → `prepareUnrollTransaction` | **Same pattern** | ends in `await wallet.identity.sign(tx)` — rotated leaves can hit the same empty-witness failure unless the client proxies signing |

Boarding unilateral sweep already uses the descriptor-aware router (`signOnchainBoardingTx` → `InputSignerRouter`). Exit / complete-unroll do not.

## Reproduction

1. Create a wallet with `Wallet.create({ walletMode: "hd", identity: MnemonicIdentity.fromMnemonic(...), ... })`.
2. Receive funds across several HD receive rotations (multiple `default` / `delegate` contracts with distinct `metadata.signingDescriptor`).
3. Call `UnilateralExit.estimate` / `UnilateralExit.prepare` in `mode: "graph"` with a valid external sweep address.
4. Observe many VTXOs skipped with `finalize/taproot: empty witness` (example: 14 VTXOs on a funded Mutinynet wallet).

## Root cause

In `prepare`, sweeps are signed like this (simplified from the published `0.4.73` bundle):

```ts
const { tx } = await buildSignedSweep({
  // ...
  identity: wallet.identity, // index-0 / baseline key only
});
// buildSignedSweep → await identity.sign(tx) → signed.finalize()
```

Elsewhere the SDK already knows this is wrong for rotated keys. Boarding unilateral sweep uses the descriptor-aware router:

```ts
async signOnchainBoardingTx(tx) {
  const signed = await this._signerRouter.sign(
    tx,
    this.inputSigningJobsFromWitnessUtxos(tx),
  );
  return signed;
}
```

Comment in the SDK (boarding path) states that without the router, a rotated boarding UTXO would be signed with the wrong (index-0) key and rejected. The same applies to **offchain VTXO exit sweeps** (and to **completeUnroll**) in HD mode, but those paths still use raw `wallet.identity`.

`InputSignerRouter.classify` already maps `witnessUtxo.script` → contract → `metadata.signingDescriptor` and signs via `DescriptorProvider.signWithDescriptor`. Exit sweeps set `witnessUtxo.script` to the VTXO pkScript, so they are compatible with that router.

## Expected behavior

`UnilateralExit.prepare` / `buildSignedSweep` (and `Unroll.completeUnroll` / `prepareUnrollTransaction`) should sign each input with the key that owns that script (HD descriptor for that contract), same as settle / boarding exit.

## Suggested fix

In `buildSignedSweep` (or at the `prepare` / `prepareUnrollTransaction` call sites), prefer the wallet’s descriptor-aware signer when available, for example:

1. If `wallet` exposes `signOnchainBoardingTx` (or a public equivalent such as `signWithWitnessUtxos`), use it instead of `identity.sign`.
2. Or pass jobs into `InputSignerRouter.sign(tx, inputSigningJobsFromWitnessUtxos(tx))` the same way boarding does.
3. Keep `identity.sign` as fallback for static / non-HD wallets.

Optional API cleanup: expose a stable public method (e.g. `wallet.signInputsByWitnessScript(tx)`) so exit code does not depend on an `@internal` boarding helper.

## Temporary client workaround

Until the SDK fix lands, a client can proxy `wallet.identity.sign` during estimate/prepare/completeUnroll to `wallet.signOnchainBoardingTx(tx)` when that method exists. That unblocks HD exit packages locally; the proper fix still belongs in `@arkade-os/sdk`.

## Impact

- HD wallets cannot reliably prepare a full unilateral exit package when funds sit on rotated receive indexes.
- Users may see “exit completed” for a tiny recoverable amount while most balance is stranded until a separate `completeUnroll` (or re-prepare after a client workaround).
- Static / single-key wallets may be unaffected.
- Easy to misread as “missing exit data / indexer down” because skipped VTXOs surface as prepare failures after the fact.

## Ask

Please route HD exit sweeps (and complete-unroll signing) through `InputSignerRouter` (or equivalent) in `UnilateralExit.prepare` / `Unroll.completeUnroll`, and add a regression test: HD wallet with VTXOs on index > 0 must produce a package with those VTXOs included (not skipped with empty witness).
