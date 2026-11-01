import { useMemo } from 'react';
import {
  ComposedChart, Bar, Rectangle, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend,
  type BarShapeProps,
} from 'recharts';
import { ResponsiveContainer } from './ResponsiveContainer';
import { format } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance } from '../../context/FinanceContext';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import ChartTooltip from '../ChartTooltip';
import { CHART, AXIS_PROPS, AXIS_PROPS_Y, GRID_PROPS } from '../../lib/chartColors';
import { lastNMonthKeys, currentMonthKey } from '../../lib/date';
import { formatAxisInt } from '../../lib/format';
import { monthlyCashflow } from '../../lib/monthlyCashflow';
import { fixedExpensesForMonth } from '../../lib/snapshots';
import { savingsForMonth } from '../../lib/savingsRate';

/**
 * Monthly cashflow for the last 12 months: money in (income) vs money out,
 * split into spending (fixed expenses + logged expense transactions) and what
 * was moved into savings, with a net line for what is left after both. Savings
 * are their own series, not spending: the chart classifies savings the same way
 * as the savings rate.
 * Income uses the manual override for a month when set, else the current
 * effective income as an estimate — reshaped by the June feriepenger spike and
 * December half-trekk for Norwegian salary. Each month's fixed expenses are its
 * recorded snapshot copy when it has one, else the live list, and its savings
 * are that month's own (recorded, adjusted or resolved against its income).
 */
export default function CashflowChart() {
  const {
    t, lang, currentMonth, monthlyIncomes, effectiveIncome, derivedNetMonthlyFor,
    balanceSnapshots, fixedExpenses, savings, savingsTargetPercent, savingsMonthOverrides,
    region, grossAnnualIncome, employerCostConfig,
    // Whole-finance cashflow: net out internal transfers, but not per-account (income
    // isn't account-scoped), so use nonTransferTransactions.
    nonTransferTransactions: dailyTransactions,
  } = useFinance();
  const reduced = useReducedMotion();
  const dateLocale = lang === 'nb' ? nb : enUS;

  const data = useMemo(() => {
    const months = lastNMonthKeys(currentMonth, 12);
    const seasonal = region === 'no'
      ? { grossAnnual: grossAnnualIncome, feriepengesatsPct: employerCostConfig.feriepengesatsPct }
      : null;
    // Savings transfers are their own series, not spending. Reconcile so a
    // budgeted bill isn't counted twice once its real payment is imported. Each
    // month is reconciled against its own fixed expenses and savings, not the
    // viewed month's.
    const nowKey = currentMonthKey();
    const savingsData = { savings, savingsTargetPercent, savingsMonthOverrides, balanceSnapshots, fixedExpenses };
    const fixedFor = (month: string) => fixedExpensesForMonth(balanceSnapshots, fixedExpenses, month, nowKey);
    const totalFor = (month: string) => fixedFor(month).reduce((sum, item) => sum + item.amount, 0);
    const savedFor = (month: string) =>
      savingsForMonth(savingsData, month, nowKey, monthlyIncomes[month] ?? derivedNetMonthlyFor(month));
    return monthlyCashflow(months, dailyTransactions, monthlyIncomes, Math.round(effectiveIncome), totalFor, seasonal, fixedFor, savedFor)
      .map(({ month, income, expenses, saved, net }) => ({
        label: format(new Date(`${month}-01T00:00:00`), 'MMM', { locale: dateLocale }),
        income, expenses, saved, net,
      }));
  }, [currentMonth, monthlyIncomes, effectiveIncome, derivedNetMonthlyFor, savings, savingsTargetPercent, savingsMonthOverrides, balanceSnapshots, fixedExpenses, dailyTransactions, dateLocale, region, grossAnnualIncome, employerCostConfig.feriepengesatsPct]);

  return (
    <div role="img" aria-label={t.charts.aria.cashflow} className="w-full h-full">
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
        <CartesianGrid {...GRID_PROPS} vertical={false} />
        <XAxis dataKey="label" {...AXIS_PROPS} />
        <YAxis tickFormatter={formatAxisInt} {...AXIS_PROPS_Y} width={44} />
        <Tooltip cursor={{ fill: CHART.track }} content={<ChartTooltip />} />
        <ReferenceLine y={0} stroke={CHART.rule} />
        <Bar isAnimationActive={!reduced} name={t.charts.income} dataKey="income" stackId="in" fill={CHART.forestLight} radius={[2, 2, 0, 0]} maxBarSize={18} />
        <Legend wrapperStyle={{ fontSize: 11 }} itemSorter={null} />
        {/* Money out as one stacked column: spending, with savings on top. The
            top segment gets the rounded corners, so spending rounds when nothing was saved. */}
        <Bar
          isAnimationActive={!reduced} name={t.charts.expenses} dataKey="expenses" stackId="out" fill={CHART.rust} maxBarSize={18}
          shape={(props: BarShapeProps) => <Rectangle {...props} radius={props.payload?.saved > 0 ? 0 : [2, 2, 0, 0]} />}
        />
        <Bar isAnimationActive={!reduced} name={t.charts.savings} dataKey="saved" stackId="out" fill={CHART.teal} radius={[2, 2, 0, 0]} maxBarSize={18} />
        <Line isAnimationActive={!reduced} name={t.charts.net} dataKey="net" stroke={CHART.brass} strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
    </div>
  );
}
