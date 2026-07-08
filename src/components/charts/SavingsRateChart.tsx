import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { format, subMonths } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance } from '../../context/FinanceContext';
import ChartTooltip from '../ChartTooltip';
import { CHART, AXIS_PROPS, AXIS_PROPS_Y, GRID_PROPS } from '../../lib/chartColors';

/**
 * Monthly savings capacity as a rate: the share of income left after fixed
 * expenses and logged spending, over the last 12 months, with the user's
 * savings target drawn as a reference line.
 */
export default function SavingsRateChart() {
  const {
    t, lang, currentMonth, monthlyIncomes, effectiveIncome, totalFixedExpenses,
    // Whole-finance rate: net out internal transfers, but not per-account (income
    // isn't account-scoped), so use nonTransferTransactions.
    nonTransferTransactions: dailyTransactions, savingsTargetPercent,
  } = useFinance();
  const dateLocale = lang === 'nb' ? nb : enUS;

  const data = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const d = subMonths(currentMonth, 11 - i);
      const key = format(d, 'yyyy-MM');
      const income = monthlyIncomes[key] ?? Math.round(effectiveIncome);
      const variable = dailyTransactions
        .filter(tx => tx.date.startsWith(key) && tx.kind !== 'income')
        .reduce((s, tx) => s + tx.amount, 0);
      const rate = income > 0 ? ((income - totalFixedExpenses - variable) / income) * 100 : 0;
      return { label: format(d, 'MMM', { locale: dateLocale }), rate: Math.round(rate * 10) / 10 };
    });
  }, [currentMonth, monthlyIncomes, effectiveIncome, totalFixedExpenses, dailyTransactions, dateLocale]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
        <CartesianGrid {...GRID_PROPS} vertical={false} />
        <XAxis dataKey="label" {...AXIS_PROPS} />
        <YAxis tickFormatter={(v) => `${v}%`} {...AXIS_PROPS_Y} width={40} />
        <Tooltip content={<ChartTooltip valueFormatter={(v) => `${v.toFixed(1)}%`} />} />
        <ReferenceLine y={savingsTargetPercent} stroke={CHART.brass} strokeDasharray="4 4" label={{ value: t.charts.target, position: 'insideTopRight', fontSize: 10, fill: CHART.brass }} />
        <Line name={t.charts.savingsRate} type="monotone" dataKey="rate" stroke={CHART.forestLight} strokeWidth={2} dot={{ r: 2, fill: CHART.forestLight }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
