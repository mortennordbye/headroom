import { X, Tag } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { categoryMeta, isCategoryKey } from '../lib/categories';

// Lists the user's rules — categorization (merchant/text → category) and custom
// names (merchant/text → label) — with a delete control. Rules are created from
// the transaction edit modal ("remember"); this is where they're reviewed and
// removed. Hidden entirely when there are none.
export function CategoryRules() {
  const { t, categoryRules, removeCategoryRule, labelRules, removeLabelRule } = useFinance();
  if (categoryRules.length === 0 && labelRules.length === 0) return null;

  return (
    <div className="bg-[var(--bg-card)] rounded-[8px] border border-[var(--border)] p-5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-2)] mb-3">
        {t.budgetPage.rulesTitle}
      </div>
      <ul className="space-y-1.5">
        {categoryRules.map((rule) => {
          const meta = isCategoryKey(rule.category) ? categoryMeta(rule.category) : undefined;
          const label = isCategoryKey(rule.category) ? t.categoryLabels[rule.category] : rule.category;
          return (
            <li key={rule.id} className="flex items-center gap-2 text-[13px]">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: meta?.color ?? 'var(--text-3)' }} />
              <span className="font-mono text-[var(--text-1)] truncate">{rule.match}</span>
              <span className="text-[var(--text-3)]">→</span>
              <span className="text-[var(--text-2)]">{label}</span>
              <button
                aria-label={`${t.budgetPage.deleteRule} — ${rule.match}`}
                onClick={() => removeCategoryRule(rule.id)}
                className="ml-auto text-[var(--text-2)] hover:text-[var(--negative)] transition-colors shrink-0"
              >
                <X size={14} />
              </button>
            </li>
          );
        })}
        {labelRules.map((rule) => (
          <li key={rule.id} className="flex items-center gap-2 text-[13px]">
            <Tag size={12} className="text-[var(--text-3)] shrink-0" />
            <span className="font-mono text-[var(--text-1)] truncate">{rule.match}</span>
            <span className="text-[var(--text-3)]">→</span>
            <span className="text-[var(--text-2)] truncate">{rule.label}</span>
            <button
              aria-label={`${t.budgetPage.deleteRule} — ${rule.match}`}
              onClick={() => removeLabelRule(rule.id)}
              className="ml-auto text-[var(--text-2)] hover:text-[var(--negative)] transition-colors shrink-0"
            >
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
