import { useMemo } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { format } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance } from '../../context/FinanceContext';
import ChartTooltip from '../ChartTooltip';
import { CHART, AXIS_PROPS, AXIS_PROPS_Y, GRID_PROPS } from '../../lib/chartColors';
import { lastNMonthKeys } from '../../lib/date';
import { monthlyCashflow } from '../../lib/monthlyCashflow';

/**
 * Monthly cashflow for the last 12 months: money in (income) vs money out
 * (fixed expenses + logged expense transactions), with a net-surplus line.
 * Income uses the manual override for a month when set, else the current
 * effective income as an estimate; fixed expenses use the current total for
 * every month (they aren't snapshotted), so past months are approximate.
 */
export default function CashflowChart() {
  const {
    t, lang, currentMonth, monthlyIncomes, effectiveIncome, totalFixedExpenses,
    // Whole-finance cashflow: net out internal transfers, but not per-account (income
    // isn't account-scoped), so use nonTransferTransactions.
    nonTransferTransactions: dailyTransactions, formatCurrencyShort,
  } = useFinance();
  const dateLocale = lang === 'nb' ? nb : enUS;

  const data = useMemo(() => {
    const months = lastNMonthKeys(currentMonth, 12);
    return monthlyCashflow(months, dailyTransactions, monthlyIncomes, Math.round(effectiveIncome), totalFixedExpenses)
      .map(({ month, income, expenses, net }) => ({
        label: format(new Date(`${month}-01T00:00:00`), 'MMM', { locale: dateLocale }),
        income, expenses, net,
      }));
  }, [currentMonth, monthlyIncomes, effectiveIncome, totalFixedExpenses, dailyTransactions, dateLocale]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
        <CartesianGrid {...GRID_PROPS} vertical={false} />
        <XAxis dataKey="label" {...AXIS_PROPS} />
        <YAxis tickFormatter={formatCurrencyShort} {...AXIS_PROPS_Y} width={44} />
        <Tooltip cursor={{ fill: CHART.track }} content={<ChartTooltip />} />
        <ReferenceLine y={0} stroke={CHART.rule} />
        <Bar name={t.charts.income} dataKey="income" fill={CHART.forestLight} radius={[2, 2, 0, 0]} maxBarSize={18} />
        <Bar name={t.charts.expenses} dataKey="expenses" fill={CHART.rust} radius={[2, 2, 0, 0]} maxBarSize={18} />
        <Line name={t.charts.net} dataKey="net" stroke={CHART.brass} strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
