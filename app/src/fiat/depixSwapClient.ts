/**
 * Single-flight DePix swap driver for Fiat Mode.
 * Always keep cancel until fill; no Promise.race on watchers.
 */

import { asset, type IWallet } from "@arkade-os/sdk";
import {
  arkadeAsset,
  btcOn,
  createSwapClient,
  type SwapClient,
} from "@arkade-os/swap";
import type { ArkadeNetworkId } from "../config/network";
import { getAssetSwapRepository } from "../wallet/persistentStorage";
import {
  depixAssetIdForNetwork,
  fiatFeeBps,
  fiatMinBaseSats,
  fiatStableForNetwork,
} from "./depixAssets";
import depixSolverCard from "./depix-solver.card.json";
import usdtMutinySolverCard from "./usdt-mutiny-solver.card.json";

export type DepixSwapDirection = "btc-to-depix" | "depix-to-btc";

export type DepixSwapProgress = {
  phase: "quoting" | "funding" | "waiting" | "filled" | "cancelled" | "error";
  swapId?: string;
  message: string;
  error?: string;
};

type ClientCache = {
  walletId: string;
  client: SwapClient;
};

let clientCache: ClientCache | null = null;
let inflight: Promise<unknown> | null = null;

function bitcoinNetworkLabel(networkId: ArkadeNetworkId): "bitcoin" | "mutinynet" {
  return networkId === "mutinynet" ? "mutinynet" : "bitcoin";
}

export async function getOrCreateDepixSwapClient(
  wallet: IWallet,
  networkId: ArkadeNetworkId,
  walletId: string,
): Promise<SwapClient> {
  if (clientCache?.walletId === walletId) return clientCache.client;

  const repository = getAssetSwapRepository(networkId, walletId);
  const net = bitcoinNetworkLabel(networkId);
  const localCards =
    networkId === "mainnet"
      ? [{ card: depixSolverCard as object, network: "bitcoin" as const }]
      : networkId === "mutinynet"
        ? [{ card: usdtMutinySolverCard as object, network: "mutinynet" as const }]
        : [];

  const client = createSwapClient({
    wallet,
    repository,
    discovery: {
      localCards,
    },
  });
  await client.ready;
  clientCache = { walletId, client };
  void net;
  return client;
}

export function disposeDepixSwapClient(walletId?: string): void {
  if (walletId && clientCache?.walletId !== walletId) return;
  clientCache = null;
}

function maxFeeForTake(
  direction: DepixSwapDirection,
  amountGive: bigint,
  networkId: ArkadeNetworkId,
): { amount: bigint; asset: ReturnType<typeof btcOn> | ReturnType<typeof arkadeAsset> } {
  const BTC = btcOn("arkade", networkId === "mutinynet" ? "mutinynet" : "bitcoin");
  const DEPIX = arkadeAsset(
    networkId === "mutinynet" ? "mutinynet" : "bitcoin",
    asset.AssetId.fromString(depixAssetIdForNetwork(networkId)),
  );
  const feeBps = fiatFeeBps(networkId);
  // Generous ceiling: ~fee_bps on take + headroom.
  if (direction === "btc-to-depix") {
    // Amount is sats on give; unknown stable out — allow large take-side fee ceiling.
    const { decimals } = fiatStableForNetwork(networkId);
    const ceiling =
      decimals <= 2 ? 50_000_000n /* 500_000.00 USDT atomic */ : 50_000_000_000n;
    return { amount: ceiling, asset: DEPIX };
  }
  // Exit: take BTC — fee in sats
  const feeSats = BigInt(Math.ceil(Number(amountGive) * (feeBps / 10_000))) + 500n;
  return { amount: feeSats > 0n ? feeSats : 500n, asset: BTC };
}

/**
 * Run BTC↔DePix exchange. Single-flight; caller must surface loading + Cancel.
 * Resolves when filled or cancelled; rejects on hard errors.
 */
export async function runDepixExchange(opts: {
  wallet: IWallet;
  networkId: ArkadeNetworkId;
  walletId: string;
  direction: DepixSwapDirection;
  /** Sats when btc-to-depix; DePix atomic when depix-to-btc. */
  amount: bigint;
  onProgress?: (p: DepixSwapProgress) => void;
  signal?: AbortSignal;
}): Promise<{ swapId: string; outcome: string }> {
  if (inflight) {
    throw new Error("A conversion is already in progress");
  }

  const run = (async () => {
    const { wallet, networkId, walletId, direction, amount, onProgress, signal } = opts;
    const minBase = fiatMinBaseSats(networkId);
    if (direction === "btc-to-depix" && amount < BigInt(minBase)) {
      throw new Error(`Minimum convert is ${minBase.toLocaleString("en-US")} sats`);
    }

    onProgress?.({ phase: "quoting", message: "Preparing conversion…" });
    const client = await getOrCreateDepixSwapClient(wallet, networkId, walletId);

    const netLabel = networkId === "mutinynet" ? "mutinynet" : "bitcoin";
    const BTC = btcOn("arkade", netLabel);
    const DEPIX = arkadeAsset(
      netLabel,
      asset.AssetId.fromString(depixAssetIdForNetwork(networkId)),
    );

    const give = direction === "btc-to-depix" ? BTC : DEPIX;
    const take = direction === "btc-to-depix" ? DEPIX : BTC;
    const maxFee = maxFeeForTake(direction, amount, networkId);

    onProgress?.({ phase: "funding", message: "Funding swap…" });
    const swap = await client.exchange({
      give,
      take,
      amount,
      amountOn: "give",
      maxFee,
    });

    onProgress?.({
      phase: "waiting",
      swapId: swap.id,
      message: "Waiting for fill… You can cancel until filled.",
    });

    let settled = false;
    let finalOutcome = "open";

    const unsub = client.onUpdate(({ swap: s, outcome }) => {
      if (s.id !== swap.id) return;
      const o = String(outcome);
      if (o === "filled" || o === "paid" || o === "claimed") {
        settled = true;
        finalOutcome = "filled";
        onProgress?.({ phase: "filled", swapId: swap.id, message: "Conversion complete" });
      } else if (o === "cancelled" || o === "refunded") {
        settled = true;
        finalOutcome = "cancelled";
        onProgress?.({ phase: "cancelled", swapId: swap.id, message: "Conversion cancelled" });
      }
    });

    const waitFilled = async () => {
      const started = Date.now();
      while (!settled) {
        if (signal?.aborted) {
          onProgress?.({ phase: "waiting", swapId: swap.id, message: "Cancelling…" });
          try {
            const { outcome } = await client.cancel(swap.id);
            finalOutcome = String(outcome);
          } catch (e) {
            console.warn("[basic] depix cancel failed", e);
          }
          onProgress?.({
            phase: finalOutcome === "filled" ? "filled" : "cancelled",
            swapId: swap.id,
            message: finalOutcome === "filled" ? "Filled before cancel" : "Cancelled",
          });
          return;
        }
        if (Date.now() - started > 10 * 60_000) {
          try {
            await client.cancel(swap.id);
          } catch {
            /* ignore */
          }
          throw new Error("Conversion timed out — cancelled");
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    };

    try {
      await waitFilled();
    } finally {
      unsub();
    }

    return { swapId: swap.id, outcome: finalOutcome };
  })();

  inflight = run;
  try {
    return (await run) as { swapId: string; outcome: string };
  } finally {
    inflight = null;
  }
}

export async function cancelDepixSwap(opts: {
  wallet: IWallet;
  networkId: ArkadeNetworkId;
  walletId: string;
  swapId: string;
}): Promise<string> {
  const client = await getOrCreateDepixSwapClient(opts.wallet, opts.networkId, opts.walletId);
  const { outcome } = await client.cancel(opts.swapId as `offer:${string}` | `rfq:${string}`);
  return String(outcome);
}
