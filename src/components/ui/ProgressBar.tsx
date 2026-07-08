interface ProgressBarProps {
  /** Fill percentage. Clamped to [0, 100] here; NaN/Infinity render as 0. */
  pct: number;
  /** CSS colour for the fill (`var(--…)` or a CHART hex). */
  color: string;
  /** Tailwind height class, e.g. 'h-1.5' | 'h-2' | 'h-3'. */
  heightClass?: string;
  /** CSS colour for the track. */
  trackColor?: string;
  /** Square-ish 3px corners (category/goal lists) instead of pill ends. */
  square?: boolean;
  className?: string;
}

/**
 * The one horizontal progress bar. Clamping (and the NaN guard) lives here so
 * no caller can leak an overflowing or non-finite width into the render — the
 * money-math bug class CLAUDE.md warns about.
 */
export function ProgressBar({
  pct, color, heightClass = 'h-2', trackColor = 'var(--bg-elev)', square = false, className = '',
}: ProgressBarProps) {
  const width = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
  const radius = square ? 'rounded-[3px]' : 'rounded-full';
  return (
    <div className={`${heightClass} ${radius} overflow-hidden ${className}`} style={{ background: trackColor }}>
      <div
        className={`h-full ${radius} transition-[width] duration-300`}
        style={{ width: `${width}%`, background: color }}
      />
    </div>
  );
}
