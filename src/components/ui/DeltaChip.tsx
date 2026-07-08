import type { ReactNode } from 'react';
import { ChevronsUp, ChevronsDown } from 'lucide-react';

type Tone = 'positive' | 'negative' | 'warning' | 'accent' | 'violet' | 'pink' | 'muted';

interface DeltaChipProps {
  tone?: Tone;
  showArrow?: boolean;
  icon?: ReactNode;
  size?: 'sm' | 'md';
  children: ReactNode;
  className?: string;
}

const toneStyle: Record<Tone, { bg: string; color: string }> = {
  positive: { bg: 'var(--positive-bg)', color: 'var(--positive)' },
  negative: { bg: 'var(--negative-bg)', color: 'var(--negative)' },
  warning: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
  accent: { bg: 'var(--accent-bg)', color: 'var(--accent)' },
  violet: { bg: 'var(--violet-bg)', color: 'var(--violet)' },
  pink: { bg: 'var(--pink-bg)', color: 'var(--pink)' },
  muted: { bg: 'var(--surface-5)', color: 'var(--text-2)' },
};

export function DeltaChip({
  tone = 'muted',
  showArrow = false,
  icon,
  size = 'md',
  children,
  className = '',
}: DeltaChipProps) {
  const s = toneStyle[tone];
  const dims =
    size === 'sm'
      ? 'h-[18px] px-[7px] text-[10px]'
      : 'h-6 px-2.5 text-[12px]';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[4px] font-semibold tabular-nums ${dims} ${className}`}
      style={{ background: s.bg, color: s.color }}
    >
      {showArrow && tone === 'positive' && <ChevronsUp className="w-[11px] h-[11px]" strokeWidth={3} />}
      {showArrow && tone === 'negative' && <ChevronsDown className="w-[11px] h-[11px]" strokeWidth={3} />}
      {icon && <span className="flex items-center [&_svg]:w-[11px] [&_svg]:h-[11px]">{icon}</span>}
      {children}
    </span>
  );
}
