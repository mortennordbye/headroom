import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format, parse } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance } from '../../context/FinanceContext';
import { paydownVsPlan } from '../../lib/paydown';
import { fillMonthGaps } from '../../lib/monthGrid';
import ChartTooltip from '../ChartTooltip';
import { CHART, AXIS_PROPS, AXIS_PROPS_Y, GRID_PROPS } from '../../lib/chartColors';

const card = 'bg-[var(--bg-card)] rounded-[8px] border border-[var(--border)]';
const sectionLabel = 'text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-2)]';

/**
 * Mortgage paydown plan-vs-actual (HISTORY_PLAN §6.3). Actual = each recorded
 * month's mortgage balance (solid); plan = the amortization curve anchored at the
 * earliest recorded balance (dashed). Everything derives from snapshots via
 * `paydownVsPlan`; nothing stored twice. Hidden until ≥2 recorded months exist.
 */
export default function PaydownVsPlanChart() {
  const { t, lang, formatCurrency, formatCurrencyShort, balanceSnapshots } = useFinance();
  const c = t.charts;
  const dateLocale = lang === 'nb' ? nb : enUS;

  const result = useMemo(() => paydownVsPlan(balanceSnapshots), [balanceSnapshots]);

  const data = useMemo(() => {
    // Expand to a continuous monthly grid so a skipped month shows as a break in
    // the actual line, not a straight segment across unrecorded data.
    const recorded = result.points.map(p => ({ key: p.monthKey, actual: Math.round(p.actual) as number | null, plan: p.plan as number | null }));
    const filled = fillMonthGaps(recorded, r => r.key, k => ({ key: k, actual: null, plan: null }));
    return filled.map(r => ({
      month: format(parse(r.key, 'yyyy-MM', new Date()), 'MMM yy', { locale: dateLocale }),
      actual: r.actual,
      plan: r.plan,
    }));
  }, [result, dateLocale]);

  if (result.points.length < 2) return null; // need history to compare

  // aheadBy > 0 → balance below plan (ahead); a small band around 0 is "on plan".
  const ahead = result.aheadBy;
  const onTrack = Math.abs(ahead) < result.monthlyPayment * 0.5;
  const statusLabel = onTrack ? c.paydownOnTrack : ahead > 0 ? c.paydownAhead : c.paydownBehind;
  const statusColor = onTrack ? 'var(--text-2)' : ahead > 0 ? 'var(--positive)' : 'var(--negative)';
  const months = Math.abs(Math.round(result.monthsAhead));

  return (
    <div className={`${card} p-5 md:p-7`}>
      <div className="pb-4 mb-4 border-b border-[var(--border)]">
        <h3 className={sectionLabel}>{c.paydownTitle}</h3>
        <p className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>{c.paydownSub}</p>
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-3 mb-5">
        <div>
          <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>{statusLabel}</div>
          <div className="text-[15px] font-mono font-semibold" style={{ color: statusColor }}>
            {onTrack ? '—' : `${formatCurrency(Math.abs(ahead))}`}
            {!onTrack && months > 0 && (
              <span className="text-[12px] font-normal" style={{ color: 'var(--text-3)' }}> · ≈ {months} {c.paydownMonthsSuffix}</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>{c.paydownPrincipalPaid}</div>
          <div className="text-[15px] font-mono font-semibold" style={{ color: 'var(--text-1)' }}>{formatCurrency(result.principalPaid)}</div>
        </div>
        <div>
          <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>{c.paydownInterestPaid}</div>
          <div className="text-[15px] font-mono font-semibold" style={{ color: 'var(--text-1)' }}>{formatCurrency(result.interestPaid)}</div>
        </div>
      </div>

      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
            <CartesianGrid {...GRID_PROPS} vertical={false} />
            <XAxis dataKey="month" {...AXIS_PROPS} interval="preserveStartEnd" minTickGap={28} />
            <YAxis tickFormatter={formatCurrencyShort} {...AXIS_PROPS_Y} width={52} domain={['auto', 'auto']} />
            <Tooltip content={<ChartTooltip valueFormatter={formatCurrency} labelFormatter={(l) => String(l)} />} />
            <Line name={c.paydownPlan} type="monotone" dataKey="plan" stroke={CHART.rust} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls />
            <Line name={c.paydownActual} type="monotone" dataKey="actual" stroke={CHART.teal} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
