import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import { subMonths, format } from 'date-fns';
import { useFinance } from '../context/FinanceContext';
import { topSpendInsight } from '../lib/insights';
import { isCategoryKey } from '../lib/categories';
import { Card } from './ui/Card';

// A single auto-generated spending headline (e.g. "You spent 14% less on
// groceries this month than the 6-month average"). Hidden when there's nothing
// notable to say. Text is assembled from the translations table — no lang branch.
export default function InsightBanner() {
  const { dailyTransactions, currentMonth, t, formatCurrency } = useFinance();

  const insight = useMemo(() => {
    const monthKey = format(currentMonth, 'yyyy-MM');
    const prior = Array.from({ length: 6 }, (_, i) => format(subMonths(currentMonth, i + 1), 'yyyy-MM'));
    return topSpendInsight(dailyTransactions, monthKey, prior);
  }, [dailyTransactions, currentMonth]);

  if (!insight) return null;

  const catLabel = insight.category && isCategoryKey(insight.category)
    ? t.categoryLabels[insight.category]
    : insight.category ?? '';
  const dir = insight.direction === 'more' ? t.insightMore : t.insightLess;

  let text: string;
  if (insight.kind === 'category-delta') {
    text = t.insightCategory.replace('{pct}', String(insight.pct)).replace('{dir}', dir).replace('{cat}', catLabel);
  } else if (insight.kind === 'total-delta') {
    text = t.insightTotal.replace('{pct}', String(insight.pct)).replace('{dir}', dir);
  } else {
    text = t.insightTop.replace('{cat}', catLabel).replace('{amount}', formatCurrency(insight.amount));
  }

  return (
    <Card padding="md" className="md:col-span-12 flex items-center gap-3">
      <span
        className="shrink-0 grid place-items-center w-8 h-8 rounded-full"
        style={{ background: 'color-mix(in srgb, var(--accent) 16%, transparent)', color: 'var(--accent)' }}
      >
        <Sparkles size={16} />
      </span>
      <p className="text-[14px] leading-snug" style={{ color: 'var(--text-1)' }}>{text}</p>
    </Card>
  );
}
