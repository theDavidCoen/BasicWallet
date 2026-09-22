/**
 * Onchain fee wallet for graph-mode unilateral exit (same HD identity).
 */

import {
  EsploraProvider,
  MnemonicIdentity,
  OnchainWallet,
  type NetworkName,
} from "@arkade-os/sdk";
import { getNetworkConfig, type ArkadeNetworkId } from "../config/network";
import { loadMnemonicForCrypto } from "../security/mnemonicStore";

/** No address watchers — fee balance is polled explicitly. */
class NoWatchEsploraProvider extends EsploraProvider {
  override async watchAddresses(
    _addresses: string[],
    _callback: (txs: never[]) => void,
  ): Promise<() => void> {
    return () => {};
  }
}

export function exitNetworkName(networkId: ArkadeNetworkId): NetworkName {
  return networkId === "mainnet" ? "bitcoin" : "mutinynet";
}

export async function createFeeOnchainWallet(
  walletId: string,
  esploraUrl?: string,
): Promise<OnchainWallet> {
  const mnemonic = await loadMnemonicForCrypto(walletId);
  if (!mnemonic) throw new Error("No mnemonic in Keystore for wallet");

  const network = getNetworkConfig();
  const identity = MnemonicIdentity.fromMnemonic(mnemonic, {
    isMainnet: network.isMainnet,
  });
  const provider = new NoWatchEsploraProvider(esploraUrl ?? network.esploraUrl);
  return OnchainWallet.create(identity, exitNetworkName(network.id), provider);
}

export async function pollFeeBalance(
  onchain: OnchainWallet,
  signal?: AbortSignal,
): Promise<number> {
  if (signal?.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }
  return onchain.getBalance();
}
