import { useMemo, useState } from 'react';
import { format, subMonths } from 'date-fns';
import { ChevronRight, TrendingUp, TrendingDown, Circle, Wallet, Search, X } from 'lucide-react';
import { useFinance, type DailyTransaction } from '../context/FinanceContext';
import { categoryMeta, isCategoryKey } from '../lib/categories';
import { CHART } from '../lib/chartColors';
import { categoryMoM } from '../lib/categoryStats';
import { txDisplayName } from '../lib/labelRules';
import { buildMatchHaystack } from '../lib/text';
import { DeltaChip } from './ui/DeltaChip';
import { ProgressBar } from './ui/ProgressBar';

// Category dashboard for the selected month: spend per category with icon +
// colour + share bar, a month-over-month chip, and click-to-drill into the
// category's transactions. Reads everything from context (month, transactions).
export function CategoryBreakdown({ onEditTransaction }: { onEditTransaction?: (tx: DailyTransaction) => void } = {}) {
  // Spending analysis honors the Budget page's per-account filter (and drops
  // internal transfers) via visibleBudgetTransactions.
  const { t, currentMonth, visibleBudgetTransactions: dailyTransactions, labelRules, formatCurrency, reconciliation } = useFinance();
  const [open, setOpen] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const monthKey = format(currentMonth, 'yyyy-MM');
  const prevMonthKey = format(subMonths(currentMonth, 1), 'yyyy-MM');

  const rows = useMemo(
    () => categoryMoM(dailyTransactions, monthKey, prevMonthKey).filter((r) => r.current > 0),
    [dailyTransactions, monthKey, prevMonthKey],
  );
  const total = rows.reduce((s, r) => s + r.current, 0);

  const label = (cat: string) => (isCategoryKey(cat) ? t.categoryLabels[cat] : cat);
  const color = (cat: string) => categoryMeta(cat)?.color ?? CHART.textDim;

  const txForCategory = (cat: string) =>
    dailyTransactions
      .filter((tx) => tx.date.slice(0, 7) === monthKey && tx.kind !== 'income' && (tx.category || 'other') === cat)
      .sort((a, b) => b.amount - a.amount);

  // Free-text lookup across every visible transaction (all months, honoring the
  // account filter) so you can find a purchase and see which category it landed
  // in. Same haystack as the ledger search. Newest first, capped so a broad
  // query can't render thousands of rows.
  const SEARCH_LIMIT = 100;
  const query = search.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!query) return [];
    return dailyTransactions
      .filter((tx) => {
        const hay = buildMatchHaystack(tx.merchant, tx.description) +
          txDisplayName(tx, labelRules).toLowerCase() + ' ' + tx.amount;
        return hay.includes(query);
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [dailyTransactions, labelRules, query]);

  const searchBox = (
    <div className="relative">
      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-3)] pointer-events-none" />
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t.budgetPage.searchPlaceholder}
        aria-label={t.budgetPage.searchLabel}
        className="w-full h-8 pl-8 pr-8 rounded-[6px] text-[13px] border"
        style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
      />
      {search && (
        <button
          type="button"
          onClick={() => setSearch('')}
          aria-label={t.budgetPage.searchClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );

  // Search mode: a flat result list, each row tagged with the category it's filed
  // under, click-to-edit so you can re-categorize on the spot.
  if (query) {
    const shown = matches.slice(0, SEARCH_LIMIT);
    return (
      <div className="flex flex-col gap-2.5">
        {searchBox}
        <p className="text-[11px] text-[var(--text-3)]">
          {t.budgetPage.searchResults.replace('{count}', matches.length.toString())}
        </p>
        {shown.length === 0 ? (
          <div className="text-[13px] py-2" style={{ color: 'var(--text-2)' }}>{t.budgetPage.searchNoResults}</div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {shown.map((tx) => {
              const cat = tx.category || 'other';
              const meta = categoryMeta(cat);
              const Icon = meta?.icon ?? Circle;
              return (
                <li key={tx.id}>
                  <button
                    type="button"
                    onClick={onEditTransaction ? () => onEditTransaction(tx) : undefined}
                    disabled={!onEditTransaction}
                    title={onEditTransaction ? t.budgetPage.relabelHint : undefined}
                    className={`w-full flex items-center justify-between gap-2 text-[12.5px] text-left ${onEditTransaction ? 'hover:text-[var(--accent)] transition-colors cursor-pointer' : 'cursor-default'}`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[10px] text-[var(--text-3)] tabular-nums shrink-0">{tx.date.slice(5, 10).replace('-', '.')}</span>
                      <span className="truncate text-[var(--text-1)]">{txDisplayName(tx, labelRules)}</span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-[10px] font-medium"
                        style={{ background: 'var(--bg-raised)', color: 'var(--text-2)' }}
                      >
                        <span className="w-3 h-3 rounded-[3px] grid place-items-center shrink-0" style={{ background: color(cat), color: '#fff' }}>
                          <Icon size={8} />
                        </span>
                        {label(cat)}
                      </span>
                      <span className="font-mono text-[var(--text-2)] tabular-nums">{formatCurrency(tx.amount)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-2.5">
        {searchBox}
        <div className="text-[13px] py-1" style={{ color: 'var(--text-2)' }}>{t.noSpendingThisMonth}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {searchBox}
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
              <ProgressBar pct={pct} heightClass="h-1.5" square trackColor="var(--bg-raised)" color={color(r.category)} className="ml-[27px]" />
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
