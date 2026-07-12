import React, { useState, useMemo, useRef, useEffect, lazy, Suspense } from 'react';
import {
  PlusCircle,
  Trash2,
  Edit2,
  Download,
  FileUp,
  ChevronDown,
  Info,
  Wallet,
  X,
  ArrowLeftRight,
  Search,
  CheckSquare,
  Square,
  ListChecks,
  Repeat,
  TrendingDown,
} from 'lucide-react';
import SmartRecommendations from '../components/SmartRecommendations';
import { AccountBadge } from '../components/AccountBadge';
import { accountGroupKey } from '../lib/account';
import { txDisplayName } from '../lib/labelRules';
import { buildMatchHaystack } from '../lib/text';
import FunBudget from '../components/FunBudget';
import PayslipImportModal from '../components/PayslipImportModal';
import { format, isSameMonth, startOfMonth } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance, type TransactionTemplate, type ExpenseType, type DailyTransaction, type FixedExpense } from '../context/FinanceContext';
import EditModal, { type ModalField } from '../components/EditModal';
import ExpenseDialog from '../components/ExpenseDialog';
import EditTransactionModal from '../components/EditTransactionModal';
import { parseLocaleNumber } from '../lib/validators';
import { categoryMeta, isCategoryKey, CATEGORIES, type CategoryKey } from '../lib/categories';
import { suggestEnvelopeLinks, envelopeKeyForTx, type Envelope, type EnvelopeStatus } from '../lib/envelopes';
import { detectRecurring, type RecurringSuggestion } from '../lib/recurring';
import { monthlyCashflow } from '../lib/monthlyCashflow';
import { savingsRateStatus } from '../lib/savingsRate';
import { lastNMonthKeys, isBeforePayday } from '../lib/date';
import { sumLedgerSpent } from '../lib/spentTotals';
import { formatSignedPct } from '../lib/format';
import { incomeDiffPct } from '../lib/income';
import { CHART } from '../lib/chartColors';
import { CategoryBreakdown } from '../components/CategoryBreakdown';
import { ProgressBar } from '../components/ui/ProgressBar';
import { ChartSkeleton } from '../components/ui/Skeleton';
import CategoryTrendChart from '../components/charts/CategoryTrendChart';
import { CategoryBudgets } from '../components/CategoryBudgets';
import { MonthlyAccountSpend } from '../components/MonthlyAccountSpend';
import ConfirmModal from '../components/ConfirmModal';
import { UndoToast } from '../components/ui/UndoToast';
import { StatCard } from '../components/ui/StatCard';

// Recharts (~150 KB gz) is lazy-loaded so it stays off the first-paint critical
// path of the default (Budget) route; it's precached after the first visit.
const BudgetDistributionChart = lazy(() => import('../components/BudgetDistributionChart'));
const SavingsRateChart = lazy(() => import('../components/charts/SavingsRateChart'));
const SpendingHeatmap = lazy(() => import('../components/charts/SpendingHeatmap'));

// Old-money category roles, sourced from the shared CHART token mirror (recharts
// sets these as SVG attributes, which do not resolve CSS var()). Restricted to
// the 4 category hues + neutrals; no brass (reserved) and no decorative rainbow.
const CHART_COLORS = [
  CHART.teal,
  CHART.slate,
  CHART.forest,
  CHART.rust,
  CHART.forestLight,
  CHART.textDim, // → "Annet"
];
// Fixed-expense type → role colour (matches the reference legend).
const EXPENSE_TYPE_COLOR: Record<ExpenseType, string> = {
  fixed: CHART.teal,        // recurring/structural
  variable: CHART.forest,   // variable spend
  subscription: CHART.slate, // subscriptions
  insurance: CHART.rust,    // insurance
};
const expenseColor = (type?: ExpenseType) => EXPENSE_TYPE_COLOR[type ?? 'fixed'];

const card = 'bg-[var(--bg-card)] rounded-[8px] border border-[var(--border)]';
const sectionLabel = 'text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-2)] font-semibold';

// Envelope draw-down status → colour token (under = healthy, near = caution, over = alert).
const ENVELOPE_STATUS_COLOR: Record<EnvelopeStatus, string> = {
  under: 'var(--accent)',
  near: 'var(--warning)',
  over: 'var(--negative)',
};

// Slim actual-vs-budgeted meter shown under a linked fixed expense: how much of
// the envelope real spending has drawn down, and what's left (or overspent).
function EnvelopeBar({ envelope, formatCurrency, labels }: {
  envelope: Envelope;
  formatCurrency: (n: number) => string;
  labels: { left: string; over: string };
}) {
  const color = ENVELOPE_STATUS_COLOR[envelope.status];
  const pct = envelope.budgeted > 0 ? Math.min(100, (envelope.actual / envelope.budgeted) * 100) : 0;
  return (
    <div className="mt-2 pl-[15px] space-y-1">
      <ProgressBar pct={pct} heightClass="h-[3px]" color={color} />
      <div className="flex items-center justify-between text-[11px] font-mono text-[var(--text-2)]">
        <span>{formatCurrency(envelope.actual)} / {formatCurrency(envelope.budgeted)}</span>
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold"
          style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}
        >
          {envelope.overspent > 0
            ? `${formatCurrency(envelope.overspent)} ${labels.over}`
            : `${formatCurrency(envelope.remaining)} ${labels.left}`}
        </span>
      </div>
    </div>
  );
}

function getCategoryColor(category: string): string {
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = ((hash << 5) - hash) + category.charCodeAt(i);
    hash |= 0;
  }
  return CHART_COLORS[Math.abs(hash) % CHART_COLORS.length];
}

// Colour for a category value: the canonical taxonomy colour for known keys,
// else the hash-derived fallback for legacy/custom free-text labels.
function catColor(category: string): string {
  return categoryMeta(category)?.color ?? getCategoryColor(category);
}

interface ModalConfig {
  title: string;
  fields: ModalField[];
  onSave: (values: Record<string, string>) => void;
  error?: string;
  header?: React.ReactNode;
}

// Session-local memory of the last category/kind used when adding a transaction,
// so repeated manual entries don't reset to a blank expense every time. Module
// scope keeps it across route changes within a session; intentionally not
// persisted (resets on reload).
let lastAddDefaults: { category: string; kind: 'income' | 'expense' } = { category: '', kind: 'expense' };

interface PendingDelete {
  type: 'expense';
  id: string;
  name: string;
}

const BudgetPage: React.FC = () => {
  const {
    t,
    lang,
    currentMonth,
    monthlyIncomes,
    payslips,
    setPayslip,
    removePayslip,
    setMonthlyIncomeForMonth,
    setCurrentMonth,
    clearMonthlyIncomeForMonth,
    derivedMonthlyIncome,
    isMonthlyIncomeOverridden,
    effectiveIncome,
    averageIncome,
    incomeReminderDismissedMonth,
    dismissIncomeReminder,
    monthlyBudget,
    dailyBudget,
    totalFixedExpenses,
    fixedExpenses,
    viewFixedExpenses,
    fixedExpensesFromSnapshot,
    setFixedExpenses,
    debts,
    assets,
    housingMode,
    dailyData,
    reconciliation,
    dailyTransactions,
    setDailyTransactions,
    recurringTemplates,
    setRecurringTemplates,
    accountLabels,
    accountGroups,
    accountFilter,
    setAccountFilter,
    internalTransferIds,
    nonTransferTransactions,
    savingsTargetPercent,
    payday,
    labelRules,
    region,
    grossAnnualIncome,
    employerCostConfig,
    formatCurrency,
    formatCurrencyShort,
  } = useFinance();

  // Trailing savings-rate health — flag when the last few months' rate has slipped
  // under the target (same inputs as SavingsRateChart so the banner and line agree).
  const savingsWarning = useMemo(() => {
    const months = lastNMonthKeys(currentMonth, 12);
    const seasonal = region === 'no'
      ? { grossAnnual: grossAnnualIncome, feriepengesatsPct: employerCostConfig.feriepengesatsPct }
      : null;
    const rows = monthlyCashflow(months, nonTransferTransactions, monthlyIncomes, Math.round(effectiveIncome), totalFixedExpenses, seasonal);
    return savingsRateStatus(rows, savingsTargetPercent);
  }, [currentMonth, nonTransferTransactions, monthlyIncomes, effectiveIncome, totalFixedExpenses, savingsTargetPercent, region, grossAnnualIncome, employerCostConfig.feriepengesatsPct]);

  const [modal, setModal] = useState<ModalConfig | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [payslipOpen, setPayslipOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [undo, setUndo] = useState<{ message: string; onUndo: () => void } | null>(null);
  // Latest transactions, so a queued undo re-adds a row to current state rather
  // than the (stale) array captured when the delete happened.
  const txRef = useRef(dailyTransactions);
  useEffect(() => { txRef.current = dailyTransactions; });
  // Latest templates, kept in a ref so the add-transaction modal (a captured
  // closure) can create/delete templates and re-open with a fresh chip list.
  const templatesRef = useRef(recurringTemplates);
  useEffect(() => { templatesRef.current = recurringTemplates; });

  const openModal = (config: ModalConfig) => setModal(config);
  const closeModal = () => setModal(null);

  // Informational only — not folded into totalFixedExpenses (which drives budget
  // math); surfaces the monthly minimum debt service alongside fixed costs.
  const totalMonthlyDebtService = debts.reduce((sum, d) => sum + d.minPayment, 0);
  // Sort biggest-first so the distribution reads as a clean ranking. Uses the
  // month's recorded expenses when time-travelling (see viewFixedExpenses).
  const sortedExpenses = [...viewFixedExpenses].sort((a, b) => b.amount - a.amount);

  // Group the fixed-expense list by type so each category (Fast / Variabel /
  // Abonnement / Forsikring) reads as its own labelled block. Every expense is
  // still shown; only the visual grouping changes. Untyped legacy rows fall into
  // 'fixed', matching `expenseColor` and `fixedExpenseTotalsByType`.
  const fixedExpenseGroups = useMemo(() => {
    const order: ExpenseType[] = ['fixed', 'variable', 'subscription', 'insurance'];
    const byType = new Map<ExpenseType, FixedExpense[]>();
    for (const e of viewFixedExpenses) {
      const type = e.type ?? 'fixed';
      const bucket = byType.get(type);
      if (bucket) bucket.push(e);
      else byType.set(type, [e]);
    }
    return order
      .map((type) => ({ type, expenses: byType.get(type) ?? [] }))
      .filter((g) => g.expenses.length > 0);
  }, [viewFixedExpenses]);

  // --- Validation helpers ---
  const parsePositiveNumber = (val: string): number | null => {
    const n = parseLocaleNumber(val);
    if (isNaN(n) || n < 0) return null;
    return n;
  };
  const kindField = (value: 'income' | 'expense'): ModalField => ({
    key: 'kind', label: t.txKind, type: 'select', value,
    options: [
      { value: 'expense', label: t.txExpense },
      { value: 'income', label: t.txIncome },
    ],
  });

  // Set (override) the selected month's income. Shared by the income stat card
  // and the "set this month's income" reminder banner.
  const editMonthlyIncome = () => openModal({
    title: t.monthlyIncome,
    fields: [{ key: 'income', label: t.editIncome, type: 'number', value: effectiveIncome.toString() }],
    onSave: (vals) => {
      const n = parsePositiveNumber(vals.income);
      if (n !== null) {
        setMonthlyIncomeForMonth(format(currentMonth, 'yyyy-MM'), n);
        closeModal();
      } else {
        setModal(prev => prev ? { ...prev, error: t.editAmount + t.validation.positiveAmountSuffix } : null);
      }
    },
  });

  // --- Fixed Expenses ---
  // Add/edit runs in the dedicated ExpenseDialog (src/components/ExpenseDialog.tsx),
  // not the shared EditModal — it groups essentials, the "what happens to the
  // money" destination, and advanced tracking/matching options.
  const [expenseDialog, setExpenseDialog] = useState<{ editing?: FixedExpense } | null>(null);
  const openExpenseDialog = (editing?: FixedExpense) => setExpenseDialog({ editing });
  const saveExpense = (payload: Omit<FixedExpense, 'id'>) => {
    setFixedExpenses(
      expenseDialog?.editing
        ? fixedExpenses.map(e => (e.id === expenseDialog.editing!.id ? { ...e, ...payload } : e))
        : [...fixedExpenses, { id: crypto.randomUUID(), ...payload }],
    );
    setExpenseDialog(null);
  };

  // Display label for a destination-bearing expense's target (or null if none).
  const destinationLabelFor = (e: FixedExpense): string | null => {
    if (e.destinationKind === 'savingsAccount') {
      const acc = (assets.savingsAccounts ?? []).find(s => s.id === e.savingsAccountId);
      return acc ? `${t.expenseDestination.savings}: ${acc.name}` : t.expenseDestination.targetMissing;
    }
    if (e.destinationKind === 'bufferAccount') {
      return t.expenseDestination.buffer;
    }
    if (e.destinationKind === 'debt') {
      const d = debts.find(x => x.id === e.debtId);
      return d ? `${t.expenseDestination.debt}: ${d.name}` : t.expenseDestination.targetMissing;
    }
    if (e.destinationKind === 'mortgage') {
      return housingMode === 'first_buyer' ? t.expenseDestination.pausedNoMortgage : t.expenseDestination.mortgage;
    }
    return null;
  };

  const removeFixedExpense = (id: string, name: string) => {
    setPendingDelete({ type: 'expense', id, name });
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    setFixedExpenses(fixedExpenses.filter(e => e.id !== pendingDelete.id));
    setPendingDelete(null);
  };

  // Canonical categories for the transaction dropdown (income is set by `kind`,
  // not chosen here). Blank = uncategorized → the auto-categorizer fills it.
  const categoryOptions = [
    { value: '', label: t.uncategorized },
    ...CATEGORIES.filter(c => c.key !== 'income').map(c => ({ value: c.key, label: t.categoryLabels[c.key] })),
  ];

  // --- Daily Transactions ---
  const addDailyTransaction = (dateStr: string, prefill?: Partial<TransactionTemplate>) => {
    // Plain "add" reuses the last category/kind (session-local); a template
    // prefill takes precedence over the remembered defaults.
    const defaultCategory = prefill?.category ?? lastAddDefaults.category;
    const defaultKind = prefill ? 'expense' : lastAddDefaults.kind;
    const templates = templatesRef.current;
    // Quick-pick chips for saved templates (rent split, cash allowance, …):
    // apply one to prefill the form, or delete it with the ×. The ref is bumped
    // synchronously on delete so the re-opened modal drops the removed chip.
    const templateHeader = templates.length > 0 ? (
      <div className="space-y-1.5">
        <div className="text-[11px] font-medium text-[var(--text-2)] uppercase tracking-wide">{t.budgetPage.savedTemplates}</div>
        <div className="flex flex-wrap gap-1.5">
          {templates.map(tpl => (
            <span key={tpl.id} className="inline-flex items-center rounded-[4px] border border-[var(--border)] overflow-hidden">
              <button
                type="button"
                onClick={() => addDailyTransaction(dateStr, tpl)}
                className="px-2 py-1 text-[11px] font-medium text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--bg-raised)] transition-colors"
              >
                {tpl.description} · {formatCurrency(tpl.amount)}
              </button>
              <button
                type="button"
                aria-label={`${t.delete} — ${tpl.description}`}
                onClick={() => {
                  const next = templatesRef.current.filter(x => x.id !== tpl.id);
                  templatesRef.current = next;
                  setRecurringTemplates(next);
                  addDailyTransaction(dateStr, prefill);
                }}
                className="px-1.5 py-1 text-[var(--text-3)] hover:text-[var(--negative)] border-l border-[var(--border)] transition-colors"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      </div>
    ) : undefined;
    openModal({
      title: format(new Date(dateStr + 'T00:00:00'), 'dd.MM.yyyy'),
      header: templateHeader,
      fields: [
        { key: 'description', label: t.transactionDetails, type: 'text', value: prefill?.description ?? '', placeholder: t.budgetPage.transactionPlaceholder },
        { key: 'amount', label: t.impact, type: 'number', value: prefill?.amount?.toString() ?? '', placeholder: '0' },
        { key: 'category', label: t.category, type: 'select', value: defaultCategory, options: categoryOptions },
        kindField(defaultKind),
        { key: 'saveTemplate', label: t.budgetPage.saveAsTemplate, type: 'checkbox', value: 'false', hint: t.budgetPage.saveAsTemplateHint },
      ],
      onSave: (vals) => {
        const amount = parsePositiveNumber(vals.amount);
        if (vals.description.trim() && amount !== null) {
          const kind = vals.kind === 'income' ? 'income' : 'expense';
          lastAddDefaults = { category: vals.category.trim(), kind };
          setDailyTransactions([...dailyTransactions, {
            id: crypto.randomUUID(),
            date: dateStr,
            description: vals.description.trim(),
            amount,
            category: vals.category.trim() || undefined,
            categorySource: vals.category.trim() ? 'manual' : undefined,
            kind,
          }]);
          if (vals.saveTemplate === 'true') {
            const next = [...templatesRef.current, {
              id: crypto.randomUUID(),
              description: vals.description.trim(),
              amount,
              category: vals.category.trim() || undefined,
            }];
            templatesRef.current = next;
            setRecurringTemplates(next);
          }
          closeModal();
        } else {
          setModal(prev => prev ? { ...prev, error: !vals.description.trim() ? t.transactionDetails + t.validation.requiredSuffix : t.impact + t.validation.positiveAmountSuffix } : null);
        }
      },
    });
  };

  // Editing a transaction is delegated to the shared EditTransactionModal so the
  // Budget ledger and the Dashboard recent list behave identically.
  const [editingTx, setEditingTx] = useState<DailyTransaction | null>(null);

  // Routine deletes use undo (not a confirm): remove immediately and offer a
  // brief window to bring the item back via the toast.
  const removeDailyTransaction = (id: string) => {
    const tx = dailyTransactions.find(t => t.id === id);
    if (!tx) return;
    setDailyTransactions(dailyTransactions.filter(t => t.id !== id));
    setUndo({
      message: t.budgetPage.txDeleted,
      onUndo: () => { setDailyTransactions([...txRef.current, tx]); setUndo(null); },
    });
  };
  const removePayslipWithUndo = (key: string) => {
    const data = payslips[key];
    if (!data) return;
    removePayslip(key);
    setUndo({
      message: t.budgetPage.payslipRemoved,
      onUndo: () => { setPayslip(key, data); setUndo(null); },
    });
  };

  // --- CSV Export ---
  // scope 'month' exports just the selected month; 'all' exports the full ledger
  // history (every recorded transaction), sorted oldest-first either way.
  const exportCSV = (scope: 'month' | 'all' = 'month') => {
    const monthStr = format(currentMonth, 'yyyy-MM');
    const source = scope === 'all' ? dailyTransactions : dailyTransactions.filter(tx => tx.date.startsWith(monthStr));
    const sorted = [...source].sort((a, b) => a.date.localeCompare(b.date));

    const header = ['Date', 'Day', 'Description', 'Category', 'Amount'];
    const rows = sorted.map(tx => {
      const date = new Date(tx.date + 'T00:00:00');
      return [
        tx.date,
        t.days[date.getDay()],
        `"${txDisplayName(tx, labelRules).replace(/"/g, '""')}"`,
        tx.category ? `"${isCategoryKey(tx.category) ? t.categoryLabels[tx.category] : tx.category}"` : '',
        tx.amount.toString(),
      ];
    });

    const csv = [header, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = scope === 'all' ? 'budget-all.csv' : `budget-${monthStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Raw ledger total (envelope-covered included) — the Dashboard deliberately
  // shows discretionary spend instead; see src/lib/spentTotals.ts.
  const totalSpentThisMonth = sumLedgerSpent(dailyData);

  // The linked fixed-expense name covering a transaction's category, if any — used
  // to tag drawn-down transactions in the log so it's clear why they don't move the
  // daily balance. Returns undefined for income and non-enveloped spend.
  const envelopeNameFor = (tx: DailyTransaction): string | undefined => {
    const key = envelopeKeyForTx(tx, reconciliation);
    if (!key) return undefined;
    const env = key.startsWith('exp:')
      ? reconciliation.byExpenseId.get(key.slice(4))
      : reconciliation.byCategory.get(key as CategoryKey);
    if (!env) return undefined;
    return env.name ?? fixedExpenses.find(e => e.id === env.expenseIds[0])?.name;
  };

  const dateLocale = lang === 'nb' ? nb : enUS;
  const monthLabel = format(currentMonth, 'MMMM yyyy', { locale: dateLocale });
  const monthKey = format(currentMonth, 'yyyy-MM');
  const monthPayslip = payslips[monthKey];

  // Collision detector: unlinked fixed expenses that look like they double-count
  // with tracked spending (e.g. a "Mat" line while groceries also flow in as
  // transactions). Dismissable per session; linking resolves it for good.
  const [dismissedLinks, setDismissedLinks] = useState<Set<string>>(new Set());
  const linkSuggestions = useMemo(
    () => suggestEnvelopeLinks(fixedExpenses, dailyTransactions, monthKey).filter(s => !dismissedLinks.has(s.expenseId)),
    [fixedExpenses, dailyTransactions, monthKey, dismissedLinks],
  );
  const linkExpenseToCategory = (expenseId: string, category: string) =>
    setFixedExpenses(fixedExpenses.map(e => e.id === expenseId ? { ...e, category: isCategoryKey(category) ? category : undefined } : e));

  // Recurring-payment detector: a merchant charging a steady amount ~monthly that
  // isn't yet a fixed expense. One tap creates a matching fixed expense (as a
  // pattern envelope, so it draws down instead of double-counting). Session-dismissable.
  const [dismissedRecurring, setDismissedRecurring] = useState<Set<string>>(new Set());
  const recurringSuggestions = useMemo(
    () => detectRecurring(dailyTransactions, fixedExpenses, monthKey).filter(s => !dismissedRecurring.has(s.key)),
    [dailyTransactions, fixedExpenses, monthKey, dismissedRecurring],
  );
  const makeFixedFromRecurring = (s: RecurringSuggestion) => {
    setFixedExpenses([...fixedExpenses, { id: crypto.randomUUID(), name: s.label, amount: s.amount, type: 'fixed', category: s.category, match: s.key }]);
    setDismissedRecurring(prev => new Set(prev).add(s.key));
  };
  const today = new Date();
  const isCurrentMonth = isSameMonth(currentMonth, today);
  const isPast = currentMonth < startOfMonth(today);
  // Before payday on the current month, the paycheck hasn't landed — so nudges
  // that judge the month as incomplete (set-your-income, low savings rate) are
  // premature. See isBeforePayday for the exact rule.
  const beforePayday = isBeforePayday(payday, currentMonth, today);
  // Fixed-expense config is read-only when viewing a past month: the list shows
  // that month's recorded expenses (viewFixedExpenses), which editing live config
  // can't change. Transactions/income stay editable — they're dated timeline data.
  const expensesReadOnly = isPast;
  const incomeDiff = incomeDiffPct(effectiveIncome, averageIncome);
  // Remind the user to set THIS month's income while it's still auto-calculated.
  // Only for the live month; dismissible, but the dismiss is keyed to the month
  // so it returns once a new month begins.
  const showIncomeReminder =
    isCurrentMonth && !isMonthlyIncomeOverridden && incomeReminderDismissedMonth !== monthKey && !beforePayday;

  // Ledger honors the account filter (transfers stay visible but marked, so the
  // log remains a faithful record of what moved).
  const accountMatch = (tx: DailyTransaction) =>
    accountFilter == null || accountGroupKey(tx, accountLabels) === accountFilter;

  // Free-text ledger search over merchant + description + display label + amount.
  // Empty query matches everything; otherwise a case-insensitive substring test.
  const query = search.trim().toLowerCase();
  const searchMatch = (tx: DailyTransaction) => {
    if (!query) return true;
    const hay = `${buildMatchHaystack(tx.merchant, tx.description)}${txDisplayName(tx, labelRules).toLowerCase()} ${tx.amount} `;
    return hay.includes(query);
  };
  const rowMatch = (tx: DailyTransaction) => accountMatch(tx) && searchMatch(tx);
  // When searching, drop days with no matching rows so results read as a list.
  const ledgerDays = query ? dailyData.filter(day => day.transactions.some(rowMatch)) : dailyData;
  const searchCount = query
    ? ledgerDays.reduce((n, day) => n + day.transactions.filter(rowMatch).length, 0)
    : 0;

  // --- Bulk select / recategorize / delete ---
  const toggleSelect = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const exitSelect = () => { setSelectMode(false); setSelected(new Set()); };
  const bulkSetCategory = () => openModal({
    title: t.budgetPage.bulkCategoryTitle,
    fields: [{ key: 'category', label: t.category, type: 'select', value: '', options: categoryOptions }],
    onSave: (vals) => {
      const cat = vals.category.trim();
      setDailyTransactions(dailyTransactions.map(tx => selected.has(tx.id)
        ? { ...tx, category: cat || undefined, categorySource: cat ? 'manual' : undefined }
        : tx));
      closeModal();
      exitSelect();
    },
  });
  const confirmBulkDelete = () => {
    setDailyTransactions(dailyTransactions.filter(tx => !selected.has(tx.id)));
    setBulkDeleteOpen(false);
    exitSelect();
  };

  // Account scope, as a compact dropdown placed next to the analysis it filters.
  // Default is "all accounts"; only shown when there's more than one account.
  const accountFilterSelect = accountGroups.length > 1 ? (
    <select
      value={accountFilter ?? ''}
      onChange={(e) => setAccountFilter(e.target.value || null)}
      aria-label={t.budgetPage.accountFilterLabel}
      className="h-7 px-2 rounded-[6px] text-[12px] border max-w-[12rem]"
      style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
    >
      <option value="">{t.budgetPage.allAccounts}</option>
      {accountGroups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
    </select>
  ) : null;

  return (
    <div className="space-y-6 md:space-y-7">
      {/* Hero header */}
      <header className="max-w-4xl">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className="text-[12px] uppercase tracking-[0.16em] font-semibold" style={{ color: 'var(--accent)' }}>
            {monthLabel}
          </span>
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] text-[10px] font-semibold uppercase tracking-[0.1em]"
            style={{
              background: isCurrentMonth ? 'var(--positive-bg)' : isPast ? 'var(--surface-4)' : 'var(--violet-bg)',
              color: isCurrentMonth ? 'var(--positive)' : isPast ? 'var(--text-3)' : 'var(--violet)',
            }}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: isCurrentMonth ? 'var(--positive)' : isPast ? 'var(--text-3)' : 'var(--violet)' }}
            />
            {isCurrentMonth ? t.viewingCurrent : isPast ? t.viewingPast : t.viewingFuture}
          </span>
          {!isCurrentMonth && (
            <button
              onClick={() => setCurrentMonth(startOfMonth(today))}
              className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-[4px] transition-colors"
              style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
            >
              → {t.today}
            </button>
          )}
        </div>
        <h1 className="font-serif text-4xl md:text-6xl font-medium leading-[1.05] tracking-[-0.01em]">
          {t.budgetPage.heroTitlePre}<em className="font-serif italic" style={{ color: 'var(--brass)' }}>{t.budgetPage.heroTitleEm}</em>{t.budgetPage.heroTitlePost}
        </h1>
        <p className="mt-3 text-[15px] leading-[1.55] max-w-2xl" style={{ color: 'var(--text-2)' }}>
          {`${t.budgetPage.incomeIntro}${formatCurrency(effectiveIncome)}${averageIncome > 0 && Object.keys(monthlyIncomes).length > 1 ? ` (${formatSignedPct(incomeDiff, 1, '')}${t.budgetPage.vsAvgSuffix}` : ''}${t.budgetPage.incomeOutro}`}
        </p>
      </header>

      {/* Reminder: set this month's income while it's still auto-calculated */}
      {showIncomeReminder && (
        <div
          className="flex items-center justify-between gap-3 px-4 py-3 rounded-[var(--radius-md)] border text-[13px]"
          style={{ background: 'var(--accent-bg)', borderColor: 'color-mix(in srgb, var(--accent) 30%, transparent)', color: 'var(--accent)' }}
        >
          <span className="flex items-center gap-2 min-w-0">
            <Info size={15} className="shrink-0" />
            <span className="[overflow-wrap:anywhere]">{t.budgetPage.incomeReminder}</span>
          </span>
          <span className="shrink-0 flex items-center gap-1">
            <button
              type="button"
              onClick={editMonthlyIncome}
              className="font-semibold inline-flex items-center gap-1 transition-opacity hover:opacity-90"
            >
              {t.budgetPage.incomeReminderAction}
              <Edit2 size={13} />
            </button>
            <button
              type="button"
              onClick={() => dismissIncomeReminder(monthKey)}
              aria-label={t.budgetPage.incomeReminderDismiss}
              title={t.budgetPage.incomeReminderDismiss}
              className="ml-1 p-1 rounded-[6px] transition-opacity hover:opacity-70"
            >
              <X size={15} />
            </button>
          </span>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          dataTour="income"
          title={t.monthlyIncome}
          value={formatCurrency(effectiveIncome)}
          editLabel={`${t.edit} — ${t.monthlyIncome}`}
          sublabel={(
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span style={{ color: isMonthlyIncomeOverridden ? 'var(--warning)' : 'var(--positive)' }}>
                {isMonthlyIncomeOverridden ? t.salary.incomeOverride : t.salary.incomeAuto}
              </span>
              {isMonthlyIncomeOverridden && (
                <>
                  <span style={{ color: 'var(--text-3)' }}>·</span>
                  <span style={{ color: 'var(--text-3)' }}>
                    {t.budgetPage.autoLabel}: {formatCurrency(derivedMonthlyIncome)}
                  </span>
                  <button
                    onClick={() => clearMonthlyIncomeForMonth(format(currentMonth, 'yyyy-MM'))}
                    className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded transition-colors"
                    style={{ color: 'var(--accent)', background: 'var(--accent-bg)' }}
                  >
                    {t.salary.incomeResetAuto}
                  </button>
                </>
              )}
              {!isMonthlyIncomeOverridden && Object.keys(monthlyIncomes).length > 0 && (
                <>
                  <span style={{ color: 'var(--text-3)' }}>·</span>
                  <span style={{ color: 'var(--text-3)' }}>
                    {t.budgetPage.avgLabel}: {formatCurrency(averageIncome)}
                  </span>
                </>
              )}
              <button
                onClick={() => setPayslipOpen(true)}
                className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded transition-colors"
                style={{ color: 'var(--accent)', background: 'var(--accent-bg)' }}
              >
                <FileUp size={11} /> {t.salary.importPayslip.button}
              </button>
            </div>
          )}
          editable
          onEdit={editMonthlyIncome}
        />
        <StatCard title={t.monthlyBudget} value={formatCurrency(monthlyBudget)} accent />
        <StatCard title={t.dailyBudget} value={formatCurrency(dailyBudget)} />
        <StatCard title={t.fixedCosts} value={formatCurrency(totalFixedExpenses)} />
      </div>

      {/* Imported payslip for this month */}
      {monthPayslip && (
        <div className={`${card} p-5 md:p-6`}>
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-[var(--border)]">
            <div className="flex items-center gap-2">
              <FileUp size={14} className="text-[var(--text-2)]" />
              <h3 className="text-[13px] font-semibold text-[var(--text-1)]">{t.salary.importPayslip.savedTitle}</h3>
            </div>
            <button
              onClick={() => removePayslipWithUndo(monthKey)}
              className="text-[11px] font-medium text-[var(--text-2)] hover:text-[var(--negative)] transition-colors"
            >
              {t.salary.importPayslip.remove}
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
            {([
              { label: t.salary.importPayslip.extraNet, value: monthPayslip.net },
              { label: t.salary.importPayslip.extraGross, value: monthPayslip.gross },
              { label: t.salary.importPayslip.extraTax, value: monthPayslip.tax },
              { label: t.salary.importPayslip.extraBase, value: monthPayslip.base },
              ...(monthPayslip.holidayPay != null
                ? [{ label: t.salary.importPayslip.extraHolidayPay, value: monthPayslip.holidayPay }]
                : []),
            ]).map(f => (
              <div key={f.label}>
                <div className="text-[10px] uppercase tracking-[0.1em] font-semibold" style={{ color: 'var(--text-3)' }}>{f.label}</div>
                <div className="text-[14px] font-mono tabular-nums text-[var(--text-1)]">{formatCurrency(f.value)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <SmartRecommendations />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 items-stretch">
        {/* Fixed Expenses */}
        <div data-tour="fixed-expenses" className={`lg:col-span-1 ${card} p-5 md:p-7 space-y-5`}>
          <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
            <h2 className={sectionLabel}>{t.fixedCosts}</h2>
            {!expensesReadOnly && (
              <button
                onClick={() => openExpenseDialog()}
                aria-label={`${t.add} — ${t.fixedCosts}`}
                className="text-[var(--accent)] hover:opacity-70 transition-opacity"
              >
                <PlusCircle size={18} strokeWidth={2} />
              </button>
            )}
          </div>
          {expensesReadOnly && (
            <p className="text-[11px] leading-snug" style={{ color: 'var(--text-3)' }}>
              {fixedExpensesFromSnapshot ? t.fixedExpensesRecorded : t.fixedExpensesNotRecorded}
            </p>
          )}
          {!expensesReadOnly && linkSuggestions.length > 0 && (
            <div className="rounded-[6px] border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[var(--warning-bg)] p-3 space-y-2.5">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--text-1)]">
                <Wallet size={13} className="text-[var(--warning)]" />
                {t.envelopeSuggestTitle}
              </div>
              {linkSuggestions.map(s => (
                <div key={s.expenseId} className="flex items-center justify-between gap-2">
                  <span className="text-[11px] leading-snug text-[var(--text-2)] min-w-0">
                    {t.envelopeSuggestText
                      .replace('{name}', s.expenseName)
                      .replace('{amount}', formatCurrency(s.spent))
                      .replace('{category}', t.categoryLabels[s.category])}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => linkExpenseToCategory(s.expenseId, s.category)}
                      className="px-2.5 py-1 rounded-[4px] text-[11px] font-semibold text-[var(--text)] bg-[var(--forest)] hover:bg-[var(--forest-dim)] transition-opacity"
                    >
                      {t.envelopeSuggestLink}
                    </button>
                    <button
                      onClick={() => setDismissedLinks(prev => new Set(prev).add(s.expenseId))}
                      className="px-2 py-1 rounded-[4px] text-[11px] font-medium text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors"
                    >
                      {t.envelopeSuggestDismiss}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!expensesReadOnly && recurringSuggestions.length > 0 && (
            <div className="rounded-[6px] border border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[var(--accent-bg)] p-3 space-y-2.5">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--text-1)]">
                <Repeat size={13} className="text-[var(--accent)]" />
                {t.recurringSuggestTitle}
              </div>
              {recurringSuggestions.slice(0, 4).map(s => (
                <div key={s.key} className="flex items-center justify-between gap-2">
                  <span className="text-[11px] leading-snug text-[var(--text-2)] min-w-0">
                    {t.recurringSuggestText
                      .replace('{name}', s.label)
                      .replace('{amount}', formatCurrency(s.amount))
                      .replace('{months}', s.months.toString())}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => makeFixedFromRecurring(s)}
                      className="px-2.5 py-1 rounded-[4px] text-[11px] font-semibold text-[var(--text)] bg-[var(--forest)] hover:bg-[var(--forest-dim)] transition-opacity"
                    >
                      {t.recurringSuggestAction}
                    </button>
                    <button
                      onClick={() => setDismissedRecurring(prev => new Set(prev).add(s.key))}
                      className="px-2 py-1 rounded-[4px] text-[11px] font-medium text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors"
                    >
                      {t.envelopeSuggestDismiss}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div>
            {fixedExpenseGroups.map((group) => (
              // Each category is its own card: a coloured left edge + a tinted
              // header band make the grouping unmistakable, and the rows live
              // inside so a category reads as one bounded block.
              <div
                key={group.type}
                className="mt-3 first:mt-0 rounded-[10px] border border-[var(--border)] overflow-hidden"
                style={{ borderLeft: `3px solid ${EXPENSE_TYPE_COLOR[group.type]}` }}
              >
                <div
                  className="flex items-center gap-2 px-3.5 py-2 text-[11px] font-bold uppercase tracking-wider"
                  style={{
                    color: 'var(--text-1)',
                    background: `color-mix(in srgb, ${EXPENSE_TYPE_COLOR[group.type]} 9%, transparent)`,
                  }}
                >
                  <span className="w-[8px] h-[8px] rounded-[2px] shrink-0" style={{ background: EXPENSE_TYPE_COLOR[group.type] }} />
                  {t.expenseType[group.type]}
                </div>
                <div className="px-3.5">
                {group.expenses.map((expense) => {
              // Envelope reconciliation, shown only for a linked expense that has
              // real spend this month (keeps the list quiet for non-syncers). When
              // several expenses share a category, the shared bar renders once,
              // under the first of them.
              const envelope = reconciliation.byExpenseId.get(expense.id);
              const showEnvelope = !!envelope && envelope.actual > 0 && envelope.expenseIds[0] === expense.id;
              const isOver = envelope?.status === 'over';
              return (
              <div
                key={expense.id}
                className={`relative py-4 border-b border-[var(--border)] last:border-0 ${isOver ? 'pl-2.5' : ''}`}
              >
                {/* Over-budget accent: a rounded bar inset from the row edges so
                    two adjacent over-budget rows read separately, not as one bar. */}
                {isOver && <span aria-hidden className="absolute left-0 top-3.5 bottom-3.5 w-[3px] rounded-full bg-[var(--rust)]" />}
                <div className="flex items-center justify-between group">
                  {expensesReadOnly ? (
                    <span className="flex items-center gap-2 text-[13px] font-medium text-[var(--text-1)] min-w-0">
                      <span className="w-[7px] h-[7px] rounded-[2px] shrink-0" style={{ background: expenseColor(expense.type) }} />
                      <span className="truncate">{expense.name}</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`${t.edit} — ${expense.name}`}
                      className="flex items-center gap-2 text-[13px] font-medium text-[var(--text-1)] cursor-pointer hover:text-[var(--accent)] transition-colors min-w-0 text-left"
                      onClick={() => openExpenseDialog(expense)}
                    >
                      <span className="w-[7px] h-[7px] rounded-[2px] shrink-0" style={{ background: expenseColor(expense.type) }} />
                      <span className="truncate">{expense.name}</span>
                    </button>
                  )}
                  <div className="flex items-center gap-3">
                    {expensesReadOnly ? (
                      <span className="text-[13px] font-mono font-medium text-[var(--text-1)]">
                        {formatCurrency(expense.amount)}
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          aria-label={`${t.edit} — ${expense.name}`}
                          className="text-[13px] font-mono font-medium text-[var(--text-1)] cursor-pointer hover:text-[var(--accent)] transition-colors"
                          onClick={() => openExpenseDialog(expense)}
                        >
                          {formatCurrency(expense.amount)}
                        </button>
                        <button
                          onClick={() => removeFixedExpense(expense.id, expense.name)}
                          aria-label={`${t.delete} — ${expense.name}`}
                          className="text-[var(--text-2)] hover:text-[var(--negative)] sm:opacity-0 sm:group-hover:opacity-100 transition-all"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {expense.destinationKind && destinationLabelFor(expense) && (
                  <div className="mt-1 pl-[15px] flex items-center gap-1 text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                    <span aria-hidden>→</span> {destinationLabelFor(expense)}
                  </div>
                )}
                {showEnvelope && <EnvelopeBar envelope={envelope} formatCurrency={formatCurrency} labels={{ left: t.envelopeLeft, over: t.envelopeOver }} />}
              </div>
              );
                })}
                </div>
              </div>
            ))}
            <div className="pt-5 flex justify-between items-baseline">
              <span className={sectionLabel}>{t.aggregate}</span>
              <span className="text-xl font-bold font-mono text-[var(--text-1)]">{formatCurrency(totalFixedExpenses)}</span>
            </div>
            {totalMonthlyDebtService > 0 && (
              <div className="flex justify-between items-baseline text-[12px]" style={{ color: 'var(--text-3)' }}>
                <span>{t.debtServiceMonthly}</span>
                <span className="font-mono">{formatCurrency(totalMonthlyDebtService)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Charts */}
        <div className={`lg:col-span-2 ${card} p-5 md:p-7 flex flex-col gap-5`}>
          <h2 className={`${sectionLabel} pb-4 border-b border-[var(--border)]`}>
            {t.distributionAnalysis}
          </h2>
          <div className="flex-1 min-h-[280px] md:min-h-[340px] w-full">
            <Suspense fallback={<ChartSkeleton />}>
              <BudgetDistributionChart
                data={sortedExpenses}
                totalFixedExpenses={totalFixedExpenses}
                expenseColor={expenseColor}
                formatCurrency={formatCurrency}
                formatCurrencyShort={formatCurrencyShort}
                ofFixedCostsLabel={t.common.ofFixedCosts}
              />
            </Suspense>
          </div>

          {/* Category dashboard — spend per category with MoM + drill-in */}
          <div className="pt-2 pb-3 border-t border-[var(--border)] flex items-center justify-between gap-3">
            <span className={sectionLabel}>{t.spendingByCategory}</span>
            {accountFilterSelect}
          </div>
          <CategoryBreakdown onEditTransaction={(tx) => setEditingTx(tx)} />

          {/* Multi-month spending trend by category */}
          <div className={`${sectionLabel} pt-5 pb-3 border-t border-[var(--border)]`}>
            {t.spendingTrend} · {t.trendMonths}
          </div>
          <CategoryTrendChart />

          {/* Per-category monthly budgets */}
          <div className="pt-5 border-t border-[var(--border)]">
            <CategoryBudgets />
          </div>
        </div>
      </div>

      <MonthlyAccountSpend />

      <FunBudget />

      {/* Savings rate + spending heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <div className={`${card} p-5 md:p-7 flex flex-col`}>
          <div className="pb-4 mb-2 border-b border-[var(--border)]">
            <h2 className={sectionLabel}>{t.charts.savingsRateTitle}</h2>
            <p className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>{t.charts.savingsRateSub}</p>
          </div>
          {savingsWarning && savingsWarning.belowTarget && savingsWarning.months >= 2 && !beforePayday && (
            <div
              className="flex items-start gap-2 mb-3 px-3 py-2 rounded-[6px] text-[12px] leading-snug"
              style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}
              role="status"
            >
              <TrendingDown size={14} strokeWidth={2} className="shrink-0 mt-px" />
              <span>
                {t.budgetPage.savingsRateWarning
                  .replace('{months}', String(savingsWarning.months))
                  .replace('{rate}', String(savingsWarning.trailingRate))
                  .replace('{target}', String(Math.round(savingsTargetPercent)))}
              </span>
            </div>
          )}
          <div className="flex-1 min-h-[240px] w-full">
            <Suspense fallback={<ChartSkeleton />}><SavingsRateChart /></Suspense>
          </div>
        </div>
        <div className={`${card} p-5 md:p-7`}>
          <div className="pb-4 mb-4 border-b border-[var(--border)]">
            <h2 className={sectionLabel}>{t.charts.heatmapTitle}</h2>
            <p className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>{t.charts.heatmapSub}</p>
          </div>
          <Suspense fallback={<ChartSkeleton className="h-[240px] w-full" />}><SpendingHeatmap /></Suspense>
        </div>
      </div>

      {/* Daily Tracker */}
      <div className={`${card} overflow-hidden`}>
        <div className={`px-5 py-4 md:px-7 md:py-5 flex items-center justify-between ${logOpen ? 'border-b border-[var(--border)]' : ''}`}>
          <button
            onClick={() => setLogOpen(o => !o)}
            aria-expanded={logOpen}
            className="flex items-center gap-2 min-w-0 group"
          >
            <ChevronDown
              size={15}
              className="text-[var(--text-2)] transition-transform group-hover:text-[var(--text-1)]"
              style={{ transform: logOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
            />
            <h2 className={sectionLabel}>{t.operationalLog}</h2>
          </button>
          <div className="flex items-center gap-2">
            {logOpen && totalSpentThisMonth > 0 && (
              <button
                onClick={() => selectMode ? exitSelect() : setSelectMode(true)}
                aria-pressed={selectMode}
                className={`flex items-center gap-1.5 text-[11px] font-medium transition-colors px-2 py-1 rounded-lg hover:bg-[var(--bg-elev)] ${selectMode ? 'text-[var(--accent)]' : 'text-[var(--text-2)] hover:text-[var(--text-1)]'}`}
              >
                <ListChecks size={13} />
                <span className="hidden sm:inline">{selectMode ? t.budgetPage.selectDone : t.budgetPage.selectButton}</span>
              </button>
            )}
            {logOpen && totalSpentThisMonth > 0 && (
              <button
                onClick={() => exportCSV('month')}
                aria-label={t.exportCSV}
                className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors px-2 py-1 rounded-lg hover:bg-[var(--bg-elev)]"
              >
                <Download size={13} />
                <span className="hidden sm:inline">{t.exportCSV}</span>
              </button>
            )}
            {logOpen && dailyTransactions.length > 0 && (
              <button
                onClick={() => exportCSV('all')}
                aria-label={t.exportCSVAll}
                className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors px-2 py-1 rounded-lg hover:bg-[var(--bg-elev)]"
              >
                <Download size={13} />
                <span className="hidden sm:inline">{t.exportCSVAll}</span>
              </button>
            )}
          </div>
        </div>

        {logOpen && (<>
        {/* Search */}
        <div className="px-4 py-3 md:px-7 md:py-4 border-b border-[var(--border)]">
          <div className="relative max-w-sm">
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
          {query && (
            <p className="mt-2 text-[11px] text-[var(--text-3)]">
              {t.budgetPage.searchResults.replace('{count}', searchCount.toString())}
            </p>
          )}
        </div>

        {query && ledgerDays.length === 0 && (
          <div className="px-4 py-8 md:px-7 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>
            {t.budgetPage.searchNoResults}
          </div>
        )}

        {/* Mobile */}
        <div className="md:hidden divide-y divide-[var(--border)]">
          {ledgerDays.map((day) => (
            <div key={day.dateStr} className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[13px] font-semibold font-mono text-[var(--text-1)]">
                    {format(day.date, 'dd.MM.yyyy')}
                  </span>
                  <span className="text-[11px] text-[var(--text-2)] ml-2">{t.days[day.date.getDay()]}</span>
                </div>
                <div className="flex items-center gap-2">
                  {day.spent > 0 && (
                    <span className="text-[12px] font-mono font-semibold text-[var(--negative)]">−{formatCurrency(day.spent)}</span>
                  )}
                  <span className={`text-[12px] font-mono font-bold px-2 py-0.5 rounded-md ${
                    day.balance >= 0
                      ? 'bg-[var(--positive-bg)] text-[var(--positive)]'
                      : 'bg-[var(--negative-bg)] text-[var(--negative)]'
                  }`}>
                    {formatCurrency(day.balance)}
                  </span>
                </div>
              </div>

              {day.transactions.filter(rowMatch).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {day.transactions.filter(rowMatch).map((tx) => {
                    const coveredBy = envelopeNameFor(tx);
                    const isTransfer = internalTransferIds.has(tx.id);
                    const isSelected = selected.has(tx.id);
                    return (
                    <span key={tx.id} title={isTransfer ? t.budgetPage.internalTransfer : coveredBy ? t.envelopeCovered.replace('{name}', coveredBy) : undefined} className={`inline-flex items-center gap-1.5 bg-[var(--bg-raised)] border px-2.5 py-1 rounded-lg text-[12px] font-medium text-[var(--text-1)] ${isSelected ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]' : 'border-[var(--border)]'} ${isTransfer ? 'opacity-60' : ''}`}>
                      {selectMode && (
                        <button type="button" onClick={() => toggleSelect(tx.id)} aria-label={txDisplayName(tx, labelRules)} aria-pressed={isSelected} className="text-[var(--accent)] shrink-0">
                          {isSelected ? <CheckSquare size={13} /> : <Square size={13} className="text-[var(--text-3)]" />}
                        </button>
                      )}
                      {tx.category && (
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: catColor(tx.category) }} />
                      )}
                      <span>{txDisplayName(tx, labelRules)}</span>
                      {isTransfer && <ArrowLeftRight size={11} className="text-[var(--text-3)] shrink-0" aria-label={t.budgetPage.internalTransfer} />}
                      <AccountBadge tx={tx} size="xs" />
                      <span className={`font-mono ${coveredBy ? 'text-[var(--text-3)] line-through' : 'text-[var(--text-2)]'}`}>{formatCurrency(tx.amount)}</span>
                      {coveredBy && <Wallet size={11} className="text-[var(--accent)] shrink-0" aria-hidden />}
                      <button aria-label={`${t.edit} — ${tx.description}`} onClick={() => setEditingTx(tx)} className="text-[var(--text-2)] hover:text-[var(--accent)] p-1.5 -m-0.5">
                        <Edit2 size={11} />
                      </button>
                      <button aria-label={`${t.delete} — ${tx.description}`} onClick={() => removeDailyTransaction(tx.id)} className="text-[var(--text-2)] hover:text-[var(--negative)] p-1.5 -m-0.5">
                        <Trash2 size={11} />
                      </button>
                    </span>
                    );
                  })}
                </div>
              )}

              {!query && (
                <button
                  onClick={() => addDailyTransaction(day.dateStr)}
                  className="flex items-center gap-1 text-[var(--accent)] text-[12px] font-medium"
                >
                  <PlusCircle size={13} strokeWidth={2} />
                  <span>{t.budgetPage.addShort}</span>
                </button>
              )}
            </div>
          ))}

          <div className="p-4 flex justify-between items-center bg-[var(--bg-raised)]">
            <span className={sectionLabel}>{t.endPeriodSurplus}</span>
            <span className={`text-[15px] font-bold font-mono ${dailyData[dailyData.length - 1]?.balance >= 0 ? 'text-[var(--accent)]' : 'text-[var(--negative)]'}`}>
              {formatCurrency(dailyData[dailyData.length - 1]?.balance || 0)}
            </span>
          </div>
        </div>

        {/* Desktop */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[var(--bg-raised)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-2)]">
                <th scope="col" className="px-7 py-3.5">{t.timestamp}</th>
                <th scope="col" className="px-7 py-3.5">{t.transactionDetails}</th>
                <th scope="col" className="px-7 py-3.5 text-right">{t.impact}</th>
                <th scope="col" className="px-7 py-3.5 text-right">{t.runningBalance}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {ledgerDays.map((day) => (
                <tr key={day.dateStr} className="hover:bg-[var(--bg-raised)] transition-colors group">
                  <td className="px-7 py-4">
                    <div className="font-mono font-medium text-[13px] text-[var(--text-1)]">{format(day.date, 'dd.MM.yyyy')}</div>
                    <div className="text-[11px] text-[var(--text-2)] mt-0.5">{t.days[day.date.getDay()]}</div>
                  </td>
                  <td className="px-7 py-4">
                    <div className="flex flex-wrap gap-2">
                      {day.transactions.filter(rowMatch).map((tx) => {
                        const coveredBy = envelopeNameFor(tx);
                        const isTransfer = internalTransferIds.has(tx.id);
                        const isSelected = selected.has(tx.id);
                        return (
                        <span key={tx.id} title={isTransfer ? t.budgetPage.internalTransfer : coveredBy ? t.envelopeCovered.replace('{name}', coveredBy) : undefined} className={`inline-flex items-center gap-2 bg-[var(--bg-raised)] border px-3 py-1.5 rounded-lg text-[12px] font-medium text-[var(--text-1)] ${isSelected ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]' : 'border-[var(--border)]'} ${isTransfer ? 'opacity-60' : ''}`}>
                          {selectMode && (
                            <button type="button" onClick={() => toggleSelect(tx.id)} aria-label={txDisplayName(tx, labelRules)} aria-pressed={isSelected} className="text-[var(--accent)] shrink-0">
                              {isSelected ? <CheckSquare size={14} /> : <Square size={14} className="text-[var(--text-3)]" />}
                            </button>
                          )}
                          {tx.category && (
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: catColor(tx.category) }} />
                          )}
                          <span>{txDisplayName(tx, labelRules)}</span>
                          {isTransfer && <ArrowLeftRight size={11} className="text-[var(--text-3)] shrink-0" aria-label={t.budgetPage.internalTransfer} />}
                          <AccountBadge tx={tx} size="xs" />
                          <span className={`font-mono ${coveredBy ? 'text-[var(--text-3)] line-through' : 'text-[var(--text-2)]'}`}>{formatCurrency(tx.amount)}</span>
                          {coveredBy && <Wallet size={11} className="text-[var(--accent)] shrink-0" aria-hidden />}
                          {tx.category && (
                            <span className="text-[10px] text-[var(--text-2)] hidden lg:inline">{isCategoryKey(tx.category) ? t.categoryLabels[tx.category] : tx.category}</span>
                          )}
                          <button aria-label={`${t.edit} — ${tx.description}`} onClick={() => setEditingTx(tx)} className="text-[var(--text-2)] hover:text-[var(--accent)] transition-colors p-1.5 -m-0.5">
                            <Edit2 size={12} />
                          </button>
                          <button aria-label={`${t.delete} — ${tx.description}`} onClick={() => removeDailyTransaction(tx.id)} className="text-[var(--text-2)] hover:text-[var(--negative)] transition-colors p-1.5 -m-0.5">
                            <Trash2 size={12} />
                          </button>
                        </span>
                        );
                      })}
                      {!query && (
                        <button
                          onClick={() => addDailyTransaction(day.dateStr)}
                          aria-label={t.add}
                          className="text-[var(--accent)] hover:opacity-70 p-1 transition-opacity"
                        >
                          <PlusCircle size={18} strokeWidth={2} />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-7 py-4 text-[13px] font-mono font-medium text-right">
                    {day.spent > 0 ? (
                      <span className="text-[var(--negative)]">−{formatCurrency(day.spent)}</span>
                    ) : (
                      <span className="text-[var(--text-2)]">—</span>
                    )}
                  </td>
                  <td className="px-7 py-4 text-right">
                    <span className={`text-[13px] font-mono font-bold px-2.5 py-1 rounded-md ${
                      day.balance >= 0
                        ? 'bg-[var(--positive-bg)] text-[var(--positive)]'
                        : 'bg-[var(--negative-bg)] text-[var(--negative)]'
                    }`}>
                      {formatCurrency(day.balance)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-[var(--bg-raised)] border-t border-[var(--border)]">
              <tr>
                <td colSpan={2} />
                <td className="px-7 py-5 text-right">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-2)]">{t.monthSpent}</div>
                  <div className="mt-1 font-mono font-medium text-[13px] text-[var(--text-2)]">
                    {totalSpentThisMonth > 0 ? `−${formatCurrency(totalSpentThisMonth)}` : '—'}
                  </div>
                </td>
                <td className="px-7 py-5 text-right">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-2)]">{t.endPeriodSurplus}</div>
                  <span className={`mt-1 inline-block text-xl font-bold font-mono ${dailyData[dailyData.length - 1]?.balance >= 0 ? 'text-[var(--accent)]' : 'text-[var(--negative)]'}`}>
                    {formatCurrency(dailyData[dailyData.length - 1]?.balance || 0)}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        </>)}
      </div>

      {/* Quick-add FAB (mobile, current month): log today's spend without
          expanding and scrolling the tracker. Hidden while selecting rows. */}
      {isCurrentMonth && !selectMode && (
        <button
          onClick={() => addDailyTransaction(format(today, 'yyyy-MM-dd'))}
          aria-label={t.budgetPage.quickAddToday}
          className="md:hidden fixed right-4 bottom-20 z-30 flex items-center justify-center w-14 h-14 rounded-full shadow-lg bg-[var(--forest)] hover:bg-[var(--forest-dim)] text-[var(--text)] transition-colors"
        >
          <PlusCircle size={24} strokeWidth={2} />
        </button>
      )}

      {/* Bulk-action bar — floats while rows are selected */}
      {selectMode && selected.size > 0 && (
        <div
          className="fixed left-1/2 -translate-x-1/2 bottom-20 md:bottom-6 z-40 flex items-center gap-1 px-2 py-1.5 rounded-full border shadow-lg"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
        >
          <span className="text-[12px] font-semibold px-2 text-[var(--text-1)]">
            {t.budgetPage.bulkSelected.replace('{count}', selected.size.toString())}
          </span>
          <button
            onClick={bulkSetCategory}
            className="text-[12px] font-medium px-2.5 py-1 rounded-full text-[var(--accent)] hover:bg-[var(--accent-bg)] transition-colors"
          >
            {t.budgetPage.bulkSetCategory}
          </button>
          <button
            onClick={() => setBulkDeleteOpen(true)}
            className="text-[12px] font-medium px-2.5 py-1 rounded-full text-[var(--negative)] hover:bg-[var(--negative-bg)] transition-colors"
          >
            {t.budgetPage.bulkDelete}
          </button>
          <button
            onClick={exitSelect}
            aria-label={t.budgetPage.bulkClear}
            className="p-1.5 rounded-full text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {bulkDeleteOpen && (
        <ConfirmModal
          title={t.confirmDelete}
          message={t.budgetPage.confirmBulkDeleteMsg.replace('{count}', selected.size.toString())}
          confirmLabel={t.delete}
          cancelLabel={t.cancel}
          onConfirm={confirmBulkDelete}
          onCancel={() => setBulkDeleteOpen(false)}
        />
      )}

      {modal && <EditModal {...modal} onCancel={closeModal} />}
      {expenseDialog && (
        <ExpenseDialog
          expense={expenseDialog.editing}
          onSave={saveExpense}
          onClose={() => setExpenseDialog(null)}
        />
      )}
      {editingTx && <EditTransactionModal tx={editingTx} onClose={() => setEditingTx(null)} />}
      {pendingDelete && (
        <ConfirmModal
          title={t.confirmDelete}
          message={t.confirmDeleteExpenseMsg}
          confirmLabel={t.delete}
          cancelLabel={t.cancel}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      {payslipOpen && <PayslipImportModal onClose={() => setPayslipOpen(false)} />}
      {undo && (
        <UndoToast
          message={undo.message}
          undoLabel={t.budgetPage.undo}
          dismissLabel={t.dismiss}
          onUndo={undo.onUndo}
          onDismiss={() => setUndo(null)}
        />
      )}
    </div>
  );
};


export default BudgetPage;
