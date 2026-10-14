/**
 * Serialize Nostr catch-up jobs so gift-wrap / bot / chat do not stampede.
 */

type Job = {
  id: string;
  run: () => Promise<void>;
};

let chain: Promise<void> = Promise.resolve();
const latest = new Map<string, Job>();

/**
 * Enqueue a catch-up. Identical `id` coalesces onto the latest run.
 */
export function enqueueCatchUp(
  id: string,
  run: () => Promise<void>,
  _opts?: { force?: boolean },
): Promise<void> {
  latest.set(id, { id, run });
  const done = new Promise<void>((resolve, reject) => {
    chain = chain
      .then(async () => {
        const job = latest.get(id);
        if (!job) {
          resolve();
          return;
        }
        // Only run if we are still the latest for this id.
        latest.delete(id);
        try {
          await job.run();
          resolve();
        } catch (e) {
          console.warn(`[catchUpQueue] job ${job.id} failed`, e);
          reject(e);
        }
      })
      .catch(() => {
        /* keep chain alive */
      });
  });
  return done;
}
