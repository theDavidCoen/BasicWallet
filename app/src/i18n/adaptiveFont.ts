/**
 * Shared font scaling for longer IT/PT strings on dense UI (buttons, rows, CTAs).
 * Prefer AdaptiveText (adjustsFontSizeToFit) for single-line labels; use scaleFontSize
 * when you need a StyleSheet fontSize beforehand.
 */

export type AdaptiveFontOpts = {
  /** Baseline font size (English design). */
  base: number;
  /** Soften shrink below this. Default 0.78. */
  minScale?: number;
  /** Length at which scaling starts. Default 12. */
  softLen?: number;
  /** Length that hits minScale. Default 28. */
  hardLen?: number;
};

/** Scale font size down as `text` grows past softLen. */
export function scaleFontSize(text: string, opts: AdaptiveFontOpts): number {
  const { base, minScale = 0.78, softLen = 12, hardLen = 28 } = opts;
  const len = text.trim().length;
  if (len <= softLen) return base;
  if (len >= hardLen) return Math.max(8, Math.round(base * minScale));
  const t = (len - softLen) / (hardLen - softLen);
  const scale = 1 - t * (1 - minScale);
  return Math.max(8, Math.round(base * scale));
}

/** Props to spread onto RN Text for single-line auto-shrink. */
export function fitTextProps(opts?: {
  numberOfLines?: number;
  minimumFontScale?: number;
}) {
  return {
    numberOfLines: opts?.numberOfLines ?? 1,
    adjustsFontSizeToFit: true as const,
    minimumFontScale: opts?.minimumFontScale ?? 0.72,
  };
}
