import { startTransition, useEffect, useState, type ComponentProps } from 'react';
import { ResponsiveContainer as RechartsResponsiveContainer } from 'recharts';
import { ChartSkeleton } from '../ui/Skeleton';

/**
 * Drop-in for Recharts' ResponsiveContainer that mounts the chart one frame late.
 *
 * Mounting a chart is the bulk of a page's render cost (SVG build, size
 * measurement, entry animation), and that work lands in one blocking commit.
 * On a phone that held a tab switch for 100+ ms with nothing on screen. Showing
 * a skeleton in the chart's box first lets the page itself paint straight away;
 * the charts then fill in as a separate, interruptible transition.
 */
export function ResponsiveContainer(props: ComponentProps<typeof RechartsResponsiveContainer>) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // rAF + timeout: run after the next paint, not just after commit.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => startTransition(() => setReady(true)));
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, []);

  // Fade the chart in over its placeholder rather than swapping it in hard.
  return ready
    ? <RechartsResponsiveContainer {...props} className={`animate-fade-in ${props.className ?? ''}`} />
    : <ChartSkeleton />;
}
