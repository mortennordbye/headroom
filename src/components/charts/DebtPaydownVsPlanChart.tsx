import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format, parse } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance } from '../../context/FinanceContext';
import { debtPaydownVsPlan } from '../../lib/debt';
import ChartTooltip from '../ChartTooltip';
import { CHART, AXIS_PROPS, AXIS_PROPS_Y, GRID_PROPS } from '../../lib/chartColors';

/**
 * Non-mortgage debt payoff plan-vs-actual (HISTORY_PLAN §6.4). Actual = each
 * recorded month's non-revolving debt total (solid); plan = the minimums-only
 * payoff curve from the earliest recorded debts (dashed). Derived from snapshots
 * via `debtPaydownVsPlan`. Hidden until ≥2 recorded months exist.
 */
export default function DebtPaydownVsPlanChart() {
  const { t, lang, formatCurrency, formatCurrencyShort, balanceSnapshots } = useFinance();
  const d = t.debt;
  const dateLocale = lang === 'nb' ? nb : enUS;

  const result = useMemo(() => debtPaydownVsPlan(balanceSnapshots), [balanceSnapshots]);

  const data = useMemo(
    () => result.points.map(p => ({
      month: format(parse(p.monthKey, 'yyyy-MM', new Date()), 'MMM yy', { locale: dateLocale }),
      actual: Math.round(p.actual),
      plan: p.plan,
    })),
    [result, dateLocale],
  );

  if (result.points.length < 2) return null;

  const ahead = result.aheadBy;
  // "On plan" band scales with the debt size so tiny rounding noise isn't "behind".
  const scale = Math.max(1000, Math.abs(result.points[0].plan) * 0.01);
  const onTrack = Math.abs(ahead) < scale;
  const statusLabel = onTrack ? d.vsPlanOnTrack : ahead > 0 ? d.vsPlanAhead : d.vsPlanBehind;
  const statusColor = onTrack ? 'var(--text-2)' : ahead > 0 ? 'var(--positive)' : 'var(--negative)';

  return (
    <div className="pt-5 border-t border-[var(--border)] space-y-4">
      <div>
        <h3 className="text-[11px] font-medium uppercase tracking-[0.1em]" style={{ color: 'var(--text-2)' }}>{d.vsPlanTitle}</h3>
        <p className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>{d.vsPlanSub}</p>
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <div>
          <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>{statusLabel}</div>
          <div className="text-[15px] font-mono font-semibold" style={{ color: statusColor }}>
            {onTrack ? '—' : formatCurrency(Math.abs(ahead))}
          </div>
        </div>
        <div>
          <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>{d.vsPlanPaid}</div>
          <div className="text-[15px] font-mono font-semibold" style={{ color: 'var(--text-1)' }}>{formatCurrency(result.principalPaid)}</div>
        </div>
      </div>

      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
            <CartesianGrid {...GRID_PROPS} vertical={false} />
            <XAxis dataKey="month" {...AXIS_PROPS} interval="preserveStartEnd" minTickGap={28} />
            <YAxis tickFormatter={formatCurrencyShort} {...AXIS_PROPS_Y} width={52} domain={['auto', 'auto']} />
            <Tooltip content={<ChartTooltip valueFormatter={formatCurrency} labelFormatter={(l) => String(l)} />} />
            <Line name={d.vsPlanPlan} type="monotone" dataKey="plan" stroke={CHART.rust} strokeWidth={2} strokeDasharray="5 4" dot={false} />
            <Line name={d.vsPlanActual} type="monotone" dataKey="actual" stroke={CHART.teal} strokeWidth={2} dot={{ r: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
