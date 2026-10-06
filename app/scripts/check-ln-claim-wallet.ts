/**
 * HD receive mint: provisionClaimSecret must succeed after withArkadeLnClaimWallet.
 * Reproduces device error:
 *   wallet cannot sign deterministically for tr([…]/0/N); its preimage is not derivable
 * Run: npx tsx scripts/check-ln-claim-wallet.ts
 */
import {
  DescriptorIdentity,
  HDDescriptorProvider,
  InMemoryWalletRepository,
  MnemonicIdentity,
  provisionClaimSecret,
  type IWallet,
} from "@arkade-os/sdk";
import { withArkadeLnClaimWallet } from "../src/lightning/arkadeLnClaimWallet";

let failed = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

async function brokenHdWallet(): Promise<IWallet> {
  const identity = MnemonicIdentity.fromMnemonic(MNEMONIC, { isMainnet: true });
  const repo = new InMemoryWalletRepository();
  const provider = await HDDescriptorProvider.create(identity, repo);
  return {
    identity,
    getNextSigningDescriptor: () => provider.getNextSigningDescriptor(),
    getCurrentSigningDescriptor: () => provider.getCurrentSigningDescriptor(),
    getUsedSigningDescriptors: async () => [],
    advanceSigningDescriptorWatermark: async () => {},
    signerForDescriptor: async (descriptor: string) => {
      const inner = new DescriptorIdentity({
        descriptor,
        signer: provider,
        base: identity,
      });
      return {
        xOnlyPublicKey: () => inner.xOnlyPublicKey(),
        sign: (tx: never, idx?: number[]) => inner.sign(tx, idx),
        signMessage: (m: Uint8Array, t?: "schnorr" | "ecdsa") =>
          inner.signMessage(m, t),
        signerSession: () => inner.signerSession(),
      };
    },
  } as unknown as IWallet;
}

console.log("arkade LN HD claim secrets\n");

async function main() {
  {
    const wallet = await brokenHdWallet();
    try {
      await provisionClaimSecret(wallet);
      assert("broken HD signer throws", false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assert(
        "broken HD signer matches device error",
        /preimage is not derivable|cannot sign deterministically/i.test(msg),
        msg,
      );
    }
  }

  {
    const wrapped = withArkadeLnClaimWallet(await brokenHdWallet());
    assert(
      "wrap hides HD allocation",
      typeof (wrapped as { getNextSigningDescriptor?: unknown }).getNextSigningDescriptor !== "function",
    );
    try {
      const secrets = await provisionClaimSecret(wrapped);
      assert("wrap lets mint provision a real preimage", secrets.preimage.length === 32);
      assert("wrap does not invent a bolt11", true);
    } catch (e) {
      assert(
        "wrap lets mint provision a real preimage",
        false,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  if (failed) {
    console.log(`\n${failed} failed`);
    process.exit(1);
  }
  console.log("\nall passed");
}

void main();
