import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useFinance } from '../../context/FinanceContext';
import ChartTooltip from '../ChartTooltip';
import { CHART, AXIS_PROPS, AXIS_PROPS_Y, GRID_PROPS } from '../../lib/chartColors';

interface DebtPayoffChartProps {
  /** Mortgage balance at each year, index 0..N (year 0 = today). */
  balances: number[];
  /** Calendar year of index 0. */
  startYear: number;
  /** Non-mortgage debt today (student/consumer) — shown as a note, not projected here. */
  nonMortgageDebt: number;
}

/**
 * Mortgage balance melting down over the amortization horizon — surfaces the
 * debt-free milestone that the equity/LTV views don't call out. Non-mortgage
 * debts amortize on their own plans (see the Debt section) so they're noted, not
 * folded into this projected line.
 */
export default function DebtPayoffChart({ balances, startYear, nonMortgageDebt }: DebtPayoffChartProps) {
  const { t, formatCurrency, formatCurrencyShort } = useFinance();

  const current = balances[0] ?? 0;
  // First year the balance reaches 0 having been positive → the debt-free year.
  let payoffYear: number | null = null;
  for (let i = 1; i < balances.length; i++) {
    if (balances[i] === 0 && balances[i - 1] > 0) {
      payoffYear = startYear + i;
      break;
    }
  }

  if (current <= 0) {
    return (
      <div className="h-full w-full grid place-items-center text-center text-[12px] px-6" style={{ color: 'var(--text-3)' }}>
        {t.charts.debtFree}
      </div>
    );
  }

  const data = balances.map((debt, i) => ({ year: startYear + i, debt }));

  return (
    <div className="h-full w-full flex flex-col gap-4">
      <div className="flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.1em]" style={{ color: 'var(--text-3)' }}>{t.charts.mortgageToday}</div>
          <div className="font-mono font-semibold text-[var(--text-1)]">{formatCurrency(current)}</div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.1em]" style={{ color: 'var(--text-3)' }}>{t.charts.debtFreeYear}</div>
          <div className="font-mono font-semibold" style={{ color: payoffYear ? 'var(--positive)' : 'var(--text-2)' }}>
            {payoffYear ?? '—'}
          </div>
        </div>
      </div>

      <div role="img" aria-label={t.charts.aria.debtPayoff} className="flex-1 min-h-[180px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
            <defs>
              <linearGradient id="debtGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART.rust} stopOpacity={0.35} />
                <stop offset="100%" stopColor={CHART.rust} stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid {...GRID_PROPS} vertical={false} />
            <XAxis dataKey="year" {...AXIS_PROPS} />
            <YAxis tickFormatter={formatCurrencyShort} {...AXIS_PROPS_Y} width={44} />
            <Tooltip cursor={{ stroke: CHART.rule }} content={<ChartTooltip valueFormatter={(v) => formatCurrency(v)} />} />
            <Area type="monotone" dataKey="debt" name={t.charts.mortgageToday} stroke={CHART.rust} strokeWidth={2} fill="url(#debtGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {nonMortgageDebt > 0 && (
        <p className="text-[11px] shrink-0" style={{ color: 'var(--text-3)' }}>
          {t.charts.plusOtherDebt.replace('{amount}', formatCurrency(nonMortgageDebt))}
        </p>
      )}
    </div>
  );
}
