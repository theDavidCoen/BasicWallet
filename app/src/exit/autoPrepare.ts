/**
 * Debounced background UnilateralExit.prepare (graph) using recovery address.
 * Manual prepare bumps an epoch so in-flight auto-prepare cannot overwrite.
 * Only a package that covers every eligible local VTXO is treated as current.
 * Never touches job cipher keys (running exits).
 */

import { getNetworkConfig } from "../config/network";
import { getOpenWallet, getOpenWalletId } from "../wallet/hdWallet";
import {
  exitAutoFingerprint,
  exitPackageIsCurrent,
  readExitPackageMeta,
} from "./packageStore";
import { getActiveJobOutpoints } from "./jobStore";
import { readRecoveryAddress } from "./recoveryAddress";
import { prepareUnilateralExit, summarizeLocalVtxos } from "./runExit";

const DEBOUNCE_MS = 45_000;

let timer: ReturnType<typeof setTimeout> | undefined;
let inflight = false;
let lastErrorAt = 0;
/** Bumped on manual prepare / cancel so stale auto runs skip save. */
let prepareEpoch = 0;

export function bumpExitPrepareEpoch(reason: string): number {
  prepareEpoch += 1;
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  console.warn("[basic] exit prepare epoch", prepareEpoch, reason);
  return prepareEpoch;
}

export function getExitPrepareEpoch(): number {
  return prepareEpoch;
}

export function scheduleAutoPrepare(reason = "balance"): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void runAutoPrepare(reason);
  }, DEBOUNCE_MS);
  console.warn("[basic] exit auto-prepare scheduled", reason, DEBOUNCE_MS);
}

export function scheduleAutoPrepareSoon(reason = "recovery-address"): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void runAutoPrepare(reason);
  }, 2_500);
}

export async function runAutoPrepare(reason = "manual"): Promise<void> {
  if (inflight) return;
  const network = getNetworkConfig();
  const walletId = getOpenWalletId();
  const wallet = getOpenWallet();
  if (!walletId || !wallet) return;

  const sweep = await readRecoveryAddress(network.id);
  if (!sweep) return;

  const locked = await getActiveJobOutpoints(network.id, walletId);
  const sum = await summarizeLocalVtxos(wallet, locked);
  if (sum.count === 0 || sum.totalSats <= 0) return;

  const fp = exitAutoFingerprint(sweep, sum.count, sum.totalSats);
  const meta = await readExitPackageMeta(network.id, walletId);
  if (meta && exitPackageIsCurrent(meta, sweep, sum.count, sum.totalSats)) {
    return;
  }

  // Do not clobber a fresh manual package that already covers current VTXOs.
  if (
    meta?.source === "manual" &&
    meta.sweepAddress === sweep &&
    Date.now() - meta.createdAt < 10 * 60_000 &&
    exitPackageIsCurrent(meta, sweep, sum.count, sum.totalSats)
  ) {
    console.warn("[basic] exit auto-prepare skip: recent manual package");
    return;
  }

  if (Date.now() - lastErrorAt < 120_000) return;

  const epochAtStart = prepareEpoch;
  inflight = true;
  try {
    console.warn("[basic] exit auto-prepare run", reason, sum.count, sum.totalSats);
    await prepareUnilateralExit(network.id, walletId, sweep, undefined, {
      source: "auto",
      autoFingerprint: fp,
      prepareEpoch: epochAtStart,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("superseded")) {
      console.warn("[basic] exit auto-prepare superseded");
      return;
    }
    lastErrorAt = Date.now();
    console.warn("[basic] exit auto-prepare failed", e);
  } finally {
    inflight = false;
  }
}
