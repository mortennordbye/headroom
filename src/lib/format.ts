/**
 * Signed percentage/point formatter: "+4.2%", "-1.3pp". One definition so the
 * dozen chip/tile call sites can't drift on sign handling — and so null
 * (no data) consistently renders as an em dash rather than a fabricated "+0.0%".
 */
export function formatSignedPct(v: number | null | undefined, digits = 1, unit = '%'): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}${unit}`;
}
