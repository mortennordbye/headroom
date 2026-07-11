interface SkeletonProps {
  /** Sizing / shape utilities (height, width, rounding). */
  className?: string;
}

/**
 * A neutral placeholder block that pulses while content loads. Decorative, so
 * it's hidden from assistive tech — the loading state is announced by the
 * container's role/label. Honours prefers-reduced-motion via the global
 * reduced-motion CSS (the pulse is neutralized to a static block).
 */
export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`animate-skeleton bg-[var(--bg-elev)] rounded-[var(--radius-md)] ${className}`}
    />
  );
}

/** Fills a chart's reserved box while its lazy bundle loads. */
export function ChartSkeleton({ className = 'h-full w-full' }: SkeletonProps) {
  return <Skeleton className={className} />;
}
