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
 * Human-readable byte size: 900 → "900 B", 12_800 → "12.5 KB",
 * 3_500_000 → "3.34 MB". Binary (1024) units, matching the server's own
 * blob-size log. Used to surface the SQLite blob size in Settings.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
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
