/**
 * React bridge for ExitJobRunner — subscribe + stop/resume + boot hydrate.
 * Also tracks leftover onchain unrolled sats that need completeUnroll.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import { getNetworkConfig } from "../config/network";
import { summarizeUnrolledVtxos } from "./runExit";
import {
  activeExitJobCount,
  hydrateExitJobs,
  resumeAllRunningExitJobs,
  resumeExitJob,
  stopExitJob,
  subscribeExitJobs,
} from "./jobRunner";
import { isActiveJobStatus, type ExitJobRecord } from "./jobStore";
import { getOpenWallet } from "../wallet/hdWallet";

type PendingSweep = { sats: number; count: number };

type ExitJobsContextValue = {
  jobs: ExitJobRecord[];
  /** running + stopped on current network */
  activeJobs: ExitJobRecord[];
  /** Hub list: active + recent failed on current network (completed packages are not shown) */
  hubJobs: ExitJobRecord[];
  activeCount: number;
  /** Onchain unrolled leftovers still needing completeUnroll */
  pendingSweep: PendingSweep;
  stopJob: (jobId: string) => Promise<void>;
  resumeJob: (jobId: string) => Promise<void>;
  refresh: () => Promise<void>;
  refreshPendingSweep: () => Promise<PendingSweep>;
  setPendingSweep: (next: PendingSweep) => void;
};

const ExitJobsContext = createContext<ExitJobsContextValue | null>(null);

export function ExitJobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<ExitJobRecord[]>([]);
  const [pendingSweep, setPendingSweep] = useState<PendingSweep>({
    sats: 0,
    count: 0,
  });
  const networkId = getNetworkConfig().id;

  const refreshPendingSweep = useCallback(async (): Promise<PendingSweep> => {
    const w = getOpenWallet();
    if (!w) {
      const empty = { sats: 0, count: 0 };
      setPendingSweep(empty);
      return empty;
    }
    try {
      const sum = await summarizeUnrolledVtxos(w);
      const next = { sats: sum.totalSats, count: sum.count };
      setPendingSweep(next);
      return next;
    } catch (e) {
      console.warn("[basic] refreshPendingSweep failed", e);
      const empty = { sats: 0, count: 0 };
      return empty;
    }
  }, []);

  useEffect(() => {
    const unsub = subscribeExitJobs(setJobs);
    void (async () => {
      await hydrateExitJobs();
      await resumeAllRunningExitJobs(networkId);
      await refreshPendingSweep();
    })();
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once per network
  }, [networkId]);

  useEffect(() => {
    const onState = (next: AppStateStatus) => {
      if (next === "active") {
        void resumeAllRunningExitJobs(getNetworkConfig().id);
        void refreshPendingSweep();
      }
    };
    const sub = AppState.addEventListener("change", onState);
    return () => sub.remove();
  }, [refreshPendingSweep]);

  const stopJob = useCallback(async (jobId: string) => {
    await stopExitJob(jobId);
  }, []);

  const resumeJob = useCallback(async (jobId: string) => {
    await resumeExitJob(jobId);
  }, []);

  const refresh = useCallback(async () => {
    await hydrateExitJobs();
    await refreshPendingSweep();
  }, [refreshPendingSweep]);

  const value = useMemo<ExitJobsContextValue>(() => {
    const hubJobs = jobs.filter((j) => {
      if (j.networkId !== networkId) return false;
      if (isActiveJobStatus(j.status)) return true;
      // Completed packages leave the hub; leftover funds use the pending-sweep card.
      if (j.status === "failed") {
        return Date.now() - j.updatedAt < 7 * 24 * 60 * 60 * 1000;
      }
      return false;
    });
    const activeJobs = hubJobs.filter(
      (j) => isActiveJobStatus(j.status) || j.status === "failed",
    );
    return {
      jobs,
      activeJobs,
      hubJobs,
      activeCount: activeExitJobCount(networkId),
      pendingSweep,
      stopJob,
      resumeJob,
      refresh,
      refreshPendingSweep,
      setPendingSweep,
    };
  }, [
    jobs,
    networkId,
    pendingSweep,
    stopJob,
    resumeJob,
    refresh,
    refreshPendingSweep,
  ]);

  return (
    <ExitJobsContext.Provider value={value}>{children}</ExitJobsContext.Provider>
  );
}

export function useExitJobs(): ExitJobsContextValue {
  const ctx = useContext(ExitJobsContext);
  if (!ctx) throw new Error("useExitJobs outside ExitJobsProvider");
  return ctx;
}
