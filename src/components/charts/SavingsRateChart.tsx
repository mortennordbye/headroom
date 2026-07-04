import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { format, subMonths } from 'date-fns';
import { useFinance } from '../../context/FinanceContext';
import ChartTooltip from '../ChartTooltip';
import { CHART } from '../../lib/chartColors';

/**
 * Monthly savings capacity as a rate: the share of income left after fixed
 * expenses and logged spending, over the last 12 months, with the user's
 * savings target drawn as a reference line.
 */
export default function SavingsRateChart() {
  const {
    t, currentMonth, monthlyIncomes, effectiveIncome, totalFixedExpenses,
    dailyTransactions, savingsTargetPercent,
  } = useFinance();

  const data = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const d = subMonths(currentMonth, 11 - i);
      const key = format(d, 'yyyy-MM');
      const income = monthlyIncomes[key] ?? Math.round(effectiveIncome);
      const variable = dailyTransactions
        .filter(tx => tx.date.startsWith(key) && tx.kind !== 'income')
        .reduce((s, tx) => s + tx.amount, 0);
      const rate = income > 0 ? ((income - totalFixedExpenses - variable) / income) * 100 : 0;
      return { label: format(d, 'MMM'), rate: Math.round(rate * 10) / 10 };
    });
  }, [currentMonth, monthlyIncomes, effectiveIncome, totalFixedExpenses, dailyTransactions]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART.grid} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART.textSoft }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10, fill: CHART.textDim }} axisLine={false} tickLine={false} width={40} />
        <Tooltip content={<ChartTooltip valueFormatter={(v) => `${v.toFixed(1)}%`} />} />
        <ReferenceLine y={savingsTargetPercent} stroke={CHART.brass} strokeDasharray="4 4" label={{ value: t.charts.target, position: 'insideTopRight', fontSize: 10, fill: CHART.brass }} />
        <Line name={t.charts.savingsRate} type="monotone" dataKey="rate" stroke={CHART.forestLight} strokeWidth={2} dot={{ r: 2, fill: CHART.forestLight }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
