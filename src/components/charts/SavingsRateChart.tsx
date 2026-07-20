import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { format } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance } from '../../context/FinanceContext';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import ChartTooltip from '../ChartTooltip';
import { CHART, AXIS_PROPS, AXIS_PROPS_Y, GRID_PROPS } from '../../lib/chartColors';
import { lastNMonthKeys } from '../../lib/date';
import { targetRateOfIncome, planSavingsRateSeries } from '../../lib/savingsRate';

/**
 * Monthly savings capacity as a rate: the share of income left after the
 * consumption part of the fixed expenses, over the last 12 months, with the
 * user's savings target drawn as a reference line.
 *
 * Plan-only — income, fixed expenses and the savings target. No transactions, so
 * an imported row can never move this line and every month is plotted (there are
 * no "unmeasured" gaps from before a bank was connected).
 */
export default function SavingsRateChart() {
  const {
    t, lang, currentMonth, monthlyIncomes, effectiveIncome, totalFixedExpenses,
    region, grossAnnualIncome, employerCostConfig,
    savingsTargetPercent, savingsContributions,
  } = useFinance();
  const reduced = useReducedMotion();
  const dateLocale = lang === 'nb' ? nb : enUS;

  const data = useMemo(() => {
    const months = lastNMonthKeys(currentMonth, 12);
    const seasonal = region === 'no'
      ? { grossAnnual: grossAnnualIncome, feriepengesatsPct: employerCostConfig.feriepengesatsPct }
      : null;
    // Automated savings transfers are money retained, not spent — subtract only
    // the consumption part of the fixed expenses.
    const spendFixedTotal = totalFixedExpenses - savingsContributions;
    return planSavingsRateSeries(months, monthlyIncomes, Math.round(effectiveIncome), spendFixedTotal, seasonal)
      .map(({ month, rate }) => ({
        label: format(new Date(`${month}-01T00:00:00`), 'MMM', { locale: dateLocale }),
        rate,
      }));
  }, [currentMonth, monthlyIncomes, effectiveIncome, totalFixedExpenses, savingsContributions, dateLocale, region, grossAnnualIncome, employerCostConfig.feriepengesatsPct]);

  // The target is a share of residual; the line is a share of income. Restate it
  // so the reference line and the plotted rate are the same quantity.
  const targetRate = useMemo(
    () => targetRateOfIncome(effectiveIncome, totalFixedExpenses, savingsContributions, savingsTargetPercent),
    [effectiveIncome, totalFixedExpenses, savingsContributions, savingsTargetPercent],
  );

  return (
    <div role="img" aria-label={t.charts.aria.savingsRate} className="w-full h-full">
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
        <CartesianGrid {...GRID_PROPS} vertical={false} />
        <XAxis dataKey="label" {...AXIS_PROPS} />
        <YAxis tickFormatter={(v) => `${v}%`} {...AXIS_PROPS_Y} width={40} />
        <Tooltip content={<ChartTooltip valueFormatter={(v) => `${v.toFixed(1)}%`} />} />
        <ReferenceLine y={targetRate} stroke={CHART.brass} strokeDasharray="4 4" label={{ value: t.charts.target, position: 'insideTopRight', fontSize: 10, fill: CHART.brass }} />
        <Line isAnimationActive={!reduced} name={t.charts.savingsRate} type="monotone" dataKey="rate" stroke={CHART.forestLight} strokeWidth={2} dot={{ r: 2, fill: CHART.forestLight }} />
      </LineChart>
    </ResponsiveContainer>
    </div>
  );
}
