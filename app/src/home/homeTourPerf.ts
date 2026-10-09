/**
 * Temporary Home-tour perf probes (rc.21 investigation).
 * Logs only — no UX changes. Remove after the lag root cause is closed.
 */

let homeRenderCount = 0;
let fpsFrames = 0;
let fpsWindowStart = 0;
let fpsRaf: number | null = null;

export function noteHomeScreenRender(tourOpen: boolean): void {
  homeRenderCount += 1;
  if (!tourOpen) return;
  console.log(
    `[HomeTourPerf] homeRender n=${homeRenderCount} t=${Date.now()} tourOpen=1`,
  );
}

export function startTourJsFpsProbe(): void {
  stopTourJsFpsProbe();
  fpsFrames = 0;
  fpsWindowStart = Date.now();
  const tick = () => {
    fpsFrames += 1;
    const now = Date.now();
    if (now - fpsWindowStart >= 1000) {
      console.log(`[HomeTourPerf] jsFps=${fpsFrames}`);
      fpsFrames = 0;
      fpsWindowStart = now;
    }
    fpsRaf = requestAnimationFrame(tick) as unknown as number;
  };
  fpsRaf = requestAnimationFrame(tick) as unknown as number;
}

export function stopTourJsFpsProbe(): void {
  if (fpsRaf != null) {
    cancelAnimationFrame(fpsRaf);
    fpsRaf = null;
  }
}

export function logTourTap(phase: string, dir: string, t0: number, extra = ""): void {
  const dt = Date.now() - t0;
  console.log(`[HomeTourPerf] ${dir} ${phase} dtMs=${dt}${extra ? ` ${extra}` : ""}`);
}
