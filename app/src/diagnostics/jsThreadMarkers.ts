/**
 * Lightweight tap→firstPaint markers for JS-thread lightening acceptance.
 * Logs only — no UX changes.
 */

const marks = new Map<string, number>();

export function markTapStart(label: string): void {
  marks.set(label, Date.now());
}

export function markFirstPaint(label: string): void {
  const t0 = marks.get(label);
  if (t0 == null) return;
  marks.delete(label);
  console.log(`[JsThread] tap→paint label=${label} dtMs=${Date.now() - t0}`);
}

export function logJsThread(msg: string, extra?: Record<string, unknown>): void {
  if (extra) {
    console.log(`[JsThread] ${msg}`, extra);
  } else {
    console.log(`[JsThread] ${msg}`);
  }
}
