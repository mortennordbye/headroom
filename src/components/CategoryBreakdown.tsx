import { useMemo, useState } from 'react';
import { format, subMonths } from 'date-fns';
import { ChevronRight, TrendingUp, TrendingDown, Circle, Wallet } from 'lucide-react';
import { useFinance, type DailyTransaction } from '../context/FinanceContext';
import { categoryMeta, isCategoryKey } from '../lib/categories';
import { categoryMoM } from '../lib/categoryStats';
import { txDisplayName } from '../lib/labelRules';
import { DeltaChip } from './ui/DeltaChip';

// Category dashboard for the selected month: spend per category with icon +
// colour + share bar, a month-over-month chip, and click-to-drill into the
// category's transactions. Reads everything from context (month, transactions).
export function CategoryBreakdown({ onEditTransaction }: { onEditTransaction?: (tx: DailyTransaction) => void } = {}) {
  // Spending analysis honors the Budget page's per-account filter (and drops
  // internal transfers) via visibleBudgetTransactions.
  const { t, currentMonth, visibleBudgetTransactions: dailyTransactions, labelRules, formatCurrency, reconciliation } = useFinance();
  const [open, setOpen] = useState<string | null>(null);

  const monthKey = format(currentMonth, 'yyyy-MM');
  const prevMonthKey = format(subMonths(currentMonth, 1), 'yyyy-MM');

  const rows = useMemo(
    () => categoryMoM(dailyTransactions, monthKey, prevMonthKey).filter((r) => r.current > 0),
    [dailyTransactions, monthKey, prevMonthKey],
  );
  const total = rows.reduce((s, r) => s + r.current, 0);

  const label = (cat: string) => (isCategoryKey(cat) ? t.categoryLabels[cat] : cat);
  const color = (cat: string) => categoryMeta(cat)?.color ?? '#5F6555';

  const txForCategory = (cat: string) =>
    dailyTransactions
      .filter((tx) => tx.date.slice(0, 7) === monthKey && tx.kind !== 'income' && (tx.category || 'other') === cat)
      .sort((a, b) => b.amount - a.amount);

  if (rows.length === 0) {
    return <div className="text-[13px]" style={{ color: 'var(--text-2)' }}>{t.noSpendingThisMonth}</div>;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r) => {
        const meta = categoryMeta(r.category);
        const Icon = meta?.icon ?? Circle;
        const pct = total > 0 ? (r.current / total) * 100 : 0;
        const isOpen = open === r.category;
        return (
          <div key={r.category}>
            <button
              onClick={() => setOpen(isOpen ? null : r.category)}
              className="w-full flex flex-col gap-1.5 text-left"
              aria-expanded={isOpen}
            >
              <div className="flex items-center justify-between text-[12.5px] gap-2">
                <span className="flex items-center gap-2 text-[var(--text-1)] min-w-0">
                  <ChevronRight
                    size={13}
                    className="shrink-0 transition-transform"
                    style={{ color: 'var(--text-3)', transform: isOpen ? 'rotate(90deg)' : 'none' }}
                  />
                  <span
                    className="w-5 h-5 rounded-[5px] grid place-items-center shrink-0"
                    style={{ background: color(r.category), color: '#fff' }}
                  >
                    <Icon size={12} />
                  </span>
                  <span className="truncate">{label(r.category)}</span>
                  {isCategoryKey(r.category) && reconciliation.envelopedCategories.has(r.category) && (
                    <span className="shrink-0 text-[var(--text-3)] inline-flex" title={t.envelopeTracked} aria-label={t.envelopeTracked}>
                      <Wallet size={12} aria-hidden />
                    </span>
                  )}
                  {r.pct !== null && (
                    <DeltaChip
                      size="sm"
                      tone={r.pct > 0 ? 'negative' : r.pct < 0 ? 'positive' : 'muted'}
                      icon={r.pct > 0 ? <TrendingUp /> : r.pct < 0 ? <TrendingDown /> : undefined}
                    >
                      {`${r.pct > 0 ? '+' : ''}${Math.round(r.pct)}%`}
                    </DeltaChip>
                  )}
                  {r.pct === null && (
                    <DeltaChip size="sm" tone="muted">{t.newThisMonth}</DeltaChip>
                  )}
                </span>
                <span className="font-mono text-[var(--text-2)] tabular-nums shrink-0">{formatCurrency(r.current)}</span>
              </div>
              <div className="h-1.5 rounded-[3px] bg-[var(--bg-raised)] overflow-hidden ml-[27px]">
                <div className="h-full rounded-[3px]" style={{ width: `${pct}%`, background: color(r.category) }} />
              </div>
            </button>

            {isOpen && (
              <ul className="mt-2 mb-1 ml-[27px] flex flex-col gap-1">
                {txForCategory(r.category).map((tx) => (
                  <li key={tx.id} className="flex items-center justify-between text-[12px]" style={{ color: 'var(--text-2)' }}>
                    <button
                      type="button"
                      onClick={onEditTransaction ? () => onEditTransaction(tx) : undefined}
                      disabled={!onEditTransaction}
                      title={onEditTransaction ? t.budgetPage.relabelHint : undefined}
                      className={`truncate flex items-center gap-2 text-left ${onEditTransaction ? 'hover:text-[var(--accent)] transition-colors cursor-pointer' : 'cursor-default'}`}
                    >
                      <span className="font-mono text-[10px] text-[var(--text-3)] tabular-nums">{tx.date.slice(8, 10)}.</span>
                      <span className="truncate text-[var(--text-1)]">{txDisplayName(tx, labelRules)}</span>
                    </button>
                    <span className="font-mono tabular-nums shrink-0">{formatCurrency(tx.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
