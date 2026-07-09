import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format, parse } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance } from '../../context/FinanceContext';
import { savingsSeriesFrom } from '../../lib/snapshotSeries';
import { fillMonthGaps } from '../../lib/monthGrid';
import ChartTooltip from '../ChartTooltip';
import { SERIES, AXIS_PROPS, AXIS_PROPS_Y, GRID_PROPS } from '../../lib/chartColors';

/**
 * Per-account savings balance over recorded months (HISTORY_PLAN §6.5). One line
 * per account, matched by id across months. Hidden until ≥2 months with accounts.
 */
export default function SavingsHistoryChart() {
  const { t, lang, formatCurrency, formatCurrencyShort, balanceSnapshots } = useFinance();
  const c = t.charts;
  const dateLocale = lang === 'nb' ? nb : enUS;

  const { rows, accounts } = useMemo(() => savingsSeriesFrom(balanceSnapshots), [balanceSnapshots]);

  const data = useMemo(() => {
    // Insert gap months (all accounts null) so a skipped month breaks each line.
    const gap = (k: string): Record<string, number | string | null> =>
      ({ month: k, ...Object.fromEntries(accounts.map(a => [a.id, null])) });
    const filled = fillMonthGaps(rows as Array<Record<string, number | string | null>>, r => String(r.month), gap);
    return filled.map(r => ({ ...r, month: format(parse(String(r.month), 'yyyy-MM', new Date()), 'MMM yy', { locale: dateLocale }) }));
  }, [rows, accounts, dateLocale]);

  if (rows.length < 2 || accounts.length === 0) return null;

  return (
    <div className="bg-[var(--bg-card)] rounded-[8px] border border-[var(--border)] p-5 md:p-7">
      <div className="pb-4 mb-2 border-b border-[var(--border)]">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.1em]" style={{ color: 'var(--text-2)' }}>{c.savingsHistoryTitle}</h3>
        <p className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>{c.savingsHistorySub}</p>
      </div>
      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
            <CartesianGrid {...GRID_PROPS} vertical={false} />
            <XAxis dataKey="month" {...AXIS_PROPS} interval="preserveStartEnd" minTickGap={28} />
            <YAxis tickFormatter={formatCurrencyShort} {...AXIS_PROPS_Y} width={52} domain={['auto', 'auto']} />
            <Tooltip content={<ChartTooltip valueFormatter={formatCurrency} labelFormatter={(l) => String(l)} />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {accounts.map((a, i) => (
              <Line key={a.id} name={a.name} type="monotone" dataKey={a.id} stroke={SERIES[i % SERIES.length]} strokeWidth={2} dot={{ r: 2 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
