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
import { DEFAULT_MIN_VTXO_SATS } from "../wallet/arkMultiSend";
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

function readAssetAtomicFromBalance(raw: unknown, assetId: string): bigint {
  if (!raw || typeof raw !== "object") return 0n;
  const o = raw as Record<string, unknown>;
  const lists = [o.availableAssets, o.assets].filter(Array.isArray) as unknown[][];
  const want = assetId.toLowerCase();
  for (const list of lists) {
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const id = String(row.assetId ?? row.id ?? "").toLowerCase();
      if (id !== want) continue;
      const amt = row.amount;
      if (typeof amt === "bigint") return amt;
      if (typeof amt === "number" && Number.isFinite(amt)) return BigInt(Math.floor(amt));
      if (typeof amt === "string" && /^\d+$/.test(amt)) return BigInt(amt);
    }
  }
  return 0n;
}

async function readAvailableSats(wallet: IWallet): Promise<number> {
  const w = wallet as IWallet & {
    getSpendableVtxos?: () => Promise<Array<{ value?: number }>>;
    getBalance?: () => Promise<unknown>;
  };
  try {
    if (typeof w.getSpendableVtxos === "function") {
      const list = await w.getSpendableVtxos();
      let sum = 0;
      for (const v of list) sum += Number(v.value ?? 0);
      if (sum > 0) return sum;
    }
  } catch {
    /* fall through */
  }
  try {
    const raw = await w.getBalance?.();
    if (
      raw &&
      typeof raw === "object" &&
      typeof (raw as { available?: unknown }).available === "number"
    ) {
      return Math.floor((raw as { available: number }).available);
    }
  } catch {
    /* ignore */
  }
  return 0;
}

/**
 * Swap asset deposits omit `amount` so the SDK uses a dust sat carrier (~330).
 * If the wallet holds dust < sats < 2×dust, that leaves subdust change and ASP
 * rejects with AMOUNT_TOO_LOW. When giving the full stable balance, bump the
 * carrier to all spendable sats so the deposit consumes inputs with no change.
 */
function patchWalletSendForFullAssetDeposit(
  wallet: IWallet,
  assetId: string,
  dust: number,
): () => void {
  type SendFn = IWallet["send"];
  const w = wallet as IWallet & { send: SendFn };
  const originalSend: SendFn = w.send.bind(w);
  const want = assetId.toLowerCase();

  const patchedSend = ((...args: unknown[]) => {
    const run = async (): Promise<string> => {
      const params = args[0];
      if (params && typeof params === "object" && !Array.isArray(params)) {
        const p = params as {
          amount?: number;
          assets?: Array<{ assetId?: string; amount?: bigint | number | string }>;
        };
        const assets = p.assets;
        if (Array.isArray(assets) && assets.length > 0) {
          const give =
            assets.find((a) => String(a.assetId ?? "").toLowerCase() === want) ??
            assets[0];
          const giveAmt = (() => {
            const a = give?.amount;
            if (typeof a === "bigint") return a;
            if (typeof a === "number" && Number.isFinite(a)) {
              return BigInt(Math.floor(a));
            }
            if (typeof a === "string" && /^\d+$/.test(a)) return BigInt(a);
            return 0n;
          })();

          let liveAsset = 0n;
          try {
            const bal = await (
              wallet as IWallet & { getBalance: () => Promise<unknown> }
            ).getBalance();
            liveAsset = readAssetAtomicFromBalance(bal, assetId);
          } catch {
            /* ignore */
          }

          const givingAll = liveAsset > 0n && giveAmt >= liveAsset;
          const carrier =
            p.amount == null || !(Number(p.amount) > 0)
              ? dust
              : Math.floor(Number(p.amount));
          const availableSats = await readAvailableSats(wallet);
          const change = availableSats - carrier;
          if (
            givingAll &&
            availableSats >= dust &&
            change > 0 &&
            change < dust
          ) {
            console.warn(
              "[basic] swap fund bump asset carrier (avoid subdust change)",
              {
                carrier,
                availableSats,
                dust,
                giveAmt: String(giveAmt),
                liveAsset: String(liveAsset),
              },
            );
            return (originalSend as (...a: unknown[]) => Promise<string>)({
              ...(params as object),
              amount: availableSats,
            });
          }
        }
      }
      return (originalSend as (...a: unknown[]) => Promise<string>)(...args);
    };
    return run();
  }) as SendFn;

  w.send = patchedSend;

  return () => {
    w.send = originalSend;
  };
}

/**
 * Run BTC↔DePix exchange. Single-flight; caller surfaces converting overlay.
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
}): Promise<{ swapId: string; outcome: string; takeAmount?: bigint; giveAmount?: bigint }> {
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

    // depix-to-btc: asset deposit uses dust carrier; bump when full give would
    // leave subdust sats change (AMOUNT_TOO_LOW on output #1).
    const unpatch =
      direction === "depix-to-btc"
        ? patchWalletSendForFullAssetDeposit(
            wallet,
            depixAssetIdForNetwork(networkId),
            DEFAULT_MIN_VTXO_SATS,
          )
        : null;

    onProgress?.({ phase: "funding", message: "Funding swap…" });
    let swap: Awaited<ReturnType<typeof client.exchange>>;
    try {
      swap = await client.exchange({
        give,
        take,
        amount,
        amountOn: "give",
        maxFee,
      });
    } finally {
      unpatch?.();
    }

    onProgress?.({
      phase: "waiting",
      swapId: swap.id,
      message: "Waiting for fill…",
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
          onProgress?.({ phase: "waiting", swapId: swap.id, message: "Stopping…" });
          try {
            const { outcome } = await client.cancel(swap.id);
            finalOutcome = String(outcome);
          } catch (e) {
            console.warn("[basic] depix cancel failed", e);
          }
          onProgress?.({
            phase: finalOutcome === "filled" ? "filled" : "cancelled",
            swapId: swap.id,
            message: finalOutcome === "filled" ? "Conversion complete" : "Stopped",
          });
          return;
        }
        if (Date.now() - started > 10 * 60_000) {
          try {
            await client.cancel(swap.id);
          } catch {
            /* ignore */
          }
          throw new Error("Conversion timed out");
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    };

    try {
      await waitFilled();
    } finally {
      unsub();
    }

    return {
      swapId: swap.id,
      outcome: finalOutcome,
      takeAmount: swap.take?.amount,
      giveAmount: swap.give?.amount,
    };
  })();

  inflight = run;
  try {
    return (await run) as {
      swapId: string;
      outcome: string;
      takeAmount?: bigint;
      giveAmount?: bigint;
    };
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
