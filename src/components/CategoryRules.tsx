import { useState } from 'react';
import { X, Tag, Tags, Wallet, ArrowLeftRight, ChevronDown } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { categoryMeta, isCategoryKey } from '../lib/categories';
import { Card } from './ui/Card';
import { SectionLabel } from './ui/SectionLabel';

// Your custom rules — categorization (merchant/text → category) and display
// names (merchant/text → label) — in one global, collapsible list. Rules are
// created from a transaction ("remember"); this is where they're reviewed and
// removed. Global (not tied to any month) and applied to all transactions, past
// and future.
export function CategoryRules() {
  const { t, categoryRules, removeCategoryRule, labelRules, removeLabelRule, transferRules, removeTransferRule, fixedExpenses, setFixedExpenses } = useFinance();
  const [open, setOpen] = useState(false);
  // Fixed expenses mapped to a specific pattern (e.g. Boliglån → Til:…). Shown
  // here so every custom mapping is visible in one place; delete clears the link.
  const matchExpenses = fixedExpenses.filter((e) => (e.match ?? '').trim());
  const clearExpenseMatch = (id: string) =>
    setFixedExpenses(fixedExpenses.map((e) => (e.id === id ? { ...e, match: undefined } : e)));
  const count = categoryRules.length + labelRules.length + transferRules.length + matchExpenses.length;

  return (
    <Card padding="lg" className="md:col-span-12">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <SectionLabel icon={<Tags />}>{t.budgetPage.rulesTitle}</SectionLabel>
        <span className="flex items-center gap-2 text-[13px] shrink-0" style={{ color: 'var(--text-2)' }}>
          {count} {t.budgetPage.rulesCount}
          <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && (
        <div className="mt-4">
          <p className="text-[12px] mb-3" style={{ color: 'var(--text-3)' }}>{t.budgetPage.rulesScope}</p>
          {count === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>{t.budgetPage.rulesEmpty}</p>
          ) : (
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
              {transferRules.map((rule) => (
                <li key={rule.id} className="flex items-center gap-2 text-[13px]">
                  <ArrowLeftRight size={12} className="text-[var(--text-3)] shrink-0" />
                  <span className="font-mono text-[var(--text-1)] truncate">{rule.match}</span>
                  <span className="text-[var(--text-3)]">→</span>
                  <span className="text-[var(--text-2)] truncate">{t.budgetPage.rulesTransferTag}</span>
                  <button
                    aria-label={`${t.budgetPage.deleteRule} — ${rule.match}`}
                    onClick={() => removeTransferRule(rule.id)}
                    className="ml-auto text-[var(--text-2)] hover:text-[var(--negative)] transition-colors shrink-0"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
              {matchExpenses.map((e) => (
                <li key={e.id} className="flex items-center gap-2 text-[13px]">
                  <Wallet size={12} className="text-[var(--accent)] shrink-0" />
                  <span className="font-mono text-[var(--text-1)] truncate">{e.match}</span>
                  <span className="text-[var(--text-3)]">→</span>
                  <span className="text-[var(--text-2)] truncate">{e.name} <span style={{ color: 'var(--text-3)' }}>({t.budgetPage.rulesFixedExpenseTag})</span></span>
                  <button
                    aria-label={`${t.budgetPage.deleteRule} — ${e.name}`}
                    onClick={() => clearExpenseMatch(e.id)}
                    className="ml-auto text-[var(--text-2)] hover:text-[var(--negative)] transition-colors shrink-0"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
