/**
 * Explorer URLs — match arkade.money `src/lib/explorers.ts`.
 */

import type { ArkadeNetworkId } from "./network";

const WEB: Record<ArkadeNetworkId, string> = {
  mutinynet: "https://mutinynet.com",
  mainnet: "https://mempool.space",
};

/** Offchain / VTXO explorer (vmempool), as in official wallet. */
const VMEMPOOL: Record<ArkadeNetworkId, string> = {
  mutinynet: "https://explorer.mutinynet.arkade.sh",
  mainnet: "https://arkade.space",
};

export function getWebExplorerBase(networkId: ArkadeNetworkId): string {
  return WEB[networkId];
}

export function getVmempoolBase(networkId: ArkadeNetworkId): string {
  return VMEMPOOL[networkId];
}

export function onchainTxUrl(networkId: ArkadeNetworkId, txid: string): string | null {
  if (!txid) return null;
  return `${WEB[networkId]}/tx/${txid}`;
}

export function offchainTxUrl(networkId: ArkadeNetworkId, txid: string): string | null {
  if (!txid) return null;
  const base = VMEMPOOL[networkId];
  return base ? `${base}/tx/${txid}` : null;
}
