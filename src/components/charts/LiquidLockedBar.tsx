import { useFinance } from '../../context/FinanceContext';
import { CHART } from '../../lib/chartColors';

interface LiquidLockedBarProps {
  /** Stocks + cash + crypto — accessible today (subject to tax/fees). */
  liquid: number;
  /** Property equity + pension — tied up or locked until retirement. */
  locked: number;
}

/**
 * Splits net worth into what you could actually access (liquid: stocks, cash,
 * crypto) versus what's tied up (locked: property equity + pension). A single
 * 100%-stacked bar plus the two figures — a fast read on financial flexibility.
 */
export default function LiquidLockedBar({ liquid, locked }: LiquidLockedBarProps) {
  const { t, formatCurrency } = useFinance();
  const lq = Math.max(0, liquid);
  const lk = Math.max(0, locked);
  const total = lq + lk;
  const lqPct = total > 0 ? (lq / total) * 100 : 0;
  const lkPct = total > 0 ? (lk / total) * 100 : 0;

  const rows = [
    { label: t.charts.liquid, value: lq, pct: lqPct, color: CHART.forestLight, sub: t.charts.liquidSub },
    { label: t.charts.locked, value: lk, pct: lkPct, color: CHART.teal, sub: t.charts.lockedSub },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex h-3 rounded-full overflow-hidden" style={{ background: 'var(--bg-raised)' }}>
        {lqPct > 0 && <div style={{ width: `${lqPct}%`, background: CHART.forestLight }} />}
        {lkPct > 0 && <div style={{ width: `${lkPct}%`, background: CHART.teal }} />}
      </div>
      <div className="flex flex-col gap-4">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: r.color }} />
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-[var(--text-1)]">{r.label}</div>
                <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>{r.sub}</div>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[14px] font-mono font-semibold tabular-nums text-[var(--text-1)]">{formatCurrency(r.value)}</div>
              <div className="text-[11px] font-mono tabular-nums" style={{ color: 'var(--text-3)' }}>{Math.round(r.pct)}%</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
