import { Card } from './Card';

/**
 * Headline metric tile: uppercase label, large mono value, optional sub-line.
 * Shared by the Pension and Employer-cost pages (identical hand-rolled copies
 * before extraction). The Salary/Forecast/Loan pages keep bespoke variants
 * with different padding, layout, or extra slots.
 */
export function SummaryTile({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <Card padding="md">
      <div className="text-[11px] font-medium uppercase tracking-[0.1em]" style={{ color: 'var(--text-2)' }}>{label}</div>
      <div className="text-[14px] md:text-[24px] leading-tight [overflow-wrap:anywhere] font-semibold font-mono tabular-nums mt-1.5" style={{ color: color ?? 'var(--text-1)' }}>
        {value}
      </div>
      {sub && <div className="text-[11px] font-mono mt-1" style={{ color: 'var(--text-3)' }}>{sub}</div>}
    </Card>
  );
}
