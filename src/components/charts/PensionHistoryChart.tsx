import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format, parse } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance } from '../../context/FinanceContext';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { pensionSeriesFrom } from '../../lib/snapshotSeries';
import { fillMonthGaps } from '../../lib/monthGrid';
import ChartTooltip from '../ChartTooltip';
import { CHART, AXIS_PROPS, AXIS_PROPS_Y, GRID_PROPS } from '../../lib/chartColors';

/**
 * OTP/IPS pension balance over recorded months (HISTORY_PLAN §6.5), so "projected
 * vs actually grew" is visible next to the projection. Hidden until ≥2 months.
 */
export default function PensionHistoryChart() {
  const { t, lang, formatCurrency, formatCurrencyShort, balanceSnapshots } = useFinance();
  const reduced = useReducedMotion();
  const c = t.charts;
  const dateLocale = lang === 'nb' ? nb : enUS;

  const rows = useMemo(() => pensionSeriesFrom(balanceSnapshots), [balanceSnapshots]);
  const data = useMemo(() => {
    // Gap months (otp/ips null) break the lines at unrecorded months.
    const filled = fillMonthGaps<{ month: string; otp: number | null; ips: number | null }>(
      rows, r => r.month, k => ({ month: k, otp: null, ips: null }),
    );
    return filled.map(r => ({ ...r, month: format(parse(r.month, 'yyyy-MM', new Date()), 'MMM yy', { locale: dateLocale }) }));
  }, [rows, dateLocale]);

  // Need at least two months with any pension balance to show a trend.
  if (rows.length < 2 || rows.every(r => r.otp === 0 && r.ips === 0)) return null;

  return (
    <div className={`bg-[var(--bg-card)] rounded-[8px] border border-[var(--border)] p-5 md:p-7`}>
      <div className="pb-4 mb-2 border-b border-[var(--border)]">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.1em]" style={{ color: 'var(--text-2)' }}>{c.pensionHistoryTitle}</h3>
        <p className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>{c.pensionHistorySub}</p>
      </div>
      <div role="img" aria-label={t.charts.aria.pensionHistory} className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
            <CartesianGrid {...GRID_PROPS} vertical={false} />
            <XAxis dataKey="month" {...AXIS_PROPS} interval="preserveStartEnd" minTickGap={28} />
            <YAxis tickFormatter={formatCurrencyShort} {...AXIS_PROPS_Y} width={52} domain={['auto', 'auto']} />
            <Tooltip content={<ChartTooltip valueFormatter={formatCurrency} labelFormatter={(l) => String(l)} />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line isAnimationActive={!reduced} name={c.otpLine} type="monotone" dataKey="otp" stroke={CHART.teal} strokeWidth={2} dot={{ r: 2 }} />
            <Line isAnimationActive={!reduced} name={c.ipsLine} type="monotone" dataKey="ips" stroke={CHART.brass} strokeWidth={2} dot={{ r: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
