import { useMemo } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { format, subMonths } from 'date-fns';
import { useFinance } from '../../context/FinanceContext';
import ChartTooltip from '../ChartTooltip';
import { CHART } from '../../lib/chartColors';

/**
 * Monthly cashflow for the last 12 months: money in (income) vs money out
 * (fixed expenses + logged expense transactions), with a net-surplus line.
 * Income uses the manual override for a month when set, else the current
 * effective income as an estimate; fixed expenses use the current total for
 * every month (they aren't snapshotted), so past months are approximate.
 */
export default function CashflowChart() {
  const {
    t, currentMonth, monthlyIncomes, effectiveIncome, totalFixedExpenses,
    // Whole-finance cashflow: net out internal transfers, but not per-account (income
    // isn't account-scoped), so use nonTransferTransactions.
    nonTransferTransactions: dailyTransactions, formatCurrencyShort,
  } = useFinance();

  const data = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const d = subMonths(currentMonth, 11 - i);
      const key = format(d, 'yyyy-MM');
      const income = monthlyIncomes[key] ?? Math.round(effectiveIncome);
      const variable = dailyTransactions
        .filter(tx => tx.date.startsWith(key) && tx.kind !== 'income')
        .reduce((s, tx) => s + tx.amount, 0);
      const expenses = totalFixedExpenses + variable;
      return { label: format(d, 'MMM'), income, expenses, net: income - expenses };
    });
  }, [currentMonth, monthlyIncomes, effectiveIncome, totalFixedExpenses, dailyTransactions]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART.grid} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART.textSoft }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={formatCurrencyShort} tick={{ fontSize: 10, fill: CHART.textDim }} axisLine={false} tickLine={false} width={44} />
        <Tooltip cursor={{ fill: CHART.track }} content={<ChartTooltip />} />
        <ReferenceLine y={0} stroke={CHART.rule} />
        <Bar name={t.charts.income} dataKey="income" fill={CHART.forestLight} radius={[2, 2, 0, 0]} maxBarSize={18} />
        <Bar name={t.charts.expenses} dataKey="expenses" fill={CHART.rust} radius={[2, 2, 0, 0]} maxBarSize={18} />
        <Line name={t.charts.net} dataKey="net" stroke={CHART.brass} strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
