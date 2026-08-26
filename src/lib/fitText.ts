// Shrink-to-fit sizing for a single line of text (used by ui/FitText).
//
// Long money figures blow out narrow phone boxes. The two habits already in the
// codebase both damage the number: `truncate` clips digits off the end (a
// *wrong* figure, silently), and `[overflow-wrap:anywhere]` breaks it mid-digit
// across lines. Scaling the glyphs down keeps every digit on one line.

/** Below this the digits stop being readable; the box clips instead. */
export const MIN_FIT_SCALE = 0.7;

/**
 * Font-size multiplier that fits `naturalPx` of text into `availablePx`.
 * Never above 1 (text is only ever shrunk, never stretched) and never below
 * `min`. Returns 1 for unmeasurable input, so a not-yet-laid-out or hidden
 * element renders at its natural size rather than collapsing.
 */
export function fitFontScale(availablePx: number, naturalPx: number, min: number = MIN_FIT_SCALE): number {
  if (!Number.isFinite(availablePx) || !Number.isFinite(naturalPx)) return 1;
  if (availablePx <= 0 || naturalPx <= 0 || naturalPx <= availablePx) return 1;
  // Rounded DOWN, so the rounding error can never leave the text a hair too wide.
  return Math.max(min, Math.floor((availablePx / naturalPx) * 1000) / 1000);
}
