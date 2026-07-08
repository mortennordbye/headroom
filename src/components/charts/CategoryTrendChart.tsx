import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { format, subMonths } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance } from '../../context/FinanceContext';
import ChartTooltip from '../ChartTooltip';
import { CHART, AXIS_PROPS, AXIS_PROPS_Y, GRID_PROPS } from '../../lib/chartColors';
import { CATEGORIES } from '../../lib/categories';
import { monthlyCategoryTotals } from '../../lib/categoryStats';

const MONTHS = 6;

// Stacked monthly spend by category over the last 6 months — shows how each
// category's spend moves over time. Only categories with spend in the window get
// a series, so an all-groceries user doesn't see 11 empty legend entries.
export default function CategoryTrendChart() {
  const { t, lang, currentMonth, visibleBudgetTransactions: dailyTransactions, formatCurrencyShort } = useFinance();
  const dateLocale = lang === 'nb' ? nb : enUS;

  const { data, series } = useMemo(() => {
    const months = Array.from({ length: MONTHS }, (_, i) => format(subMonths(currentMonth, MONTHS - 1 - i), 'yyyy-MM'));
    const rows = monthlyCategoryTotals(dailyTransactions, months);
    const data = rows.map((r) => ({ ...r, label: format(new Date(`${r.month}-01T00:00:00`), 'MMM', { locale: dateLocale }) }));
    // Keep only categories that appear at least once across the window.
    // monthlyCategoryTotals only writes a key when its value > 0, so a numeric
    // value in any row means the category has spend.
    const present = CATEGORIES.filter((c) => rows.some((r) => typeof r[c.key] === 'number'));
    return { data, series: present };
  }, [currentMonth, dailyTransactions, dateLocale]);

  const hasData = data.some((r) => r.total > 0);
  if (!hasData) {
    return <div className="text-[13px]" style={{ color: 'var(--text-2)' }}>{t.noSpendingThisMonth}</div>;
  }

  return (
    <div className="w-full h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
          <CartesianGrid {...GRID_PROPS} vertical={false} />
          <XAxis dataKey="label" {...AXIS_PROPS} />
          <YAxis tickFormatter={formatCurrencyShort} {...AXIS_PROPS_Y} width={44} />
          <Tooltip cursor={{ fill: CHART.track }} content={<ChartTooltip />} />
          {series.map((c, i) => (
            <Bar key={c.key} name={t.categoryLabels[c.key]} dataKey={c.key} stackId="s" fill={c.color} maxBarSize={32}>
              {/* Total spent that month, printed at the top of the stack. */}
              {i === series.length - 1 && (
                <LabelList dataKey="total" position="top" formatter={(v: unknown) => formatCurrencyShort(Number(v) || 0)} style={{ fontSize: 10, fill: CHART.textSoft, fontWeight: 600 }} />
              )}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
