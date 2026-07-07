import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format, subMonths } from 'date-fns';
import { useFinance } from '../../context/FinanceContext';
import ChartTooltip from '../ChartTooltip';
import { CHART } from '../../lib/chartColors';
import { CATEGORIES } from '../../lib/categories';
import { monthlyCategoryTotals } from '../../lib/categoryStats';

const MONTHS = 6;

// Stacked monthly spend by category over the last 6 months — shows how each
// category's spend moves over time. Only categories with spend in the window get
// a series, so an all-groceries user doesn't see 11 empty legend entries.
export default function CategoryTrendChart() {
  const { t, currentMonth, visibleBudgetTransactions: dailyTransactions, formatCurrencyShort } = useFinance();

  const { data, series } = useMemo(() => {
    const months = Array.from({ length: MONTHS }, (_, i) => format(subMonths(currentMonth, MONTHS - 1 - i), 'yyyy-MM'));
    const rows = monthlyCategoryTotals(dailyTransactions, months);
    const data = rows.map((r) => ({ ...r, label: format(new Date(`${r.month}-01T00:00:00`), 'MMM') }));
    // Keep only categories that appear at least once across the window.
    // monthlyCategoryTotals only writes a key when its value > 0, so a numeric
    // value in any row means the category has spend.
    const present = CATEGORIES.filter((c) => rows.some((r) => typeof r[c.key] === 'number'));
    return { data, series: present };
  }, [currentMonth, dailyTransactions]);

  const hasData = data.some((r) => r.total > 0);
  if (!hasData) {
    return <div className="text-[13px]" style={{ color: 'var(--text-2)' }}>{t.noSpendingThisMonth}</div>;
  }

  return (
    <div className="w-full h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART.grid} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART.textSoft }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={formatCurrencyShort} tick={{ fontSize: 10, fill: CHART.textDim }} axisLine={false} tickLine={false} width={44} />
          <Tooltip cursor={{ fill: CHART.track }} content={<ChartTooltip />} />
          {series.map((c) => (
            <Bar key={c.key} name={t.categoryLabels[c.key]} dataKey={c.key} stackId="s" fill={c.color} maxBarSize={32} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
