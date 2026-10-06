/**
 * Dedicated Arkade Lightning corridor client (intents / @arkade-os/swap).
 * Not the optional Connect Lightning Node row. Not DePix localCards.
 *
 * Watchers: onUpdate + timer sleep, always unsubscribe in finally.
 * Never Promise.race on waitForIncomingFunds / Esplora.
 */

import type { IWallet } from "@arkade-os/sdk";
import {
  btcOn,
  createSwapClient,
  DiscoverySnapshotUnavailable,
  isSwapError,
  type SwapClient,
} from "@arkade-os/swap";
import type { ArkadeNetworkId } from "../config/network";
import { getAssetSwapRepository } from "../wallet/persistentStorage";
import {
  friendlyLnInvoiceError,
  toArkadeLnInvoiceFacts,
} from "./arkadeLnInvoice";
import betaSolverCard from "./beta-solver.card.json";

const FUNDED_OUTCOMES = new Set([
  "funded",
  "paying",
  "paid",
  "filled",
  "claimed",
]);
const FAILED_OUTCOMES = new Set([
  "cancelled",
  "refunded",
  "refunding",
  "failed",
  "lapsed",
  "needs_recovery",
]);

const FUND_WAIT_MS = 90_000;
const MAINNET_EMULATOR_PUBKEY =
  "0239c196415da47b26456a101daaa12ba9e445bfe153197f1e2b750bf40e52092e";

type ClientCache = {
  walletId: string;
  networkId: ArkadeNetworkId;
  client: SwapClient;
};

let clientCache: ClientCache | null = null;

function bitcoinNetworkLabel(networkId: ArkadeNetworkId): "bitcoin" | "mutinynet" {
  return networkId === "mutinynet" ? "mutinynet" : "bitcoin";
}

function maxFeeSats(amountSats: number): bigint {
  const pct = Math.ceil(amountSats * 0.02);
  return BigInt(Math.max(500, pct) + 500);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Payment cancelled."));
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("Payment cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function friendlyArkadeLnError(err: unknown): string {
  if (isSwapError(err)) {
    switch (err.name) {
      case "UnsupportedRoute":
        return "No Lightning corridor on this network right now.";
      case "InsufficientFunds":
        return "Not enough Arkade balance to fund this Lightning payment (invoice plus corridor fee).";
      case "MaxFeeExceeded":
        return "Corridor fee is higher than the allowed maximum.";
      case "QuoteExpired":
        return "The Lightning quote expired. Try again.";
      case "AmountMismatch":
        return "Invoice amount does not match the requested amount.";
      case "DiscoverySnapshotUnavailable":
        return "Lightning solvers are unreachable. Try again later.";
      default:
        return err.message || "Lightning corridor failed.";
    }
  }
  if (err instanceof DiscoverySnapshotUnavailable) {
    return "Lightning solvers are unreachable. Try again later.";
  }
  return friendlyLnInvoiceError(err);
}

/**
 * Swap client whose discovery includes the Lightning corridor (registry +
 * bundled mainnet solver card). Separate from Fiat Mode's DePix-only cards.
 */
export async function getOrCreateArkadeLnClient(
  wallet: IWallet,
  networkId: ArkadeNetworkId,
  walletId: string,
): Promise<SwapClient> {
  if (
    clientCache?.walletId === walletId &&
    clientCache.networkId === networkId
  ) {
    return clientCache.client;
  }

  const repository = getAssetSwapRepository(networkId, walletId);
  const net = bitcoinNetworkLabel(networkId);
  const localCards =
    networkId === "mainnet"
      ? [{ card: betaSolverCard as object, network: "bitcoin" as const }]
      : [];

  const client = createSwapClient({
    wallet,
    repository,
    discovery: { localCards },
    ...(networkId === "mainnet" ? { emulatorPubkey: MAINNET_EMULATOR_PUBKEY } : {}),
  });
  await client.ready;
  clientCache = { walletId, networkId, client };
  void net;
  return client;
}

export function disposeArkadeLnClient(walletId?: string): void {
  if (walletId && clientCache?.walletId !== walletId) return;
  clientCache = null;
}

export type ArkadeLnQuotePreview = {
  invoiceSats: number;
  feeSats: number;
  fundSats: number;
  marketPair?: string;
};

export async function previewArkadeLnPay(opts: {
  wallet: IWallet;
  networkId: ArkadeNetworkId;
  walletId: string;
  bolt11: string;
  signal?: AbortSignal;
}): Promise<ArkadeLnQuotePreview> {
  const facts = toArkadeLnInvoiceFacts(opts.bolt11, opts.networkId);
  if (opts.signal?.aborted) throw new Error("Payment cancelled.");
  const client = await getOrCreateArkadeLnClient(
    opts.wallet,
    opts.networkId,
    opts.walletId,
  );
  const quote = await client.quote({ to: facts.raw });
  const fundSats = Number(quote.give.amount);
  const invoiceSats = Number(quote.take.amount);
  const feeSats = Number(quote.fee.amount);
  return {
    invoiceSats: invoiceSats > 0 ? invoiceSats : facts.amountSats,
    feeSats: feeSats > 0 ? feeSats : Math.max(0, fundSats - facts.amountSats),
    fundSats: fundSats > 0 ? fundSats : facts.amountSats + feeSats,
    marketPair: quote.market.kind === "card" ? quote.market.pair : undefined,
  };
}

export type ArkadeLnPayResult = {
  swapId: string;
  invoiceSats: number;
  fundSats: number;
  feeSats: number;
  outcome: string;
};

export async function payArkadeLightning(opts: {
  wallet: IWallet;
  networkId: ArkadeNetworkId;
  walletId: string;
  bolt11: string;
  signal?: AbortSignal;
}): Promise<ArkadeLnPayResult> {
  const facts = toArkadeLnInvoiceFacts(opts.bolt11, opts.networkId);
  if (opts.signal?.aborted) throw new Error("Payment cancelled.");

  const client = await getOrCreateArkadeLnClient(
    opts.wallet,
    opts.networkId,
    opts.walletId,
  );
  const BTC = btcOn("arkade", bitcoinNetworkLabel(opts.networkId));
  const result = await client.pay(facts.raw, {
    maxFee: { amount: maxFeeSats(facts.amountSats), asset: BTC },
  });
  if (result.kind !== "swap") {
    throw new Error("Unexpected payment result for Lightning invoice.");
  }

  const swapId = result.swap.id;
  const give = Number(result.swap.give.amount);
  const take = Number(result.swap.take.amount);
  const fee = Number(result.swap.fee.amount);
  const fundSats = give > 0 ? give : facts.amountSats + (fee > 0 ? fee : 0);
  const invoiceSats = take > 0 ? take : facts.amountSats;
  const feeSats = fee > 0 ? fee : Math.max(0, fundSats - invoiceSats);

  let settled = false;
  let finalOutcome = "open";
  const unsub = client.onUpdate(({ swap: s, outcome }) => {
    if (s.id !== swapId) return;
    const o = String(outcome);
    if (FUNDED_OUTCOMES.has(o)) {
      settled = true;
      finalOutcome = o;
    } else if (FAILED_OUTCOMES.has(o)) {
      settled = true;
      finalOutcome = o;
    }
  });

  try {
    const started = Date.now();
    while (!settled) {
      if (opts.signal?.aborted) {
        try {
          await client.cancel(swapId);
        } catch (e) {
          console.warn("[basic] arkade ln pay cancel failed", e);
        }
        throw new Error("Payment cancelled.");
      }
      if (Date.now() - started > FUND_WAIT_MS) {
        throw new Error("Lightning payment timed out waiting for lockup.");
      }
      await sleep(400, opts.signal);
    }
  } finally {
    unsub();
  }

  if (!FUNDED_OUTCOMES.has(finalOutcome)) {
    throw new Error(`Lightning payment failed (${finalOutcome}).`);
  }

  return {
    swapId,
    invoiceSats,
    fundSats,
    feeSats,
    outcome: finalOutcome,
  };
}

export type ArkadeLnReceiveProbe = {
  available: boolean;
  reason?: string;
};

/** Live base-side market required before any receive invoice is minted. */
export async function probeArkadeLnReceive(opts: {
  wallet: IWallet;
  networkId: ArkadeNetworkId;
  walletId: string;
}): Promise<ArkadeLnReceiveProbe> {
  try {
    const client = await getOrCreateArkadeLnClient(
      opts.wallet,
      opts.networkId,
      opts.walletId,
    );
    const resolution = await client.resolve({
      via: "lightning",
      amount: 1000n,
      amountOn: "take",
    });
    if (resolution.eligible > 0) {
      return { available: true };
    }
    return {
      available: false,
      reason: "No solver is offering Lightning into Arkade on this network yet.",
    };
  } catch (e) {
    return { available: false, reason: friendlyArkadeLnError(e) };
  }
}

export type ArkadeLnReceiveResult = {
  swapId: string;
  bolt11: string;
  amountSats: number;
};

export async function requestArkadeLnReceive(opts: {
  wallet: IWallet;
  networkId: ArkadeNetworkId;
  walletId: string;
  amountSats: number;
  signal?: AbortSignal;
}): Promise<ArkadeLnReceiveResult> {
  const amount = Math.floor(opts.amountSats);
  if (!(amount > 0)) throw new Error("Enter a positive amount.");
  const probe = await probeArkadeLnReceive(opts);
  if (!probe.available) {
    throw new Error(
      probe.reason ?? "Lightning receive is unavailable on Arkade right now.",
    );
  }
  if (opts.signal?.aborted) throw new Error("Cancelled.");

  const client = await getOrCreateArkadeLnClient(
    opts.wallet,
    opts.networkId,
    opts.walletId,
  );
  const BTC = btcOn("arkade", bitcoinNetworkLabel(opts.networkId));
  const rec = await client.receive({
    via: "lightning",
    amount: BigInt(amount),
    maxFee: { amount: maxFeeSats(amount), asset: BTC },
  });
  const bolt11 = rec.artifact?.bolt11;
  if (!bolt11) {
    throw new Error("Solver did not return a Lightning invoice.");
  }
  return { swapId: rec.id, bolt11, amountSats: amount };
}

export function watchArkadeLnReceive(opts: {
  wallet: IWallet;
  networkId: ArkadeNetworkId;
  walletId: string;
  swapId: string;
  onPaid: () => void;
  onFailed: (outcome: string) => void;
}): () => void {
  let unsub: (() => void) | null = null;
  let stopped = false;
  void getOrCreateArkadeLnClient(opts.wallet, opts.networkId, opts.walletId)
    .then((client) => {
      if (stopped) return;
      unsub = client.onUpdate(({ swap: s, outcome }) => {
        if (s.id !== opts.swapId) return;
        const o = String(outcome);
        if (o === "paid" || o === "filled" || o === "claimed") opts.onPaid();
        else if (FAILED_OUTCOMES.has(o)) opts.onFailed(o);
      });
    })
    .catch((e) => {
      console.warn("[basic] arkade ln receive watch failed", e);
    });
  return () => {
    stopped = true;
    unsub?.();
  };
}
