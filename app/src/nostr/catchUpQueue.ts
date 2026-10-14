/**
 * Serialize Nostr catch-up jobs so gift-wrap / bot / chat do not stampede.
 * Waiters for the same id all resolve/reject with the run that actually executes.
 */

type Waiter = {
  resolve: () => void;
  reject: (e: unknown) => void;
};

type Slot = {
  id: string;
  run: () => Promise<void>;
  waiters: Waiter[];
};

const pending = new Map<string, Slot>();
let draining = false;

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (pending.size > 0) {
      const id = pending.keys().next().value as string;
      const slot = pending.get(id);
      if (!slot) {
        pending.delete(id);
        continue;
      }
      pending.delete(id);
      try {
        await slot.run();
        for (const w of slot.waiters) w.resolve();
      } catch (e) {
        console.warn(`[catchUpQueue] job ${slot.id} failed`, e);
        for (const w of slot.waiters) w.reject(e);
      }
    }
  } finally {
    draining = false;
    if (pending.size > 0) void drain();
  }
}

/**
 * Enqueue a catch-up. Identical `id` coalesces onto the latest run; all waiters
 * share that outcome. `force` replaces the pending run function.
 */
export function enqueueCatchUp(
  id: string,
  run: () => Promise<void>,
  opts?: { force?: boolean },
): Promise<void> {
  const force = opts?.force === true;
  return new Promise<void>((resolve, reject) => {
    const existing = pending.get(id);
    if (existing) {
      if (force) existing.run = run;
      existing.waiters.push({ resolve, reject });
    } else {
      pending.set(id, {
        id,
        run,
        waiters: [{ resolve, reject }],
      });
    }
    void drain();
  });
}
