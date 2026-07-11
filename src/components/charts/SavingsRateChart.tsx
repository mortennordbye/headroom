import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { format } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance } from '../../context/FinanceContext';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import ChartTooltip from '../ChartTooltip';
import { CHART, AXIS_PROPS, AXIS_PROPS_Y, GRID_PROPS } from '../../lib/chartColors';
import { lastNMonthKeys } from '../../lib/date';
import { monthlyCashflow } from '../../lib/monthlyCashflow';

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
  const reduced = useReducedMotion();
  const dateLocale = lang === 'nb' ? nb : enUS;

  const data = useMemo(() => {
    const months = lastNMonthKeys(currentMonth, 12);
    return monthlyCashflow(months, dailyTransactions, monthlyIncomes, Math.round(effectiveIncome), totalFixedExpenses)
      .map(({ month, rate }) => ({
        label: format(new Date(`${month}-01T00:00:00`), 'MMM', { locale: dateLocale }),
        rate,
      }));
  }, [currentMonth, monthlyIncomes, effectiveIncome, totalFixedExpenses, dailyTransactions, dateLocale]);

  return (
    <div role="img" aria-label={t.charts.aria.savingsRate} className="w-full h-full">
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
        <CartesianGrid {...GRID_PROPS} vertical={false} />
        <XAxis dataKey="label" {...AXIS_PROPS} />
        <YAxis tickFormatter={(v) => `${v}%`} {...AXIS_PROPS_Y} width={40} />
        <Tooltip content={<ChartTooltip valueFormatter={(v) => `${v.toFixed(1)}%`} />} />
        <ReferenceLine y={savingsTargetPercent} stroke={CHART.brass} strokeDasharray="4 4" label={{ value: t.charts.target, position: 'insideTopRight', fontSize: 10, fill: CHART.brass }} />
        <Line isAnimationActive={!reduced} name={t.charts.savingsRate} type="monotone" dataKey="rate" stroke={CHART.forestLight} strokeWidth={2} dot={{ r: 2, fill: CHART.forestLight }} />
      </LineChart>
    </ResponsiveContainer>
    </div>
  );
}
