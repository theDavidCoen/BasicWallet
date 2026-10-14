/**
 * Run work after the next paint so navigation / sheet open can commit first.
 */
export function paintThen(fn: () => void | Promise<void>): void {
  requestAnimationFrame(() => {
    void Promise.resolve(fn()).catch((e) => {
      console.warn("[basic] paintThen failed", e);
    });
  });
}
