/**
 * Per-wallet rematerialize queue with a short JS time budget so sheet pans
 * stay responsive. Pauses while uiBusyGate is held.
 */

import { isUiBusy } from "../runtime/uiBusyGate";

const BUDGET_MS = 12;

type Waiter<T> = {
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
};

type Slot = {
  walletId: string;
  run: () => Promise<unknown>;
  force: boolean;
  waiters: Waiter<unknown>[];
};

const pending = new Map<string, Slot>();
let draining = false;

function yieldToUi(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

async function waitWhileBusy(): Promise<void> {
  while (isUiBusy()) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (pending.size > 0) {
      const walletId = pending.keys().next().value as string;
      const slot = pending.get(walletId);
      if (!slot) {
        pending.delete(walletId);
        continue;
      }
      pending.delete(walletId);
      await waitWhileBusy();
      const t0 = Date.now();
      try {
        const result = await slot.run();
        for (const w of slot.waiters) w.resolve(result);
      } catch (e) {
        for (const w of slot.waiters) w.reject(e);
      }
      if (Date.now() - t0 > BUDGET_MS || isUiBusy()) {
        await waitWhileBusy();
      }
      await yieldToUi();
    }
  } finally {
    draining = false;
    if (pending.size > 0) void drain();
  }
}

/**
 * Enqueue rematerialize for a wallet. Coalesces waiters onto one run.
 * Force replaces the pending run function.
 */
export function enqueueRematerialize<T>(
  walletId: string,
  run: () => Promise<T>,
  opts?: { force?: boolean },
): Promise<T> {
  const force = opts?.force === true;
  return new Promise<T>((resolve, reject) => {
    const existing = pending.get(walletId);
    if (existing) {
      if (force) existing.run = run as () => Promise<unknown>;
      existing.force = existing.force || force;
      existing.waiters.push({
        resolve: resolve as (v: unknown) => void,
        reject,
      });
    } else {
      pending.set(walletId, {
        walletId,
        run: run as () => Promise<unknown>,
        force,
        waiters: [
          {
            resolve: resolve as (v: unknown) => void,
            reject,
          },
        ],
      });
    }
    void drain();
  });
}

/** Yield helper for chunked SDK/parse loops inside a rematerialize run. */
export async function rematerializeYieldIfNeeded(startedAt: number): Promise<void> {
  if (isUiBusy() || Date.now() - startedAt >= BUDGET_MS) {
    await waitWhileBusy();
    await yieldToUi();
  }
}
