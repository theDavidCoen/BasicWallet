/**
 * Format ExecutorEvent lines and CSV lock summaries for exit hub cards.
 */

import type { ExecutorEvent } from "@arkade-os/sdk";
import type { ArkadeNetworkId } from "../config/network";

/** Typical block interval for ETA (not consensus). */
export function approxBlockIntervalSec(networkId: ArkadeNetworkId): number {
  return networkId === "mainnet" ? 600 : 30;
}

/** Human remaining time: days / hours / minutes (never bare "0s"). */
export function formatRemainingDuration(totalSec: number): string {
  const s = Math.max(0, Math.ceil(totalSec));
  if (s < 60) {
    return s <= 0 ? "less than 1 minute" : `about ${s} second${s === 1 ? "" : "s"}`;
  }
  const mins = Math.ceil(s / 60);
  if (mins < 60) {
    return `about ${mins} minute${mins === 1 ? "" : "s"}`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 48) {
    if (remMins === 0) return `about ${hours} hour${hours === 1 ? "" : "s"}`;
    return `about ${hours}h ${remMins}m`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (remHours === 0) return `about ${days} day${days === 1 ? "" : "s"}`;
  return `about ${days}d ${remHours}h`;
}

export type CsvLockSummary = {
  /** Short headline for the card. */
  headline: string;
  /** Second line with ETA / target. */
  detail: string;
};

/**
 * Summarize the slowest *open* waiting_csv among events.
 * Ignore waiting_csv once the same step later broadcast/confirmed (stale after resume).
 */
export function csvLockSummaryFromEvents(
  events: ExecutorEvent[],
  opts: {
    networkId: ArkadeNetworkId;
    tipHeight?: number | null;
    nowSec?: number;
  },
): CsvLockSummary | null {
  const settled = new Set<number>();
  for (const e of events) {
    if (
      e.kind === "sweep" &&
      (e.status === "broadcast" || e.status === "confirmed")
    ) {
      settled.add(e.stepIndex);
    }
  }
  const waiting = events.filter(
    (e) => e.status === "waiting_csv" && !settled.has(e.stepIndex),
  );
  if (waiting.length === 0) return null;

  const nowSec = opts.nowSec ?? Date.now() / 1000;
  let maturesAtTime: number | undefined;
  let maturesAtHeight: number | undefined;
  for (const e of waiting) {
    if (e.maturesAtTime != null) {
      maturesAtTime =
        maturesAtTime == null
          ? e.maturesAtTime
          : Math.max(maturesAtTime, e.maturesAtTime);
    }
    if (e.maturesAtHeight != null) {
      maturesAtHeight =
        maturesAtHeight == null
          ? e.maturesAtHeight
          : Math.max(maturesAtHeight, e.maturesAtHeight);
    }
  }

  if (maturesAtHeight != null) {
    const tip = opts.tipHeight;
    if (tip == null || !Number.isFinite(tip)) {
      return {
        headline: `CSV lock · until block ${maturesAtHeight}`,
        detail: "Fetching chain tip for blocks remaining…",
      };
    }
    const blocksLeft = Math.max(0, maturesAtHeight - tip);
    const etaSec = blocksLeft * approxBlockIntervalSec(opts.networkId);
    if (blocksLeft === 0) {
      return {
        headline: "CSV lock · mature (0 blocks left)",
        detail: "Sweep can broadcast on the next poll",
      };
    }
    return {
      headline: `CSV lock · ${blocksLeft.toLocaleString("en-US")} block${blocksLeft === 1 ? "" : "s"} left`,
      detail: `${formatRemainingDuration(etaSec)} · target height ${maturesAtHeight.toLocaleString("en-US")} (tip ${tip.toLocaleString("en-US")})`,
    };
  }

  if (maturesAtTime != null) {
    const left = Math.max(0, maturesAtTime - nowSec);
    // Time-based CSV (BIP68 seconds): no block count in the lock itself.
    // Still give a rough block-equivalent for Mutinynet/mainnet pacing.
    const blockSec = approxBlockIntervalSec(opts.networkId);
    const approxBlocks = Math.max(0, Math.ceil(left / blockSec));
    return {
      headline: `CSV lock · ${formatRemainingDuration(left)} remaining`,
      detail:
        left <= 0
          ? "Sweep can broadcast on the next poll"
          : `~${approxBlocks.toLocaleString("en-US")} block${approxBlocks === 1 ? "" : "s"} at ~${blockSec}s/block (time-based lock)`,
    };
  }

  return {
    headline: "CSV lock · waiting",
    detail: "Timelock details not in event yet",
  };
}

/** Collapse repeated identical progress lines (resume re-appends the same events). */
export function dedupeExitEventsForDisplay(
  events: ExecutorEvent[],
  limit = 12,
): ExecutorEvent[] {
  const out: ExecutorEvent[] = [];
  let prevKey = "";
  for (const ev of events) {
    const key = `${ev.stepIndex}|${ev.kind}|${ev.status}|${ev.txid ?? ""}|${ev.reason ?? ""}`;
    if (key === prevKey) continue;
    prevKey = key;
    out.push(ev);
  }
  return out.slice(-limit);
}

export function formatExitEventLine(ev: ExecutorEvent, nowSec = Date.now() / 1000): string {
  const parts: string[] = [`#${ev.stepIndex}`, ev.kind, ev.status];
  if (ev.txid) parts.push(`${ev.txid.slice(0, 10)}…`);
  if (ev.reason) parts.push(ev.reason);
  if (ev.status === "waiting_csv") {
    if (ev.maturesAtTime != null) {
      const left = Math.max(0, ev.maturesAtTime - nowSec);
      parts.push(formatRemainingDuration(left));
    } else if (ev.maturesAtHeight != null) {
      parts.push(`until block ${ev.maturesAtHeight}`);
    }
  }
  return parts.join(" · ");
}

export function exitJobCaption(jobs: { status: string; events: ExecutorEvent[] }[]): string {
  const active = jobs.filter((j) => j.status === "running" || j.status === "stopped");
  if (active.length === 0) {
    return "Last resort if the Arkade operator is down or uncooperative. Start a unilateral exit when you need to sweep to your recovery address without the operator.";
  }
  const running = active.filter((j) => j.status === "running");
  const stopped = active.filter((j) => j.status === "stopped");
  if (running.length > 0) {
    const waitingCsv = running.some((j) =>
      j.events.some((e) => e.status === "waiting_csv"),
    );
    if (waitingCsv) {
      return "Unilateral exit is waiting for the onchain CSV timelock. Cards show blocks left and a time estimate. You can leave this screen; progress continues in the background.";
    }
    return "Unilateral exit is broadcasting and confirming onchain transactions. You can leave this screen; progress continues in the background.";
  }
  if (stopped.length > 0) {
    return "Unilateral exit paused. Tap Resume on a card to continue, or Start another unilateral exit for new funds.";
  }
  return "Unilateral exit status.";
}
