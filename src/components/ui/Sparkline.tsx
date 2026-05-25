import { useId } from 'react';

type Tone = 'positive' | 'negative' | 'accent' | 'violet' | 'warning' | 'auto';

interface SparklineProps {
  values: number[];
  tone?: Tone;
  width?: number | string;
  height?: number;
  showArea?: boolean;
  showLastDot?: boolean;
  strokeWidth?: number;
  className?: string;
}

const toneColor: Record<Exclude<Tone, 'auto'>, string> = {
  positive: 'var(--positive)',
  negative: 'var(--negative)',
  accent: 'var(--accent)',
  violet: 'var(--violet)',
  warning: 'var(--warning)',
};

export function Sparkline({
  values,
  tone = 'auto',
  width = '100%',
  height = 32,
  showArea = true,
  showLastDot = false,
  strokeWidth = 1.5,
  className = '',
}: SparklineProps) {
  const gradId = useId();

  if (!values.length) {
    return <svg width={width} height={height} className={className} />;
  }

  if (values.length === 1) {
    return (
      <svg width={width} height={height} className={className} viewBox={`0 0 100 ${height}`}>
        <line x1="0" y1={height / 2} x2="100" y2={height / 2} stroke="var(--text-3)" strokeDasharray="2 3" strokeWidth="1" />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padY = strokeWidth + 2;
  const usableH = height - padY * 2;
  const W = 100;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = padY + (1 - (v - min) / range) * usableH;
    return { x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const areaPath = `${linePath} L${W},${height} L0,${height} Z`;

  const resolvedTone: Exclude<Tone, 'auto'> =
    tone === 'auto' ? (values[values.length - 1] >= values[0] ? 'positive' : 'negative') : tone;
  const color = toneColor[resolvedTone];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      className={className}
    >
      {showArea && (
        <>
          <defs>
            <linearGradient id={`spark-${gradId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.3" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#spark-${gradId})`} />
        </>
      )}
      <path d={linePath} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      {showLastDot && (
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="2.5" fill={color} />
      )}
    </svg>
  );
}
