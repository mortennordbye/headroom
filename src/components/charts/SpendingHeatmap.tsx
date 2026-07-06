import { useMemo } from 'react';
import { startOfMonth, endOfMonth, eachDayOfInterval, getDay, format } from 'date-fns';
import { useFinance } from '../../context/FinanceContext';

/**
 * Calendar heatmap of daily spending for the selected month — each day shaded by
 * how much was spent (expense transactions only). Surfaces spending patterns
 * that a running total hides. Pure CSS grid, so it uses the theme tokens directly.
 */
export default function SpendingHeatmap() {
  const { t, currentMonth, dailyTransactions, formatCurrency } = useFinance();

  const { cells, max, leadOffset } = useMemo(() => {
    const monthKey = format(currentMonth, 'yyyy-MM');
    const byDay = new Map<string, number>();
    dailyTransactions
      .filter(tx => tx.date.startsWith(monthKey) && tx.kind !== 'income')
      .forEach(tx => byDay.set(tx.date, (byDay.get(tx.date) ?? 0) + tx.amount));

    const days = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) });
    const c = days.map(d => {
      const key = format(d, 'yyyy-MM-dd');
      return { key, day: d.getDate(), spent: byDay.get(key) ?? 0 };
    });
    // Monday-first offset for the leading blanks.
    const first = startOfMonth(currentMonth);
    const offset = (getDay(first) + 6) % 7;
    return { cells: c, max: Math.max(1, ...c.map(x => x.spent)), leadOffset: offset };
  }, [currentMonth, dailyTransactions]);

  const weekdays = t.common.weekdayInitials;

  return (
    <div className="w-full">
      <div className="grid grid-cols-7 gap-1.5 mb-1.5">
        {weekdays.map((w, i) => (
          <div key={i} className="text-[10px] text-center" style={{ color: 'var(--text-3)' }}>{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: leadOffset }).map((_, i) => <div key={`lead-${i}`} />)}
        {cells.map(c => {
          const intensity = c.spent > 0 ? 0.15 + (c.spent / max) * 0.65 : 0;
          const bg = c.spent > 0
            ? `color-mix(in srgb, var(--rust) ${Math.round(intensity * 100)}%, var(--bg-3))`
            : 'var(--bg-3)';
          return (
            <div
              key={c.key}
              className="aspect-square rounded-[4px] grid place-items-center text-[10px] font-mono"
              style={{ background: bg, color: intensity > 0.5 ? 'var(--text-1)' : 'var(--text-3)' }}
              title={c.spent > 0 ? `${format(new Date(c.key + 'T00:00:00'), 'd. MMM')}: ${formatCurrency(c.spent)}` : format(new Date(c.key + 'T00:00:00'), 'd. MMM')}
              aria-label={`${format(new Date(c.key + 'T00:00:00'), 'd MMM')} — ${formatCurrency(c.spent)}`}
            >
              {c.day}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-end gap-1.5 mt-3 text-[10px]" style={{ color: 'var(--text-3)' }}>
        <span>{t.charts.less}</span>
        {[0, 0.3, 0.55, 0.8].map((v, i) => (
          <span key={i} className="w-2.5 h-2.5 rounded-[3px]" style={{ background: v === 0 ? 'var(--bg-3)' : `color-mix(in srgb, var(--rust) ${Math.round((0.15 + v * 0.65) * 100)}%, var(--bg-3))` }} />
        ))}
        <span>{t.charts.more}</span>
      </div>
    </div>
  );
}
