/**
 * Process-level unilateral exit executor. Survives screen unmount; Stop aborts
 * one job. Cold start / AppState active resumes `running` jobs (idempotent).
 */

import type { ExecutorEvent } from "@arkade-os/sdk";
import { getNetworkConfig } from "../config/network";
import { recordUnilateralExitActivity } from "../account/activityStore";
import {
  sumDeliveredToAddress,
  sweepTxidsFromEvents,
} from "./exitDelivery";
import {
  appendJobEvent,
  createJobFromPackage,
  getExitJob,
  isActiveJobStatus,
  listExitJobs,
  loadJobPackage,
  patchExitJob,
  type ExitJobRecord,
} from "./jobStore";
import { executeUnilateralExit } from "./runExit";
import type { ExitPackage } from "@arkade-os/sdk";

type Listener = (jobs: ExitJobRecord[]) => void;

const listeners = new Set<Listener>();
const inFlight = new Map<string, AbortController>();
let cachedJobs: ExitJobRecord[] = [];
let bootstrapped = false;

async function refreshCache(): Promise<ExitJobRecord[]> {
  cachedJobs = await listExitJobs();
  for (const l of listeners) l(cachedJobs);
  return cachedJobs;
}

export function subscribeExitJobs(listener: Listener): () => void {
  listeners.add(listener);
  listener(cachedJobs);
  return () => {
    listeners.delete(listener);
  };
}

export function getCachedExitJobs(): ExitJobRecord[] {
  return cachedJobs;
}

export function activeExitJobCount(networkId?: string): number {
  return cachedJobs.filter(
    (j) =>
      (isActiveJobStatus(j.status) || j.status === "failed") &&
      (networkId == null || j.networkId === networkId),
  ).length;
}

/** True when package sweep steps are all confirmed in job events. */
function allSweepsConfirmed(pkg: ExitPackage, events: ExecutorEvent[]): boolean {
  const sweepSteps = pkg.steps.filter((s) => s.kind === "sweep");
  if (sweepSteps.length === 0) return true;
  const confirmed = new Set(
    events
      .filter((e) => e.kind === "sweep" && e.status === "confirmed" && e.txid)
      .map((e) => e.txid as string),
  );
  // Prefer txid match; fall back to count of confirmed sweep events.
  const byTxid = sweepSteps.filter(
    (s) => s.kind === "sweep" && s.txid && confirmed.has(s.txid),
  ).length;
  if (byTxid >= sweepSteps.length) return true;
  const confirmedCount = events.filter(
    (e) => e.kind === "sweep" && e.status === "confirmed",
  ).length;
  return confirmedCount >= sweepSteps.length;
}

async function runJobLoop(jobId: string, signal: AbortSignal): Promise<void> {
  const job = await getExitJob(jobId);
  if (!job) return;
  const pkg = await loadJobPackage(jobId);
  if (!pkg) {
    await patchExitJob(jobId, {
      status: "failed",
      lastError: "Exit package missing",
    });
    await refreshCache();
    return;
  }

  await patchExitJob(jobId, { status: "running", lastError: undefined });
  await refreshCache();

  let sawStepFailure = false;
  try {
    await executeUnilateralExit({
      walletId: job.walletId,
      pkg,
      esploraUrl: job.esploraUrl,
      signal,
      onEvent: (ev: ExecutorEvent) => {
        if (ev.status === "failed") sawStepFailure = true;
        void (async () => {
          await appendJobEvent(jobId, ev);
          await refreshCache();
        })();
      },
    });
    if (signal.aborted) {
      await patchExitJob(jobId, { status: "stopped" });
    } else {
      const events = (await getExitJob(jobId))?.events ?? [];
      const sweepTxids = sweepTxidsFromEvents(events);
      const sweepTxid = sweepTxids[sweepTxids.length - 1];
      const expected = Math.max(0, Math.floor(pkg.totals.recoveredSats));
      const esplora =
        job.esploraUrl?.replace(/\/$/, "") ||
        getNetworkConfig().esploraUrl.replace(/\/$/, "");
      let delivered = 0;
      try {
        delivered = await sumDeliveredToAddress({
          esploraUrl: esplora,
          sweepAddress: pkg.sweepAddress,
          txids: sweepTxids,
        });
      } catch {
        delivered = 0;
      }

      const sweepsDone = allSweepsConfirmed(pkg, events);
      const underDelivered =
        expected > 0 && delivered > 0 && delivered < Math.floor(expected * 0.9);
      const missingDelivery =
        expected > 0 && delivered <= 0 && sweepTxids.length > 0;

      if (!sweepsDone || underDelivered || missingDelivery || sawStepFailure) {
        const parts: string[] = [];
        if (!sweepsDone) parts.push("not all sweep txs confirmed yet");
        if (underDelivered || missingDelivery) {
          parts.push(
            `onchain ${delivered.toLocaleString("en-US")}/${expected.toLocaleString("en-US")} sats`,
          );
        }
        if (sawStepFailure) parts.push("some steps failed (other branches may still run)");
        await patchExitJob(jobId, {
          status: "stopped",
          lastError: `Exit paused: ${parts.join("; ")}. Will resume when you reopen or tap Continue.`,
        });
      } else {
        await patchExitJob(jobId, { status: "completed", lastError: undefined });
        // Drop draft so hub does not keep offering Continue for a finished package.
        try {
          const { clearExitPackage } = await import("./packageStore");
          await clearExitPackage(job.networkId, job.walletId);
        } catch (e) {
          console.warn("[basic] clear draft after exit complete failed", e);
        }
      }

      try {
        recordUnilateralExitActivity(job.networkId, job.walletId, {
          packageCreatedAt: pkg.createdAt,
          recoveredSats: expected,
          deliveredSats: delivered > 0 ? delivered : undefined,
          fundingRequiredSats: pkg.totals.fundingRequiredSats,
          sweepAddress: pkg.sweepAddress,
          sweepTxid,
          txCount: pkg.totals.txCount,
        });
      } catch (e) {
        console.warn("[basic] exit activity record failed", e);
      }
    }
  } catch (e) {
    if (signal.aborted) {
      await patchExitJob(jobId, { status: "stopped" });
    } else {
      const msg = e instanceof Error ? e.message : String(e);
      // Keep resumable: fee blips / transient network should not bury the job.
      await patchExitJob(jobId, { status: "stopped", lastError: msg });
    }
  } finally {
    inFlight.delete(jobId);
    await refreshCache();
  }
}

/** Start execute from a draft package; returns the new or reused job. */
export async function startExitJob(opts: {
  networkId: ExitJobRecord["networkId"];
  walletId: string;
  pkg: ExitPackage;
  esploraUrl?: string;
}): Promise<ExitJobRecord> {
  const existing = (await listExitJobs()).find(
    (j) =>
      j.networkId === opts.networkId &&
      j.walletId === opts.walletId &&
      j.createdAt === opts.pkg.createdAt,
  );
  if (existing) {
    if (existing.status === "completed") {
      const err = new Error(
        "PACKAGE_DONE: This exit package already swept its sats onchain. Tap “Exit remaining funds” to prepare a new package for any leftover VTXOs.",
      );
      (err as Error & { code?: string }).code = "PACKAGE_DONE";
      throw err;
    }
    if (opts.esploraUrl && opts.esploraUrl !== existing.esploraUrl) {
      await patchExitJob(existing.jobId, { esploraUrl: opts.esploraUrl });
    }
    await resumeExitJob(existing.jobId);
    const fresh = await getExitJob(existing.jobId);
    return fresh ?? existing;
  }
  const job = await createJobFromPackage(opts);
  await refreshCache();
  void resumeExitJob(job.jobId);
  return job;
}

/**
 * Continue / resume exit for a wallet: reuse open job or start from draft package.
 * Does **not** re-run a completed package (that only rebroadcasts the same sweeps).
 */
export async function continueExitForWallet(opts: {
  networkId: ExitJobRecord["networkId"];
  walletId: string;
  esploraUrl?: string;
}): Promise<ExitJobRecord> {
  const jobs = await listExitJobs();
  const mine = jobs
    .filter(
      (j) => j.networkId === opts.networkId && j.walletId === opts.walletId,
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const open = mine.find(
    (j) => isActiveJobStatus(j.status) || j.status === "failed",
  );
  if (open) {
    await resumeExitJob(open.jobId);
    const fresh = await getExitJob(open.jobId);
    if (fresh) return fresh;
  }

  const { loadExitPackage } = await import("./packageStore");
  const draft = await loadExitPackage(opts.networkId, opts.walletId);
  if (draft) {
    return startExitJob({
      networkId: opts.networkId,
      walletId: opts.walletId,
      pkg: draft,
      esploraUrl: opts.esploraUrl,
    });
  }

  const completed = mine.find((j) => j.status === "completed");
  if (completed) {
    const err = new Error(
      "PACKAGE_DONE: This exit package already swept its sats onchain. Tap “Exit remaining funds” to prepare a new package for any leftover VTXOs.",
    );
    (err as Error & { code?: string }).code = "PACKAGE_DONE";
    throw err;
  }

  throw new Error("No exit package to continue");
}

export async function stopExitJob(jobId: string): Promise<void> {
  const ac = inFlight.get(jobId);
  if (ac) {
    ac.abort();
  } else {
    await patchExitJob(jobId, { status: "stopped" });
    await refreshCache();
  }
}

export async function resumeExitJob(jobId: string): Promise<void> {
  if (inFlight.has(jobId)) return;
  const job = await getExitJob(jobId);
  if (!job) return;
  // Completed packages are finished — re-running only duplicates events.
  if (job.status === "completed") return;
  if (job.status === "failed") {
    await patchExitJob(jobId, { status: "stopped", lastError: undefined });
  }

  const ac = new AbortController();
  inFlight.set(jobId, ac);
  void runJobLoop(jobId, ac.signal);
}

/** Resume all `running` jobs for the current (or given) network after boot. */
export async function resumeAllRunningExitJobs(
  networkId?: ExitJobRecord["networkId"],
): Promise<void> {
  const net = networkId ?? getNetworkConfig().id;
  await refreshCache();
  const jobs = cachedJobs.filter(
    (j) => j.networkId === net && j.status === "running",
  );
  for (const j of jobs) {
    void resumeExitJob(j.jobId);
  }
  bootstrapped = true;
}

export function exitJobsBootstrapped(): boolean {
  return bootstrapped;
}

export async function hydrateExitJobs(): Promise<ExitJobRecord[]> {
  return refreshCache();
}
