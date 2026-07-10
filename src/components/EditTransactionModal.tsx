import { useState } from 'react';
import EditModal, { type ModalField } from './EditModal';
import { useFinance, type DailyTransaction } from '../context/FinanceContext';
import { parseLocaleNumber } from '../lib/validators';
import { isCategoryKey, CATEGORIES, type CategoryKey } from '../lib/categories';

/**
 * The single transaction editor, shared by the Budget ledger and the Dashboard
 * recent-transactions list. Beyond description/amount/category/kind it carries
 * the "map to fixed expense" link and the "remember rule" back-fix, so editing a
 * row from anywhere behaves identically. Reads everything it needs from context;
 * the caller only supplies the transaction and a close handler.
 */
export default function EditTransactionModal({ tx, onClose }: { tx: DailyTransaction; onClose: () => void }) {
  const {
    t, fixedExpenses, setFixedExpenses, dailyTransactions, setDailyTransactions,
    addCategoryRule, addLabelRule,
  } = useFinance();
  const [error, setError] = useState<string | undefined>();

  const { id, description, amount, category, kind, merchant } = tx;

  const categoryOptions = [
    { value: '', label: t.uncategorized },
    ...CATEGORIES.filter(c => c.key !== 'income').map(c => ({ value: c.key, label: t.categoryLabels[c.key] })),
  ];

  // A fixed expense already mapped to this transaction (by its match pattern),
  // so the "Map to fixed expense" select can pre-select it.
  const hay = ` ${merchant ?? ''} ${description ?? ''} `.toLowerCase();
  const prevMapped = fixedExpenses.find(e => (e.match ?? '').trim() && hay.includes((e.match as string).trim().toLowerCase()));
  const expenseOptions = [
    { value: '', label: t.budgetPage.mapToFixedExpenseNone },
    ...fixedExpenses.map(e => ({ value: e.id, label: e.name })),
  ];

  const fields: ModalField[] = [
    { key: 'description', label: t.editDescription, type: 'text', value: description },
    { key: 'amount', label: t.editAmount, type: 'number', value: amount.toString() },
    { key: 'category', label: t.category, type: 'select', value: category ?? '', options: categoryOptions },
    { key: 'kind', label: t.txKind, type: 'select', value: kind === 'income' ? 'income' : 'expense', options: [
      { value: 'expense', label: t.txExpense },
      { value: 'income', label: t.txIncome },
    ] },
    { key: 'mapExpense', label: t.budgetPage.mapToFixedExpense, type: 'select', value: prevMapped?.id ?? '', options: expenseOptions, hint: t.budgetPage.mapToFixedExpenseHint },
    { key: 'rememberRule', label: t.budgetPage.rememberRule, type: 'checkbox', value: 'false', hint: t.budgetPage.rememberRuleHint },
    { key: 'ruleMatch', label: t.budgetPage.ruleMatch, type: 'text', value: merchant || description },
  ];

  const onSave = (vals: Record<string, string>) => {
    const newAmount = parseLocaleNumber(vals.amount);
    if (!vals.description.trim() || isNaN(newAmount) || newAmount < 0) {
      setError(!vals.description.trim() ? t.editDescription + t.validation.requiredSuffix : t.editAmount + t.validation.positiveAmountSuffix);
      return;
    }
    setDailyTransactions(dailyTransactions.map(x => x.id === id
      ? { ...x, description: vals.description.trim(), amount: newAmount, category: vals.category.trim() || undefined, categorySource: vals.category.trim() ? 'manual' : undefined, kind: vals.kind === 'income' ? 'income' : 'expense' }
      : x
    ));
    // Remember: create rules so matching rows (past + future) inherit only what
    // you actually changed here — the category and/or the custom name.
    if (vals.rememberRule === 'true' && vals.ruleMatch.trim()) {
      const newCat = vals.category.trim();
      if (isCategoryKey(newCat) && newCat !== (category ?? '')) addCategoryRule(vals.ruleMatch.trim(), newCat as CategoryKey);
      const newName = vals.description.trim();
      if (newName && newName !== description) addLabelRule(vals.ruleMatch.trim(), newName);
    }
    // Map to a fixed expense: set the chosen expense's match pattern (and clear a
    // previous mapping) so only these transactions draw it down.
    const newMap = vals.mapExpense;
    const prevMap = prevMapped?.id ?? '';
    if (newMap !== prevMap && vals.ruleMatch.trim()) {
      const pattern = vals.ruleMatch.trim();
      setFixedExpenses(fixedExpenses.map(e => {
        if (e.id === newMap) return { ...e, match: pattern };
        if (e.id === prevMap) return { ...e, match: undefined };
        return e;
      }));
    }
    onClose();
  };

  return <EditModal title={description} fields={fields} error={error} onSave={onSave} onCancel={onClose} />;
}
