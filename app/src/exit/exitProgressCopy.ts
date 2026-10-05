/**
 * Format ExecutorEvent lines and CSV lock summaries for exit hub cards.
 */

import type { ExecutorEvent } from "@arkade-os/sdk";
import type { ArkadeNetworkId } from "../config/network";
import type { TranslateFn } from "../i18n/i18n";

/** Typical block interval for ETA (not consensus). */
export function approxBlockIntervalSec(networkId: ArkadeNetworkId): number {
  return networkId === "mainnet" ? 600 : 30;
}

/** Human remaining time: days / hours / minutes (never bare "0s"). */
export function formatRemainingDuration(totalSec: number, t: TranslateFn): string {
  const s = Math.max(0, Math.ceil(totalSec));
  if (s < 60) {
    return s <= 0
      ? t("exit.durLessThanMinute")
      : s === 1
        ? t("exit.durAboutSecond", { count: s })
        : t("exit.durAboutSeconds", { count: s });
  }
  const mins = Math.ceil(s / 60);
  if (mins < 60) {
    return mins === 1
      ? t("exit.durAboutMinute", { count: mins })
      : t("exit.durAboutMinutes", { count: mins });
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 48) {
    if (remMins === 0) {
      return hours === 1
        ? t("exit.durAboutHour", { count: hours })
        : t("exit.durAboutHours", { count: hours });
    }
    return t("exit.durHoursMins", { hours, mins: remMins });
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (remHours === 0) {
    return days === 1
      ? t("exit.durAboutDay", { count: days })
      : t("exit.durAboutDays", { count: days });
  }
  return t("exit.durDaysHours", { days, hours: remHours });
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
  t: TranslateFn,
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
        headline: t("exit.csvUntilBlock", { height: maturesAtHeight }),
        detail: t("exit.csvFetchingTip"),
      };
    }
    const blocksLeft = Math.max(0, maturesAtHeight - tip);
    const etaSec = blocksLeft * approxBlockIntervalSec(opts.networkId);
    if (blocksLeft === 0) {
      return {
        headline: t("exit.csvMature"),
        detail: t("exit.csvSweepNextPoll"),
      };
    }
    return {
      headline:
        blocksLeft === 1
          ? t("exit.csvBlocksLeft", { count: blocksLeft })
          : t("exit.csvBlocksLeftPlural", { count: blocksLeft }),
      detail: t("exit.csvEtaDetail", {
        eta: formatRemainingDuration(etaSec, t),
        height: maturesAtHeight.toLocaleString("en-US"),
        tip: tip.toLocaleString("en-US"),
      }),
    };
  }

  if (maturesAtTime != null) {
    const left = Math.max(0, maturesAtTime - nowSec);
    const blockSec = approxBlockIntervalSec(opts.networkId);
    const approxBlocks = Math.max(0, Math.ceil(left / blockSec));
    return {
      headline: t("exit.csvTimeRemaining", {
        eta: formatRemainingDuration(left, t),
      }),
      detail:
        left <= 0
          ? t("exit.csvSweepNextPoll")
          : approxBlocks === 1
            ? t("exit.csvApproxBlocks", { count: approxBlocks, sec: blockSec })
            : t("exit.csvApproxBlocksPlural", {
                count: approxBlocks,
                sec: blockSec,
              }),
    };
  }

  return {
    headline: t("exit.csvWaiting"),
    detail: t("exit.csvNoDetails"),
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

export function formatExitEventLine(
  ev: ExecutorEvent,
  t: TranslateFn,
  nowSec = Date.now() / 1000,
): string {
  const parts: string[] = [`#${ev.stepIndex}`, ev.kind, ev.status];
  if (ev.txid) parts.push(`${ev.txid.slice(0, 10)}…`);
  if (ev.reason) parts.push(ev.reason);
  if (ev.status === "waiting_csv") {
    if (ev.maturesAtTime != null) {
      const left = Math.max(0, ev.maturesAtTime - nowSec);
      parts.push(formatRemainingDuration(left, t));
    } else if (ev.maturesAtHeight != null) {
      parts.push(`until block ${ev.maturesAtHeight}`);
    }
  }
  return parts.join(" · ");
}

export function exitJobCaption(
  jobs: { status: string; events: ExecutorEvent[] }[],
  t: TranslateFn,
): string {
  const active = jobs.filter((j) => j.status === "running" || j.status === "stopped");
  if (active.length === 0) {
    return t("exit.captionIdle");
  }
  const running = active.filter((j) => j.status === "running");
  const stopped = active.filter((j) => j.status === "stopped");
  if (running.length > 0) {
    const waitingCsv = running.some((j) =>
      j.events.some((e) => e.status === "waiting_csv"),
    );
    if (waitingCsv) {
      return t("exit.captionWaitingCsv");
    }
    return t("exit.captionBroadcasting");
  }
  if (stopped.length > 0) {
    return t("exit.captionPaused");
  }
  return t("exit.captionStatus");
}
