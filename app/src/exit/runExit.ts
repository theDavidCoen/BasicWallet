/**
 * Unilateral exit: estimate / prepare (graph) / execute via SDK.
 */

import {
  EsploraProvider,
  Ramps,
  UnilateralExit,
  Unroll,
  hasTerminalSpend,
  isBtcAddress,
  type ExitPackage,
  type ExitQuote,
  type ExecutorEvent,
  type OnchainWallet,
  type Wallet,
} from "@arkade-os/sdk";
import type { Transaction } from "@scure/btc-signer";
import { getNetworkConfig, type ArkadeNetworkId } from "../config/network";
import { getOpenWallet } from "../wallet/hdWallet";
import type { BasicWallet } from "../wallet/hdWallet";
import { recordUnilateralExitActivity } from "../account/activityStore";
import { createFeeOnchainWallet, exitNetworkName } from "./feeWallet";
import { saveExitPackage } from "./packageStore";

/**
 * SDK UnilateralExit.prepare signs sweeps with `wallet.identity.sign` (index-0).
 * HD rotated VTXOs need the descriptor-aware router (`signOnchainBoardingTx`).
 * Proxy identity.sign through that path until the SDK wires it natively.
 */
function walletForUnilateralExit(wallet: BasicWallet): Wallet {
  const anyW = wallet as BasicWallet & {
    signOnchainBoardingTx?: (tx: Transaction) => Promise<Transaction>;
  };
  if (typeof anyW.signOnchainBoardingTx !== "function") {
    return wallet as unknown as Wallet;
  }

  const baseIdentity = wallet.identity;
  const hdIdentity = new Proxy(baseIdentity, {
    get(target, prop, receiver) {
      if (prop === "sign") {
        return async (tx: Transaction, inputIndexes?: number[]) => {
          try {
            return await anyW.signOnchainBoardingTx!(tx);
          } catch (e) {
            console.warn("[basic] HD exit signOnchainBoardingTx failed, identity fallback", e);
            return target.sign(tx, inputIndexes);
          }
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });

  return new Proxy(wallet as unknown as Wallet, {
    get(target, prop, receiver) {
      if (prop === "identity") return hdIdentity;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

class NoWatchEsploraProvider extends EsploraProvider {
  override async watchAddresses(
    _addresses: string[],
    _callback: (txs: never[]) => void,
  ): Promise<() => void> {
    return () => {};
  }
}

export function validateSweepAddress(
  address: string,
  networkId: ArkadeNetworkId,
): string | null {
  const trimmed = address.trim();
  if (!trimmed) return "Enter a Bitcoin address";
  if (!isBtcAddress(trimmed)) return "Invalid Bitcoin address";
  const lower = trimmed.toLowerCase();
  if (networkId === "mainnet") {
    if (lower.startsWith("tb1") || lower.startsWith("bcrt1") || lower.startsWith("m") || lower.startsWith("n") || lower.startsWith("2")) {
      return "Use a mainnet address (bc1…)";
    }
  } else {
    // mutinynet uses signet-style tb1 addresses on the mutinynet chain
    if (lower.startsWith("bc1") && !lower.startsWith("bcrt1")) {
      return "Use a mutinynet / test address (tb1…)";
    }
  }
  return null;
}

/**
 * Sweep / recovery must be an external wallet address — never Arkade boarding
 * (or the HD fee address used only to pay exit miner fees).
 */
export async function validateExternalSweepAddress(
  address: string,
  networkId: ArkadeNetworkId,
  walletId?: string | null,
): Promise<string | null> {
  const basic = validateSweepAddress(address, networkId);
  if (basic) return basic;
  const trimmed = address.trim();
  if (!walletId) return null;

  const open = getOpenWallet();
  try {
    if (open) {
      const anyW = open as BasicWallet & {
        getBoardingAddress?: () => Promise<string>;
        getBoardingAddresses?: () => Promise<string[]>;
      };
      const current =
        typeof anyW.getBoardingAddress === "function"
          ? (await anyW.getBoardingAddress()).trim()
          : "";
      if (current && current === trimmed) {
        return "Do not use an Arkade boarding address. Use an address from an external Bitcoin wallet you control.";
      }
      if (typeof anyW.getBoardingAddresses === "function") {
        const all = await anyW.getBoardingAddresses();
        if (all.some((a) => a.trim() === trimmed)) {
          return "Do not use an Arkade boarding address. Use an address from an external Bitcoin wallet you control.";
        }
      }
    }
  } catch {
    /* boarding probe optional */
  }

  try {
    const fee = await createFeeOnchainWallet(walletId);
    if (fee.address.trim() === trimmed) {
      return "That is your fee address (pays exit miner fees). Sweep destination must be a different external wallet address.";
    }
  } catch {
    /* fee wallet optional when mnemonic locked */
  }

  return null;
}

export type LocalVtxoSummary = {
  count: number;
  totalSats: number;
  /** `"txid:vout"` keys present in the local list. */
  outpoints: string[];
};

function vtxoOutpoint(v: {
  txid?: string;
  vout?: number;
  outpoint?: { txid?: string; vout?: number } | string;
}): string {
  if (typeof v.outpoint === "string" && v.outpoint.includes(":")) return v.outpoint;
  const txid =
    v.txid ||
    (typeof v.outpoint === "object" && v.outpoint ? v.outpoint.txid : "") ||
    "";
  const vout =
    v.vout ??
    (typeof v.outpoint === "object" && v.outpoint ? v.outpoint.vout : 0) ??
    0;
  return txid ? `${txid}:${vout}` : "";
}

export async function summarizeLocalVtxos(
  wallet: BasicWallet,
  excludeOutpoints?: ReadonlySet<string>,
): Promise<LocalVtxoSummary> {
  const anyW = wallet as BasicWallet & {
    getVtxos?: (filter?: unknown) => Promise<
      Array<{
        value?: number | bigint;
        txid?: string;
        vout?: number;
        outpoint?: { txid?: string; vout?: number } | string;
      }>
    >;
  };
  if (typeof anyW.getVtxos !== "function") {
    return { count: 0, totalSats: 0, outpoints: [] };
  }
  try {
    // Same default as UnilateralExit.selectExitVtxos → wallet.getVtxos().
    const list = await anyW.getVtxos();
    let totalSats = 0;
    let count = 0;
    const outpoints: string[] = [];
    for (const v of list) {
      const op = vtxoOutpoint(v);
      if (excludeOutpoints && op && excludeOutpoints.has(op)) continue;
      count += 1;
      const n = Number(v.value ?? 0);
      if (Number.isFinite(n)) totalSats += n;
      if (op) outpoints.push(op);
    }
    return { count, totalSats, outpoints };
  } catch (e) {
    console.warn("[basic] local vtxos summary failed", e);
    return { count: 0, totalSats: 0, outpoints: [] };
  }
}

type UnrolledVtxoRow = {
  txid: string;
  vout: number;
  value: number;
  outpoint: string;
};

type OutspendRow = { spent: boolean; txid?: string };

/**
 * SDK `canSweepOnchain` only checks isUnrolled + !hasTerminalSpend — the local
 * cache often still lists already-swept leaves. Confirm each outpoint is
 * unspent on Esplora before counting or sweeping.
 */
async function filterStillUnspentOnchain(
  wallet: BasicWallet,
  rows: UnrolledVtxoRow[],
): Promise<UnrolledVtxoRow[]> {
  if (rows.length === 0) return [];

  const anyW = wallet as BasicWallet & {
    onchainProvider?: {
      getTxOutspends?: (txid: string) => Promise<OutspendRow[]>;
    };
  };
  const getOutspends = anyW.onchainProvider?.getTxOutspends?.bind(
    anyW.onchainProvider,
  );

  const esplora = getNetworkConfig().esploraUrl.replace(/\/$/, "");
  const cache = new Map<string, Promise<OutspendRow[]>>();

  const load = (txid: string): Promise<OutspendRow[]> => {
    let p = cache.get(txid);
    if (!p) {
      p = (async () => {
        if (getOutspends) {
          try {
            return await getOutspends(txid);
          } catch (e) {
            console.warn("[basic] getTxOutspends failed, fetch Esplora", txid.slice(0, 12), e);
          }
        }
        const res = await fetch(`${esplora}/tx/${txid}/outspends`);
        if (!res.ok) throw new Error(`outspends HTTP ${res.status}`);
        return (await res.json()) as OutspendRow[];
      })();
      cache.set(txid, p);
    }
    return p;
  };

  const out: UnrolledVtxoRow[] = [];
  for (const row of rows) {
    try {
      const spends = await load(row.txid);
      if (spends[row.vout]?.spent) continue;
      out.push(row);
    } catch (e) {
      console.warn("[basic] skip unrolled outpoint (outspend check failed)", row.outpoint, e);
    }
  }
  return out;
}

/**
 * VTXOs already unrolled onchain (bumps done) that still need
 * `Unroll.completeUnroll` to reach the recovery address.
 * These do not show up in the default getVtxos() list used by prepare.
 */
export async function listUnrolledSweepableVtxos(
  wallet: BasicWallet,
): Promise<UnrolledVtxoRow[]> {
  const anyW = wallet as BasicWallet & {
    getVtxos?: (filter?: unknown) => Promise<
      Array<{
        value?: number | bigint;
        txid?: string;
        vout?: number;
        isUnrolled?: boolean;
        isSpent?: boolean;
        spentBy?: string;
        settledBy?: string;
        outpoint?: { txid?: string; vout?: number } | string;
      }>
    >;
  };
  if (typeof anyW.getVtxos !== "function") return [];
  try {
    const list = await anyW.getVtxos({ withUnrolled: true });
    const candidates: UnrolledVtxoRow[] = [];
    for (const v of list) {
      if (!v.isUnrolled) continue;
      try {
        if (hasTerminalSpend(v as never)) continue;
      } catch {
        /* treat unknown shape as candidate; chain check decides */
      }
      const op = vtxoOutpoint(v);
      const txid =
        (typeof v.txid === "string" && v.txid) ||
        (op.includes(":") ? op.split(":")[0] : "");
      if (!txid || !op) continue;
      const vout =
        typeof v.vout === "number"
          ? v.vout
          : Number(op.split(":")[1] ?? 0);
      const value = Number(v.value ?? 0);
      if (!Number.isFinite(value) || value <= 0) continue;
      candidates.push({ txid, vout, value, outpoint: op });
    }
    return filterStillUnspentOnchain(wallet, candidates);
  } catch (e) {
    console.warn("[basic] list unrolled vtxos failed", e);
    return [];
  }
}

export async function summarizeUnrolledVtxos(
  wallet: BasicWallet,
): Promise<LocalVtxoSummary> {
  const list = await listUnrolledSweepableVtxos(wallet);
  return {
    count: list.length,
    totalSats: list.reduce((s, v) => s + v.value, 0),
    outpoints: list.map((v) => v.outpoint),
  };
}

/**
 * Sweep sats that already live onchain after a partial unilateral exit.
 * Fee is paid from the swept amount (SDK prepareUnrollTransaction).
 */
export async function completeUnrolledExitSweep(opts: {
  networkId: ArkadeNetworkId;
  walletId: string;
  sweepAddress: string;
}): Promise<{
  txid: string;
  sweptSats: number;
  deliveredSats: number;
  vtxoCount: number;
  activityId: string | null;
}> {
  const wallet = getOpenWallet();
  if (!wallet) throw new Error("Open an Arkade wallet first");

  const rows = await listUnrolledSweepableVtxos(wallet);
  if (rows.length === 0) {
    throw new Error(
      "NO_UNROLLED: No onchain unrolled VTXOs left to sweep. If balance remains offchain, prepare a new exit package instead.",
    );
  }

  const sweepAddress = opts.sweepAddress.trim();
  const addrErr = await validateExternalSweepAddress(
    sweepAddress,
    opts.networkId,
    opts.walletId,
  );
  if (addrErr) throw new Error(addrErr);

  const txids = [...new Set(rows.map((r) => r.txid))];
  const sweptSats = rows.reduce((s, r) => s + r.value, 0);
  console.warn("[basic] completeUnroll", {
    count: rows.length,
    sweptSats,
    txids: txids.map((t) => t.slice(0, 12)),
  });

  const signedWallet = walletForUnilateralExit(wallet);
  const txid = await Unroll.completeUnroll(signedWallet, txids, sweepAddress);

  let deliveredSats = sweptSats;
  try {
    const esplora = getNetworkConfig().esploraUrl.replace(/\/$/, "");
    const res = await fetch(`${esplora}/tx/${txid}`);
    if (res.ok) {
      const tx = (await res.json()) as {
        vout?: Array<{ value?: number; scriptpubkey_address?: string }>;
      };
      const paid = (tx.vout ?? [])
        .filter((o) => (o.scriptpubkey_address || "") === sweepAddress)
        .reduce((s, o) => s + Number(o.value ?? 0), 0);
      if (paid > 0) deliveredSats = paid;
    }
  } catch (e) {
    console.warn("[basic] completeUnroll delivered lookup failed", e);
  }

  let activityId: string | null = null;
  try {
    activityId = recordUnilateralExitActivity(opts.networkId, opts.walletId, {
      packageCreatedAt: Date.now(),
      recoveredSats: sweptSats,
      deliveredSats,
      sweepAddress,
      sweepTxid: txid,
      txCount: 1,
    });
  } catch (e) {
    console.warn("[basic] record completeUnroll activity failed", e);
  }

  return { txid, sweptSats, deliveredSats, vtxoCount: rows.length, activityId };
}

/**
 * Ensure each confirmed payment to the recovery address has a local exit activity row.
 * Used after completeUnroll and on Home focus so Activity stays in sync.
 */
export async function syncRecoveryExitActivities(opts: {
  networkId: ArkadeNetworkId;
  walletId: string;
  sweepAddress: string;
}): Promise<number> {
  const sweepAddress = opts.sweepAddress.trim();
  if (!sweepAddress) return 0;
  const esplora = getNetworkConfig().esploraUrl.replace(/\/$/, "");
  let txs: Array<{
    txid: string;
    status?: { confirmed?: boolean; block_time?: number };
    vout?: Array<{ value?: number; scriptpubkey_address?: string }>;
  }> = [];
  try {
    const res = await fetch(`${esplora}/address/${sweepAddress}/txs`);
    if (!res.ok) return 0;
    txs = (await res.json()) as typeof txs;
  } catch (e) {
    console.warn("[basic] syncRecoveryExitActivities fetch failed", e);
    return 0;
  }

  const { readActivityFromDb } = await import("../account/activityStore");
  const existing = readActivityFromDb(opts.networkId, {
    walletId: opts.walletId,
    limit: 200,
  });
  const knownTxids = new Set<string>();
  for (const row of existing) {
    if (!row.id.startsWith("exit:") && !row.tags.includes("exit")) continue;
    for (const t of row.txs ?? []) {
      const id = (t.boardingTxid || t.commitmentTxid || t.arkTxid || "").trim();
      if (/^[0-9a-fA-F]{64}$/.test(id)) knownTxids.add(id.toLowerCase());
    }
  }

  let added = 0;
  for (const tx of txs) {
    if (!tx.status?.confirmed) continue;
    const txid = (tx.txid || "").toLowerCase();
    if (!txid || knownTxids.has(txid)) continue;
    const paid = (tx.vout ?? [])
      .filter((o) => (o.scriptpubkey_address || "") === sweepAddress)
      .reduce((s, o) => s + Number(o.value ?? 0), 0);
    if (paid <= 0) continue;
    const completedAt =
      typeof tx.status.block_time === "number" && tx.status.block_time > 0
        ? tx.status.block_time * 1000
        : Date.now();
    try {
      recordUnilateralExitActivity(opts.networkId, opts.walletId, {
        packageCreatedAt: completedAt,
        recoveredSats: paid,
        deliveredSats: paid,
        sweepAddress,
        sweepTxid: tx.txid,
        txCount: 1,
        completedAt,
      });
      knownTxids.add(txid);
      added += 1;
    } catch (e) {
      console.warn("[basic] syncRecoveryExitActivities record failed", e);
    }
  }
  return added;
}

export async function estimateUnilateralExit(
  walletId: string,
  sweepAddress: string,
  esploraUrl?: string,
): Promise<{ quote: ExitQuote; onchain: OnchainWallet }> {
  const wallet = getOpenWallet();
  if (!wallet) throw new Error("Open an Arkade wallet first");
  const network = getNetworkConfig();
  const onchain = await createFeeOnchainWallet(walletId, esploraUrl);
  const quote = await UnilateralExit.estimate({
    wallet: walletForUnilateralExit(wallet),
    onchainWallet: onchain,
    sweepAddress: sweepAddress.trim(),
    mode: "graph",
    networkName: exitNetworkName(network.id),
  });
  return { quote, onchain };
}

export async function prepareUnilateralExit(
  networkId: ArkadeNetworkId,
  walletId: string,
  sweepAddress: string,
  esploraUrl?: string,
  extra?: {
    source?: "manual" | "auto";
    autoFingerprint?: string;
    /** If set, save is skipped when epoch changed (stale auto-prepare). */
    prepareEpoch?: number;
  },
): Promise<ExitPackage> {
  const wallet = getOpenWallet();
  if (!wallet) throw new Error("Open an Arkade wallet first");

  // Pull fresh VTXO / virtual-tx state before building the graph.
  try {
    const anyW = wallet as BasicWallet & {
      getContractManager?: () => Promise<{ refreshVtxos?: () => Promise<void> }>;
    };
    const manager = await anyW.getContractManager?.();
    if (manager && typeof manager.refreshVtxos === "function") {
      await manager.refreshVtxos();
    }
  } catch (e) {
    console.warn("[basic] exit refreshVtxos before prepare failed", e);
  }

  const onchain = await createFeeOnchainWallet(walletId, esploraUrl);
  const { getActiveJobOutpoints } = await import("./jobStore");
  const locked = await getActiveJobOutpoints(networkId, walletId);
  const eligible = await summarizeLocalVtxos(wallet, locked);
  if (eligible.count <= 0) {
    throw new Error("No eligible VTXOs to exit (others may already be in an exit job)");
  }
  const vtxoOutpoints = eligible.outpoints
    .map((op) => {
      const [txid, voutStr] = op.split(":");
      const vout = Number(voutStr);
      if (!txid || !Number.isFinite(vout)) return null;
      return { txid, vout };
    })
    .filter((x): x is { txid: string; vout: number } => !!x);

  const pkg = await UnilateralExit.prepare({
    wallet: walletForUnilateralExit(wallet),
    onchainWallet: onchain,
    sweepAddress: sweepAddress.trim(),
    mode: "graph",
    networkName: exitNetworkName(networkId),
    ...(vtxoOutpoints.length > 0 ? { vtxos: vtxoOutpoints } : {}),
  });

  if (extra?.prepareEpoch != null) {
    const { getExitPrepareEpoch } = await import("./autoPrepare");
    if (extra.prepareEpoch !== getExitPrepareEpoch()) {
      throw new Error("Prepare superseded");
    }
  }

  const { summarizeExitPackageVtxos, clearExitPackage } = await import("./packageStore");
  const sums = summarizeExitPackageVtxos(pkg);

  // Package must cover every eligible local VTXO (active exit jobs excluded).
  const sum = eligible;
  if (
    sum.count <= 0 ||
    sums.coveredVtxoCount !== sum.count ||
    sums.coveredSats !== sum.totalSats
  ) {
    await clearExitPackage(networkId, walletId).catch(() => undefined);
    throw new Error(
      `Exit package incomplete: covered ${sums.coveredSats}/${sum.totalSats} sats ` +
        `(${sums.coveredVtxoCount}/${sum.count} vtxos). Retry while the operator is reachable.`,
    );
  }

  // Missing exit path / bad HD sign / virtual-tx data → not usable (dust skips OK).
  if (sums.blockingSkipCount > 0 || sums.includedSats <= 0) {
    await clearExitPackage(networkId, walletId).catch(() => undefined);
    const examples = pkg.vtxos
      .filter((v) => v.skipped && !String(v.skipped).startsWith("uneconomic"))
      .slice(0, 3)
      .map((v) => v.skipped)
      .join("; ");
    const hdSignFail = /empty witness/i.test(examples);
    throw new Error(
      hdSignFail
        ? `Exit package not usable: ${sums.blockingSkipCount} VTXO(s) failed HD sweep signing` +
            (examples ? ` (${examples})` : "") +
            `. Retry prepare; if it persists this is an SDK HD exit signing bug.`
        : `Exit package not usable: ${sums.blockingSkipCount} VTXO(s) lack exit data` +
            (examples ? ` (${examples})` : "") +
            `. Retry while the operator / indexer is reachable.`,
    );
  }

  // Refuse auto overwrite of a newer package already on disk.
  if (extra?.source === "auto") {
    const { readExitPackageMeta } = await import("./packageStore");
    const existing = await readExitPackageMeta(networkId, walletId);
    if (
      existing &&
      existing.createdAt >= pkg.createdAt &&
      existing.source === "manual"
    ) {
      throw new Error("Prepare superseded");
    }
  }

  const fp =
    extra?.autoFingerprint ??
    (await import("./packageStore")).exitAutoFingerprint(
      sweepAddress.trim(),
      sum.count,
      sum.totalSats,
    );

  await saveExitPackage(networkId, walletId, pkg, {
    source: extra?.source ?? "manual",
    autoFingerprint: fp,
  });
  return pkg;
}

export type ExecuteProgress = ExecutorEvent;

/**
 * Run graph-mode executor. AbortSignal stops this run; already-broadcast txs stay onchain.
 * Prefer ExitJobRunner for UI so unmount does not abort.
 */
export async function executeUnilateralExit(opts: {
  walletId: string;
  pkg: ExitPackage;
  esploraUrl?: string;
  signal?: AbortSignal;
  onEvent?: (ev: ExecutorEvent) => void;
}): Promise<void> {
  const network = getNetworkConfig();
  const esplora = opts.esploraUrl ?? network.esploraUrl;
  const onchain = await createFeeOnchainWallet(opts.walletId, esplora);
  const provider = new NoWatchEsploraProvider(esplora);
  const wallet = getOpenWallet();

  const executor = wallet
    ? await UnilateralExit.execute(wallet as unknown as Wallet, opts.pkg, {
        provider,
        feeWallet: onchain,
        signal: opts.signal,
        pollIntervalMs: 8_000,
      })
    : new UnilateralExit.Executor(opts.pkg, provider, {
        feeWallet: onchain,
        signal: opts.signal,
        pollIntervalMs: 8_000,
      });

  for await (const ev of executor) {
    opts.onEvent?.(ev);
    // Do not throw on a single step failure: the SDK marks that branch dead
    // and continues other bumps/sweeps. Aborting here left later txs stranded
    // and bounced the job back to "Continue exit".
  }
}

export async function collaborativeOffboard(
  destinationAddress: string,
  amountSats?: number,
): Promise<string> {
  const wallet = getOpenWallet();
  if (!wallet) throw new Error("Open an Arkade wallet first");
  const info = await wallet.arkProvider.getInfo();
  const ramps = new Ramps(wallet as unknown as Wallet);
  const amount =
    amountSats !== undefined && Number.isFinite(amountSats)
      ? BigInt(Math.floor(amountSats))
      : undefined;
  const txid = await ramps.offboard(destinationAddress.trim(), info.fees, amount);
  return typeof txid === "string" ? txid : String(txid);
}
