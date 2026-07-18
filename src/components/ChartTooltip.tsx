import type { ReactNode } from 'react';
import { useFinance } from '../context/FinanceContext';

/** Minimal shape of a Recharts tooltip payload entry (the fields this component reads). */
interface TooltipEntry {
  color?: string;
  fill?: string;
  name?: string | number;
  value?: number | string;
  [key: string]: unknown;
}

interface ChartTooltipProps {
  // Injected by Recharts when used as <Tooltip content={<ChartTooltip />} />
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  /** Override how each value is rendered. Defaults to formatCurrency. Receives the raw value and the payload entry. */
  valueFormatter?: (value: number, entry: TooltipEntry) => string;
  /** Override the header label (the x-axis category). */
  labelFormatter?: (label: string | number) => string;
  /** Hide the header label line entirely. */
  hideLabel?: boolean;
  /** Prominent bold header (primary text), instead of the dim uppercase label eyebrow. */
  title?: ReactNode;
  /** Extra dim line rendered below the value rows (e.g. a share-of-total note). */
  extra?: ReactNode;
  /** Render value-only rows, dropping the per-entry name (use with `title`). */
  hideNames?: boolean;
}

/**
 * Shared Recharts tooltip — a clean card (no "name : value" colon), themed with
 * CSS tokens and currency-aware by default. Use as `content={<ChartTooltip />}`.
 */
export default function ChartTooltip({
  active,
  payload,
  label,
  valueFormatter,
  labelFormatter,
  hideLabel,
  title,
  extra,
  hideNames,
}: ChartTooltipProps) {
  const { formatCurrency } = useFinance();
  // Range series (e.g. scenario bands) carry a [low, high] array value that
  // isn't a single figure to show — drop them so they don't render a NaN row.
  const entries = payload?.filter((p) => !Array.isArray(p.value)) ?? [];
  if (!active || entries.length === 0) return null;
  const fmt = valueFormatter ?? ((v: number) => formatCurrency(v));

  return (
    <div
      className="rounded-[8px] px-3 py-2.5"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
    >
      {title != null && title !== '' ? (
        <div className="text-[13px] font-semibold mb-1" style={{ color: 'var(--text-1)' }}>{title}</div>
      ) : (!hideLabel && label != null && label !== '' && (
        <div className="text-[10px] uppercase tracking-[0.08em] mb-1.5" style={{ color: 'var(--text-3)' }}>
          {labelFormatter ? labelFormatter(label) : label}
        </div>
      ))}
      <div className="flex flex-col gap-1">
        {entries.map((p: TooltipEntry, i: number) => (
          <div key={i} className="flex items-center gap-2 text-[12px]">
            {!hideNames && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color || p.fill || 'var(--text-3)' }} />}
            {!hideNames && p.name != null && p.name !== '' && (
              <span style={{ color: 'var(--text-2)' }}>{p.name}</span>
            )}
            <span className={`font-semibold font-mono tabular-nums ${hideNames ? '' : 'ml-auto pl-4'}`} style={{ color: 'var(--text-1)' }}>
              {fmt(Number(p.value ?? 0), p)}
            </span>
          </div>
        ))}
      </div>
      {extra != null && extra !== '' && (
        <div className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{extra}</div>
      )}
    </div>
  );
}
