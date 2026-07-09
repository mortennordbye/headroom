import { useMemo } from 'react';
import { format, parse } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance } from '../context/FinanceContext';
import { equitySeriesFrom } from '../lib/equity';
import { CHART } from '../lib/chartColors';

const MAX_ROWS = 12;

/**
 * Egenkapital history (HISTORY_PLAN §6.1): per recorded month, the equity
 * breakdown by bucket plus month-over-month total delta. Derived from snapshots
 * through `equitySeriesFrom` (the same `computeEquityBreakdown` the live page
 * uses), so it can never drift from the live figure. Hidden until ≥2 months.
 */
export default function EquityHistoryTable() {
  const { t, lang, formatCurrencyShort, balanceSnapshots } = useFinance();
  const c = t.charts;
  const dateLocale = lang === 'nb' ? nb : enUS;

  const rows = useMemo(() => {
    const series = equitySeriesFrom(balanceSnapshots);
    return series
      .map((p, i) => {
        const b = p.breakdown;
        // cash bucket = bsu + savings + buffer = total − the other three buckets.
        const cash = b.totalEquity - b.netInvestment - b.netCrypto - b.houseEquity;
        const prev = series[i - 1]?.breakdown.totalEquity;
        return {
          monthKey: p.monthKey,
          stocks: b.netInvestment,
          house: b.houseEquity,
          crypto: b.netCrypto,
          cash,
          total: b.totalEquity,
          delta: prev === undefined ? null : b.totalEquity - prev,
        };
      })
      .reverse() // newest first
      .slice(0, MAX_ROWS);
  }, [balanceSnapshots]);

  if (rows.length < 2) return null;

  const label = (mk: string) => format(parse(mk, 'yyyy-MM', new Date()), 'MMM yy', { locale: dateLocale });
  const cols: { key: 'stocks' | 'house' | 'crypto' | 'cash'; label: string }[] = [
    { key: 'stocks', label: t.bucketStocks },
    { key: 'house', label: t.bucketHouse },
    { key: 'crypto', label: t.bucketCrypto },
    { key: 'cash', label: t.bucketCash },
  ];

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-[12px] tabular-nums">
        <thead>
          <tr style={{ color: 'var(--text-3)' }}>
            <th className="text-left font-medium py-1.5 pr-3"></th>
            {cols.map(col => (
              <th key={col.key} className="text-right font-medium py-1.5 px-2 whitespace-nowrap">{col.label}</th>
            ))}
            <th className="text-right font-medium py-1.5 pl-2 whitespace-nowrap">{c.equityHistoryTotal}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.monthKey} className="border-t" style={{ borderColor: 'var(--border)' }}>
              <td className="text-left py-1.5 pr-3 capitalize font-medium" style={{ color: 'var(--text-2)' }}>{label(r.monthKey)}</td>
              {cols.map(col => (
                <td key={col.key} className="text-right py-1.5 px-2 font-mono" style={{ color: 'var(--text-2)' }}>
                  {formatCurrencyShort(r[col.key])}
                </td>
              ))}
              <td className="text-right py-1.5 pl-2 font-mono font-semibold" style={{ color: 'var(--text-1)' }}>
                {formatCurrencyShort(r.total)}
                {r.delta !== null && r.delta !== 0 && (
                  <span
                    className="ml-1.5 text-[10px] font-normal"
                    style={{ color: r.delta > 0 ? CHART.forestLight : CHART.rust }}
                  >
                    {r.delta > 0 ? '▲' : '▼'}{formatCurrencyShort(Math.abs(r.delta))}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
