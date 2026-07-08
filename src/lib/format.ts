/**
 * Signed percentage/point formatter: "+4.2%", "-1.3pp". One definition so the
 * dozen chip/tile call sites can't drift on sign handling — and so null
 * (no data) consistently renders as an em dash rather than a fabricated "+0.0%".
 */
export function formatSignedPct(v: number | null | undefined, digits = 1, unit = '%'): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}${unit}`;
}

/**
 * Compact axis-tick formatter for chart Y axes: 1_500_000 → "1.5M",
 * 12_000 → "12k", below 1k the raw integer. One definition so every chart's
 * tick labels stay consistent (was copy-pasted in four page components).
 */
export function formatAxisInt(val: number): string {
  if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (Math.abs(val) >= 1_000) return `${Math.round(val / 1_000)}k`;
  return val.toString();
}
