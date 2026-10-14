/**
 * Single Home fallback scheduler — one 1s tick drives balance / rates / ASP
 * tasks instead of N independent setIntervals. Event paths (notify, chat,
 * FCM) stay outside this module.
 */

import { AppState } from "react-native";
import { isUiBusy } from "../runtime/uiBusyGate";

export type HomeIdleTask = {
  id: string;
  intervalMs: number;
  run: () => void | Promise<void>;
  /** When true, skip this tick (in addition to global uiBusy). */
  paused?: () => boolean;
};

const TICK_MS = 1_000;

const tasks = new Map<string, HomeIdleTask & { lastRunAt: number }>();
let timer: ReturnType<typeof setInterval> | null = null;
let pauseAllDepth = 0;
let started = false;

function ensureTimer(): void {
  if (timer != null) return;
  timer = setInterval(() => {
    if (pauseAllDepth > 0) return;
    if (AppState.currentState === "background") return;
    if (isUiBusy()) return;
    const now = Date.now();
    for (const task of tasks.values()) {
      if (task.paused?.()) continue;
      if (now - task.lastRunAt < task.intervalMs) continue;
      task.lastRunAt = now;
      try {
        void Promise.resolve(task.run()).catch((e) => {
          console.warn(`[homeIdleScheduler] task ${task.id} failed`, e);
        });
      } catch (e) {
        console.warn(`[homeIdleScheduler] task ${task.id} threw`, e);
      }
    }
  }, TICK_MS);
  if (!started) {
    started = true;
    console.log("[homeIdleScheduler] started tickMs=1000");
  }
}

function maybeStopTimer(): void {
  if (tasks.size > 0) return;
  if (timer != null) {
    clearInterval(timer);
    timer = null;
  }
}

export function registerHomeIdleTask(task: HomeIdleTask): () => void {
  tasks.set(task.id, { ...task, lastRunAt: 0 });
  ensureTimer();
  return () => {
    tasks.delete(task.id);
    maybeStopTimer();
  };
}

/** Nested pause (e.g. tests / rare holds). uiBusy already pauses ticks. */
export function pauseHomeIdleScheduler(): void {
  pauseAllDepth += 1;
}

export function resumeHomeIdleScheduler(): void {
  pauseAllDepth = Math.max(0, pauseAllDepth - 1);
}

export function homeIdleSchedulerDebug(): {
  taskIds: string[];
  ticking: boolean;
  pauseAllDepth: number;
} {
  return {
    taskIds: [...tasks.keys()],
    ticking: timer != null,
    pauseAllDepth,
  };
}
