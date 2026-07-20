import { useMemo, useState } from 'react';
import { X, Tag, Tags, Wallet, ArrowLeftRight, ChevronDown, Plus, Info } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { categoryMeta, isCategoryKey } from '../lib/categories';
import { suggestTransferRules, type TransferSignal } from '../lib/transferSuggestions';
import { Card } from './ui/Card';
import { SectionLabel } from './ui/SectionLabel';

/** Anchor the Budget page's suggestion banner links to. */
export const RULES_ANCHOR = 'rules';

type Translations = ReturnType<typeof useFinance>['t'];
const SIGNAL_LABEL = (t: Translations, s: TransferSignal): string => ({
  accountNumber: t.budgetPage.transferSignalAccountNumber,
  toPrefix: t.budgetPage.transferSignalToPrefix,
  roundAmount: t.budgetPage.transferSignalRoundAmount,
  recurring: t.budgetPage.transferSignalRecurring,
}[s]);

// Your custom rules — categorization (merchant/text → category) and display
// names (merchant/text → label) — in one global, collapsible list. Rules are
// created from a transaction ("remember"); this is where they're reviewed and
// removed. Global (not tied to any month) and applied to all transactions, past
// and future.
export function CategoryRules() {
  const {
    t, categoryRules, removeCategoryRule, labelRules, removeLabelRule,
    transferRules, removeTransferRule, addTransferRule, fixedExpenses, setFixedExpenses,
    dailyTransactions, formatCurrency,
  } = useFinance();
  // Opens expanded when linked to from the Budget page's suggestion banner.
  const [open, setOpen] = useState(() => window.location.hash === `#${RULES_ANCHOR}`);
  // Suggestions ranked by how much spend they'd remove; recomputed as rules are
  // added, so an accepted one drops off the list.
  const suggestions = useMemo(
    () => suggestTransferRules(dailyTransactions, transferRules),
    [dailyTransactions, transferRules],
  );
  // Fixed expenses mapped to a specific pattern (e.g. Boliglån → Til:…). Shown
  // here so every custom mapping is visible in one place; delete clears the link.
  const matchExpenses = fixedExpenses.filter((e) => (e.match ?? '').trim());
  const clearExpenseMatch = (id: string) =>
    setFixedExpenses(fixedExpenses.map((e) => (e.id === id ? { ...e, match: undefined } : e)));
  const count = categoryRules.length + labelRules.length + transferRules.length + matchExpenses.length;

  return (
    <Card id={RULES_ANCHOR} padding="lg" className="md:col-span-12">
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
          {suggestions.length > 0 && (
            <div className="mb-5 pb-5 border-b border-[var(--border)]">
              <SectionLabel icon={<ArrowLeftRight />}>{t.budgetPage.transferSuggestTitle}</SectionLabel>
              <p className="text-[12px] mt-1 mb-3" style={{ color: 'var(--text-3)' }}>
                {t.budgetPage.transferSuggestIntro}
              </p>
              <ul className="space-y-2">
                {suggestions.map((s) => (
                  <li key={s.match} className="flex items-center gap-3 text-[13px]">
                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-[var(--text-1)] truncate block">{s.match}</span>
                      <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                        {formatCurrency(s.total)}
                        {' · '}{t.budgetPage.transferSuggestTx.replace('{count}', String(s.txCount))}
                        {' · '}{t.budgetPage.transferSuggestMonths.replace('{count}', String(s.months))}
                        {' · '}{s.signals.map((sig) => SIGNAL_LABEL(t, sig)).join(', ')}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => addTransferRule(s.match)}
                      className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-[6px] text-[12px] transition-colors hover:bg-[var(--surface-2)]"
                      style={{ color: 'var(--accent)' }}
                    >
                      <Plus size={13} />
                      {t.budgetPage.transferSuggestAdd}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="flex items-start gap-1.5 text-[12px] mt-3" style={{ color: 'var(--text-3)' }}>
                <Info size={13} className="shrink-0 mt-px" />
                {t.budgetPage.transferSuggestCaution}
              </p>
            </div>
          )}
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
