/**
 * Dedicated Arkade Lightning corridor client (intents / @arkade-os/swap).
 * Not the optional Connect Lightning Node row. Not DePix localCards.
 *
 * Watchers: onUpdate + timer sleep, always unsubscribe in finally.
 * Never Promise.race on waitForIncomingFunds / Esplora.
 */

import type { IWallet } from "@arkade-os/sdk";
import { discover } from "@arkade-os/solver-discovery";
import {
  btcOn,
  createSwapClient,
  DiscoverySnapshotUnavailable,
  isSwapError,
  type SwapClient,
} from "@arkade-os/swap";
import type { ArkadeNetworkId } from "../config/network";
import { encodeReceiveBip21 } from "../wallet/bip21Receive";
import { getAssetSwapRepository } from "../wallet/persistentStorage";
import {
  friendlyLnInvoiceError,
  toArkadeLnInvoiceFacts,
} from "./arkadeLnInvoice";
import betaSolverCard from "./beta-solver.card.json";
import {
  formatLnError,
  withArkadeLnClaimWallet,
} from "./arkadeLnClaimWallet";

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

/** Bundled beta-solver card bounds (official wallet `beta-solver.card.json`). */
export const BUNDLED_LN_MIN_SATS = 500;
export const BUNDLED_LN_MAX_SATS = 50_000;

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
 * Official wallet pins the Lightning solver as a local card because GitHub
 * Pages registry `bitcoin.json` currently publishes `markets: []`.
 *
 * Swap v2 `resolve()` peeks cache/injected snapshot only and never merges
 * `localCards`. Injecting the bundled card (same `discover({ registries: [] })`
 * expansion official `discoverMarkets` uses) makes peek + load agree without
 * a live registry fetch.
 */
async function bundledLnDiscovery(networkId: ArkadeNetworkId): Promise<{
  localCards: { card: object; network: "bitcoin" }[];
  snapshot?: Awaited<ReturnType<typeof discover>>["markets"];
}> {
  if (networkId !== "mainnet") return { localCards: [] };
  const localCards = [
    { card: betaSolverCard as object, network: "bitcoin" as const },
  ];
  try {
    const found = await discover({
      registries: [],
      localCards,
      network: "bitcoin",
    });
    if (found.markets.length > 0) {
      return { localCards, snapshot: found.markets };
    }
  } catch (e) {
    console.warn("[basic] bundled ln snapshot failed", e);
  }
  return { localCards };
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
  const { localCards, snapshot } = await bundledLnDiscovery(networkId);
  const claimWallet = withArkadeLnClaimWallet(wallet);

  const client = createSwapClient({
    wallet: claimWallet,
    repository,
    discovery: {
      localCards,
      ...(snapshot ? { snapshot } : {}),
    },
    ...(networkId === "mainnet" ? { emulatorPubkey: MAINNET_EMULATOR_PUBKEY } : {}),
  });
  await client.ready;
  if (!snapshot) {
    try {
      await client.markets();
    } catch (e) {
      console.warn("[basic] arkade ln markets warmup failed", e);
    }
  }
  clientCache = { walletId, networkId, client };
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

export function bundledLnAmountInRange(amountSats: number): boolean {
  const amount = Math.floor(amountSats);
  return amount >= BUNDLED_LN_MIN_SATS && amount <= BUNDLED_LN_MAX_SATS;
}

/**
 * Live Lightning-into-Arkade market. Must `load()` (markets), never `resolve()`:
 * v2 resolve peeks cache only and maps an empty cache to
 * DiscoverySnapshotUnavailable even when the bundled solver card is present.
 */
export async function probeArkadeLnReceive(opts: {
  wallet: IWallet;
  networkId: ArkadeNetworkId;
  walletId: string;
}): Promise<ArkadeLnReceiveProbe> {
  if (opts.networkId !== "mainnet") {
    return {
      available: false,
      reason: "Lightning receive is mainnet-only (bundled beta solver).",
    };
  }
  try {
    const client = await getOrCreateArkadeLnClient(
      opts.wallet,
      opts.networkId,
      opts.walletId,
    );
    const markets = await client.markets();
    if (markets.length > 0) {
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
  if (opts.networkId !== "mainnet") {
    throw new Error("Lightning receive is mainnet-only (bundled beta solver).");
  }
  if (!bundledLnAmountInRange(amount)) {
    throw new Error(
      `Amount outside solver bounds (${BUNDLED_LN_MIN_SATS.toLocaleString("en-US")}-${BUNDLED_LN_MAX_SATS.toLocaleString("en-US")} sats).`,
    );
  }
  if (opts.signal?.aborted) throw new Error("Cancelled.");

  const client = await getOrCreateArkadeLnClient(
    opts.wallet,
    opts.networkId,
    opts.walletId,
  );
  const BTC = btcOn("arkade", bitcoinNetworkLabel(opts.networkId));
  // amountOn "take" inside receive() = official amountSide: "to" (credit me this much).
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

/** Mint when the solver is live; never throw. Used to optionally embed lightning= in BIP21. */
export async function tryRequestArkadeLnReceive(opts: {
  wallet: IWallet;
  networkId: ArkadeNetworkId;
  walletId: string;
  amountSats: number;
  signal?: AbortSignal;
}): Promise<ArkadeLnReceiveResult | null> {
  const amount = Math.floor(opts.amountSats);
  if (!bundledLnAmountInRange(amount) || opts.networkId !== "mainnet") {
    return null;
  }
  try {
    return await requestArkadeLnReceive(opts);
  } catch (e) {
    console.warn("[basic] arkade ln receive mint skipped", formatLnError(e));
    return null;
  }
}

export async function encodePosBip21WithOptionalLn(opts: {
  boarding: string | null;
  ark: string | null;
  amountSats: number;
  wallet?: IWallet | null;
  networkId: ArkadeNetworkId;
  walletId?: string | null;
  signal?: AbortSignal;
}): Promise<{ uri: string | null; minted: ArkadeLnReceiveResult | null }> {
  const fallback = encodeReceiveBip21(
    opts.boarding,
    opts.ark,
    null,
    opts.amountSats,
  );
  if (!opts.wallet || !opts.walletId) {
    return { uri: fallback, minted: null };
  }
  const minted = await tryRequestArkadeLnReceive({
    wallet: opts.wallet,
    networkId: opts.networkId,
    walletId: opts.walletId,
    amountSats: opts.amountSats,
    signal: opts.signal,
  });
  if (!minted) return { uri: fallback, minted: null };
  return {
    uri: encodeReceiveBip21(
      opts.boarding,
      opts.ark,
      minted.bolt11,
      opts.amountSats,
    ),
    minted,
  };
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
