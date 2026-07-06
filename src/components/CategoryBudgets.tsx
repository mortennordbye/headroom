import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Pencil, Check } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { CATEGORIES, type CategoryKey } from '../lib/categories';
import { budgetProgress } from '../lib/categoryStats';
import { parseLocaleNumber } from '../lib/validators';
import { SectionLabel } from './ui/SectionLabel';
import { Button } from './ui/Button';

// Per-category monthly budgets: progress bars (actual vs cap) for the selected
// month with over-budget warnings, plus an inline editor to set/clear caps.
export function CategoryBudgets() {
  const { t, currentMonth, dailyTransactions, categoryBudgets, setCategoryBudget, formatCurrency, reconciliation } = useFinance();
  const [editing, setEditing] = useState(false);

  const monthKey = format(currentMonth, 'yyyy-MM');
  // A category with an envelope (a linked fixed expense) is budgeted there; its
  // envelope supersedes a soft cap here, so it drops out of this list to avoid
  // two competing plans for the same category. Any stored cap is kept, not
  // deleted — it reappears if the category is unlinked.
  const enveloped = reconciliation.envelopedCategories;
  const progress = useMemo(
    () => budgetProgress(dailyTransactions, monthKey, categoryBudgets).filter((p) => !enveloped.has(p.category)),
    [dailyTransactions, monthKey, categoryBudgets, enveloped],
  );
  const budgetableCategories = CATEGORIES.filter((c) => c.key !== 'income' && !enveloped.has(c.key));

  const label = (key: CategoryKey) => t.categoryLabels[key];

  return (
    <div>
      <div className="flex items-center justify-between">
        <SectionLabel>{t.categoryBudgets}</SectionLabel>
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={editing ? <Check size={14} /> : <Pencil size={14} />}
          onClick={() => setEditing((e) => !e)}
        >
          {editing ? t.done : t.setBudgets}
        </Button>
      </div>

      {editing ? (
        <div className="mt-4 flex flex-col gap-2.5">
          {enveloped.size > 0 && (
            <p className="text-[11px] leading-snug" style={{ color: 'var(--text-3)' }}>{t.envelopeManagedNote}</p>
          )}
          {budgetableCategories.map((c) => {
            const Icon = c.icon;
            return (
              <label key={c.key} className="flex items-center gap-3 text-[13px]">
                <span className="w-5 h-5 rounded-[5px] grid place-items-center shrink-0" style={{ background: c.color, color: '#fff' }}>
                  <Icon size={12} />
                </span>
                <span className="flex-1 text-[var(--text-1)]">{label(c.key)}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  defaultValue={categoryBudgets[c.key]?.toString() ?? ''}
                  placeholder="0"
                  onBlur={(e) => {
                    const parsed = parseLocaleNumber(e.target.value);
                    setCategoryBudget(c.key, parsed && parsed > 0 ? parsed : null);
                  }}
                  className="w-28 h-9 px-3 rounded-[6px] text-[13px] text-right font-mono border tabular-nums"
                  style={{ background: 'var(--bg-2)', borderColor: 'var(--border)', color: 'var(--text)' }}
                />
              </label>
            );
          })}
        </div>
      ) : progress.length === 0 ? (
        <p className="mt-3 text-[13px]" style={{ color: 'var(--text-2)' }}>{t.noBudgetsSet}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3.5">
          {progress.map((p) => {
            const meta = CATEGORIES.find((c) => c.key === p.category)!;
            const Icon = meta.icon;
            const barPct = Math.min(100, p.pct);
            const remaining = p.budget - p.spent;
            return (
              <div key={p.category} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[12.5px] gap-2">
                  <span className="flex items-center gap-2 text-[var(--text-1)] min-w-0">
                    <span className="w-5 h-5 rounded-[5px] grid place-items-center shrink-0" style={{ background: meta.color, color: '#fff' }}>
                      <Icon size={12} />
                    </span>
                    <span className="truncate">{label(p.category)}</span>
                  </span>
                  <span className="font-mono text-[var(--text-2)] tabular-nums shrink-0">
                    {formatCurrency(p.spent)} / {formatCurrency(p.budget)}
                  </span>
                </div>
                <div className="h-1.5 rounded-[3px] bg-[var(--bg-raised)] overflow-hidden">
                  <div
                    className="h-full rounded-[3px]"
                    style={{ width: `${barPct}%`, background: p.over ? 'var(--negative)' : meta.color }}
                  />
                </div>
                <div className="text-[11px] tabular-nums" style={{ color: p.over ? 'var(--negative)' : 'var(--text-3)' }}>
                  {p.over
                    ? `${t.overBudgetBy} ${formatCurrency(p.spent - p.budget)}`
                    : `${formatCurrency(remaining)} ${t.remainingLabel.toLowerCase()}`}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
