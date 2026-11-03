import { useMemo, useState } from 'react';
import { useFinance } from '../context/FinanceContext';
import type { ExpenseType, FixedExpense } from '../context/FinanceContext';
import { calcExpenseDistribution, formatShare } from '../lib/expenseDistribution';
import { ProgressBar } from './ui';

interface Props {
  expenses: FixedExpense[];
  expenseColor: (type?: ExpenseType) => string;
}

const TRACK = 'var(--surface-5)';

/**
 * How the fixed expenses add up: the split by type, then each row ranked with a
 * bar as long as its true share of the total. Plain rows rather than a chart, so
 * a long name wraps, an amount of any size stays whole, and the card fits a phone.
 */
export default function BudgetDistributionChart({ expenses, expenseColor }: Props) {
  const { t, lang, formatCurrencyShort } = useFinance();
  const [expanded, setExpanded] = useState(false);
  const d = useMemo(() => calcExpenseDistribution(expenses), [expenses]);
  const copy = t.budgetPage.distribution;

  if (d.rows.length === 0) {
    return <p className="py-8 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>{copy.empty}</p>;
  }

  const locale = lang === 'nb' ? 'nb-NO' : 'en-US';
  // With nothing to divide by, a dash says "no share" where 0 % would read as a figure.
  const share = (value: number) => (d.total > 0 ? formatShare(value, locale) : '–');
  const canFold = d.hiddenRows.length > 0;
  const rows = expanded ? d.rows : d.visibleRows;

  const figures = (amount: number, value: number) => (
    <>
      <span className="shrink-0 whitespace-nowrap font-mono tabular-nums text-[13px] font-medium text-[var(--text-1)]">
        {formatCurrencyShort(amount)}
      </span>
      <span className="shrink-0 w-[4.6em] whitespace-nowrap text-right font-mono tabular-nums text-[11px]" style={{ color: 'var(--text-3)' }}>
        {share(value)}
      </span>
    </>
  );

  return (
    <div className="flex flex-col gap-5">
      {d.total > 0 && (
        <div className="flex flex-col gap-3 pb-5 border-b border-[var(--border)]">
          <div className="flex gap-0.5 h-3 rounded-[3px] overflow-hidden" aria-hidden="true">
            {d.types.map(({ type, total }) => (
              <div key={type} style={{ flex: `${total} 1 0`, minWidth: 3, background: expenseColor(type) }} />
            ))}
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(118px,1fr))] gap-x-4 gap-y-2.5">
            {d.types.map(({ type, total, share: typeShare }) => (
              <div key={type} className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-2)' }}>
                  <span className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: expenseColor(type) }} />
                  {t.expenseType[type]}
                </div>
                <div className="flex flex-wrap items-baseline gap-x-1.5 font-mono tabular-nums">
                  <span className="whitespace-nowrap text-[13px] font-medium text-[var(--text-1)]">{formatCurrencyShort(total)}</span>
                  <span className="whitespace-nowrap text-[11px]" style={{ color: 'var(--text-3)' }}>{share(typeShare)}</span>
                </div>
              </div>
            ))}
          </div>
          {d.topThreeShare !== null && (
            <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
              {copy.topThree.replace('{share}', () => share(d.topThreeShare as number))}
            </p>
          )}
        </div>
      )}

      <ul className="flex flex-col gap-3.5">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-3">
              <span
                className="flex-1 min-w-0 line-clamp-2 [overflow-wrap:anywhere] text-[13px] leading-[1.3] text-[var(--text-1)]"
                title={row.name}
              >
                {row.name}
              </span>
              {figures(row.amount, row.share)}
            </div>
            <ProgressBar pct={row.share * 100} color={expenseColor(row.type)} heightClass="h-1.5" trackColor={TRACK} minFillPx={2} />
          </li>
        ))}
        {canFold && !expanded && (
          <li>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-expanded={false}
              className="w-full flex flex-col gap-1.5 text-left rounded-[4px] group"
            >
              <span className="w-full flex items-baseline gap-3">
                <span className="flex-1 min-w-0 text-[13px] leading-[1.3]" style={{ color: 'var(--text-2)' }}>
                  {copy.otherRows.replace('{count}', String(d.hiddenRows.length))}
                  <span className="ml-1.5 whitespace-nowrap text-[var(--accent)] group-hover:opacity-70 transition-opacity">{copy.showAll}</span>
                </span>
                {figures(d.hiddenTotal, d.hiddenShare)}
              </span>
              <ProgressBar pct={d.hiddenShare * 100} color="var(--text-3)" heightClass="h-1.5" trackColor={TRACK} minFillPx={2} className="w-full" />
            </button>
          </li>
        )}
      </ul>

      {canFold && expanded && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-expanded={true}
          className="self-start rounded-[4px] text-[12px] text-[var(--accent)] hover:opacity-70 transition-opacity"
        >
          {copy.showFewer}
        </button>
      )}
    </div>
  );
}
