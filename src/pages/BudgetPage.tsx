import React, { useState, useMemo, lazy, Suspense } from 'react';
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
} from 'lucide-react';
import SmartRecommendations from '../components/SmartRecommendations';
import { AccountBadge } from '../components/AccountBadge';
import { accountGroupKey } from '../lib/account';
import FunBudget from '../components/FunBudget';
import PayslipImportModal from '../components/PayslipImportModal';
import { format, isSameMonth, startOfMonth } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance, type TransactionTemplate, type ExpenseType, type DailyTransaction } from '../context/FinanceContext';
import EditModal, { type ModalField } from '../components/EditModal';
import { parseLocaleNumber } from '../lib/validators';
import { categoryMeta, isCategoryKey, CATEGORIES, type CategoryKey } from '../lib/categories';
import { suggestEnvelopeLinks, type Envelope, type EnvelopeStatus } from '../lib/envelopes';
import { CHART } from '../lib/chartColors';
import { CategoryBreakdown } from '../components/CategoryBreakdown';
import CategoryTrendChart from '../components/charts/CategoryTrendChart';
import { CategoryBudgets } from '../components/CategoryBudgets';
import { CategoryRules } from '../components/CategoryRules';
import { MonthlyAccountSpend } from '../components/MonthlyAccountSpend';
import ConfirmModal from '../components/ConfirmModal';
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
      <div className="h-[3px] rounded-full bg-[var(--bg-elev)] overflow-hidden">
        <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="flex items-center justify-between text-[11px] font-mono text-[var(--text-2)]">
        <span>{formatCurrency(envelope.actual)} / {formatCurrency(envelope.budgeted)}</span>
        <span style={{ color }}>
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
}

interface PendingDelete {
  type: 'expense' | 'transaction';
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
    fixedExpenses,
    setFixedExpenses,
    debts,
    dailyData,
    reconciliation,
    dailyTransactions,
    setDailyTransactions,
    accountLabels,
    accountGroups,
    accountFilter,
    setAccountFilter,
    internalTransferIds,
    addCategoryRule,
    formatCurrency,
    formatCurrencyShort,
  } = useFinance();

  const [modal, setModal] = useState<ModalConfig | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [payslipOpen, setPayslipOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  const openModal = (config: ModalConfig) => setModal(config);
  const closeModal = () => setModal(null);

  const totalFixedExpenses = fixedExpenses.reduce((sum, item) => sum + item.amount, 0);
  // Informational only — not folded into totalFixedExpenses (which drives budget
  // math); surfaces the monthly minimum debt service alongside fixed costs.
  const totalMonthlyDebtService = debts.reduce((sum, d) => sum + d.minPayment, 0);
  // Sort biggest-first so the distribution reads as a clean ranking.
  const sortedExpenses = [...fixedExpenses].sort((a, b) => b.amount - a.amount);

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
        setModal(prev => prev ? { ...prev, error: t.editAmount + ' må være et positivt tall' } : null);
      }
    },
  });

  // --- Fixed Expenses ---
  const typeOptions = (Object.keys(EXPENSE_TYPE_COLOR) as ExpenseType[]).map(v => ({ value: v, label: t.expenseType[v] }));
  // Optional envelope link: a fixed expense tracked against a spending category
  // (see src/lib/envelopes.ts). Blank = a plain reserved amount (the default).
  const trackCategoryOptions = [
    { value: '', label: t.trackCategoryNone },
    ...CATEGORIES.filter(c => c.key !== 'income').map(c => ({ value: c.key, label: t.categoryLabels[c.key] })),
  ];
  const trackCategoryField = (value?: string) => ({
    key: 'category', label: t.trackCategoryLabel, type: 'select' as const,
    value: value ?? '', options: trackCategoryOptions, hint: t.trackCategoryHint,
  });
  const parseTrackedCategory = (value: string) => (isCategoryKey(value) ? value : undefined);

  const addFixedExpense = () => {
    openModal({
      title: t.fixedCosts,
      fields: [
        { key: 'name', label: t.newExpenseName, type: 'text', value: '', placeholder: 'Mat, Strøm...' },
        { key: 'amount', label: t.newAmount, type: 'number', value: '', placeholder: '0' },
        { key: 'type', label: t.expenseTypeLabel, type: 'select', value: 'fixed', options: typeOptions },
        trackCategoryField(),
      ],
      onSave: (vals) => {
        const amount = parsePositiveNumber(vals.amount);
        if (vals.name.trim() && amount !== null) {
          setFixedExpenses([...fixedExpenses, { id: crypto.randomUUID(), name: vals.name.trim(), amount, type: vals.type as ExpenseType, category: parseTrackedCategory(vals.category) }]);
          closeModal();
        } else {
          setModal(prev => prev ? { ...prev, error: !vals.name.trim() ? t.newExpenseName + ' er påkrevd' : t.newAmount + ' må være et positivt tall' } : null);
        }
      },
    });
  };

  const editFixedExpense = (id: string, name: string, amount: number, type?: ExpenseType, category?: string) => {
    openModal({
      title: name,
      fields: [
        { key: 'name', label: t.editName, type: 'text', value: name },
        { key: 'amount', label: t.editAmount, type: 'number', value: amount.toString() },
        { key: 'type', label: t.expenseTypeLabel, type: 'select', value: type ?? 'fixed', options: typeOptions },
        trackCategoryField(category),
      ],
      onSave: (vals) => {
        const newAmount = parsePositiveNumber(vals.amount);
        if (vals.name.trim() && newAmount !== null) {
          setFixedExpenses(fixedExpenses.map(e => e.id === id ? { ...e, name: vals.name.trim(), amount: newAmount, type: vals.type as ExpenseType, category: parseTrackedCategory(vals.category) } : e));
          closeModal();
        } else {
          setModal(prev => prev ? { ...prev, error: !vals.name.trim() ? t.editName + ' er påkrevd' : t.editAmount + ' må være et positivt tall' } : null);
        }
      },
    });
  };

  const removeFixedExpense = (id: string, name: string) => {
    setPendingDelete({ type: 'expense', id, name });
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    if (pendingDelete.type === 'expense') {
      setFixedExpenses(fixedExpenses.filter(e => e.id !== pendingDelete.id));
    } else {
      setDailyTransactions(dailyTransactions.filter(t => t.id !== pendingDelete.id));
    }
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
    openModal({
      title: format(new Date(dateStr + 'T00:00:00'), 'dd.MM.yyyy'),
      fields: [
        { key: 'description', label: t.transactionDetails, type: 'text', value: prefill?.description ?? '', placeholder: 'Dagligvare, Kaffe...' },
        { key: 'amount', label: t.impact, type: 'number', value: prefill?.amount?.toString() ?? '', placeholder: '0' },
        { key: 'category', label: t.category, type: 'select', value: prefill?.category ?? '', options: categoryOptions },
        kindField('expense'),
      ],
      onSave: (vals) => {
        const amount = parsePositiveNumber(vals.amount);
        if (vals.description.trim() && amount !== null) {
          setDailyTransactions([...dailyTransactions, {
            id: crypto.randomUUID(),
            date: dateStr,
            description: vals.description.trim(),
            amount,
            category: vals.category.trim() || undefined,
            categorySource: vals.category.trim() ? 'manual' : undefined,
            kind: vals.kind === 'income' ? 'income' : 'expense',
          }]);
          closeModal();
        } else {
          setModal(prev => prev ? { ...prev, error: !vals.description.trim() ? t.transactionDetails + ' er påkrevd' : t.impact + ' må være et positivt tall' } : null);
        }
      },
    });
  };

  const editDailyTransaction = (id: string, description: string, amount: number, category?: string, kind?: 'income' | 'expense', merchant?: string) => {
    openModal({
      title: description,
      fields: [
        { key: 'description', label: t.editDescription, type: 'text', value: description },
        { key: 'amount', label: t.editAmount, type: 'number', value: amount.toString() },
        { key: 'category', label: t.category, type: 'select', value: category ?? '', options: categoryOptions },
        kindField(kind === 'income' ? 'income' : 'expense'),
        { key: 'rememberRule', label: t.budgetPage.rememberRule, type: 'checkbox', value: 'false', hint: t.budgetPage.rememberRuleHint },
        { key: 'ruleMatch', label: t.budgetPage.ruleMatch, type: 'text', value: merchant || description },
      ],
      onSave: (vals) => {
        const newAmount = parsePositiveNumber(vals.amount);
        if (vals.description.trim() && newAmount !== null) {
          setDailyTransactions(dailyTransactions.map(tx => tx.id === id
            ? { ...tx, description: vals.description.trim(), amount: newAmount, category: vals.category.trim() || undefined, categorySource: vals.category.trim() ? 'manual' : undefined, kind: vals.kind === 'income' ? 'income' : 'expense' }
            : tx
          ));
          // Remember: create a rule so all matching rows (past + future) get this category.
          if (vals.rememberRule === 'true' && vals.ruleMatch.trim() && isCategoryKey(vals.category.trim())) {
            addCategoryRule(vals.ruleMatch.trim(), vals.category.trim() as CategoryKey);
          }
          closeModal();
        } else {
          setModal(prev => prev ? { ...prev, error: !vals.description.trim() ? t.editDescription + ' er påkrevd' : t.editAmount + ' må være et positivt tall' } : null);
        }
      },
    });
  };

  const removeDailyTransaction = (id: string, description: string) => {
    setPendingDelete({ type: 'transaction', id, name: description });
  };

  // --- CSV Export ---
  const exportCSV = () => {
    const monthStr = format(currentMonth, 'yyyy-MM');
    const monthTransactions = dailyTransactions.filter(tx => tx.date.startsWith(monthStr));
    const sorted = [...monthTransactions].sort((a, b) => a.date.localeCompare(b.date));

    const header = ['Date', 'Day', 'Description', 'Category', 'Amount'];
    const rows = sorted.map(tx => {
      const date = new Date(tx.date + 'T00:00:00');
      return [
        tx.date,
        t.days[date.getDay()],
        `"${tx.description.replace(/"/g, '""')}"`,
        tx.category ? `"${isCategoryKey(tx.category) ? t.categoryLabels[tx.category] : tx.category}"` : '',
        tx.amount.toString(),
      ];
    });

    const csv = [header, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `budget-${monthStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalSpentThisMonth = dailyData.reduce((sum, d) => sum + d.spent, 0);

  // The linked fixed-expense name covering a transaction's category, if any — used
  // to tag drawn-down transactions in the log so it's clear why they don't move the
  // daily balance. Returns undefined for income and non-enveloped spend.
  const envelopeNameFor = (tx: { category?: string; kind?: 'income' | 'expense' }): string | undefined => {
    if (tx.kind === 'income' || !isCategoryKey(tx.category)) return undefined;
    const env = reconciliation.byCategory.get(tx.category);
    if (!env) return undefined;
    return fixedExpenses.find(e => e.id === env.expenseIds[0])?.name;
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
  const today = new Date();
  const isCurrentMonth = isSameMonth(currentMonth, today);
  const isPast = currentMonth < startOfMonth(today);
  const incomeDiffPct = averageIncome > 0 ? ((effectiveIncome - averageIncome) / averageIncome) * 100 : 0;
  // Remind the user to set THIS month's income while it's still auto-calculated.
  // Only for the live month; dismissible, but the dismiss is keyed to the month
  // so it returns once a new month begins.
  const showIncomeReminder =
    isCurrentMonth && !isMonthlyIncomeOverridden && incomeReminderDismissedMonth !== monthKey;

  // Ledger honors the account filter (transfers stay visible but marked, so the
  // log remains a faithful record of what moved).
  const accountMatch = (tx: DailyTransaction) =>
    accountFilter == null || accountGroupKey(tx, accountLabels) === accountFilter;

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
              background: isCurrentMonth ? 'var(--positive-bg)' : isPast ? 'rgba(255,255,255,0.05)' : 'var(--violet-bg)',
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
          <button
            onClick={() => setPayslipOpen(true)}
            className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-[4px] transition-colors"
            style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
          >
            <FileUp size={12} /> {t.salary.importPayslip.button}
          </button>
        </div>
        <h1 className="font-serif text-4xl md:text-6xl font-medium leading-[1.05] tracking-[-0.01em]">
          {t.budgetPage.heroTitlePre}<em className="font-serif italic" style={{ color: 'var(--brass)' }}>{t.budgetPage.heroTitleEm}</em>{t.budgetPage.heroTitlePost}
        </h1>
        <p className="mt-3 text-[15px] leading-[1.55] max-w-2xl" style={{ color: 'var(--text-2)' }}>
          {`${t.budgetPage.incomeIntro}${formatCurrency(effectiveIncome)}${averageIncome > 0 && Object.keys(monthlyIncomes).length > 1 ? ` (${incomeDiffPct >= 0 ? '+' : ''}${incomeDiffPct.toFixed(1)}${t.budgetPage.vsAvgSuffix}` : ''}${t.budgetPage.incomeOutro}`}
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
              onClick={() => removePayslip(monthKey)}
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
            <button
              onClick={addFixedExpense}
              aria-label={`${t.add} — ${t.fixedCosts}`}
              className="text-[var(--accent)] hover:opacity-70 transition-opacity"
            >
              <PlusCircle size={18} strokeWidth={2} />
            </button>
          </div>
          {linkSuggestions.length > 0 && (
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
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {(Object.keys(EXPENSE_TYPE_COLOR) as ExpenseType[]).map(ty => (
              <span key={ty} className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-2)' }}>
                <span className="w-[7px] h-[7px] rounded-[2px]" style={{ background: EXPENSE_TYPE_COLOR[ty] }} />
                {t.expenseType[ty]}
              </span>
            ))}
          </div>
          <div className="space-y-0">
            {fixedExpenses.map((expense) => {
              // Envelope reconciliation, shown only for a linked expense that has
              // real spend this month (keeps the list quiet for non-syncers). When
              // several expenses share a category, the shared bar renders once,
              // under the first of them.
              const envelope = isCategoryKey(expense.category) ? reconciliation.byCategory.get(expense.category) : undefined;
              const showEnvelope = !!envelope && envelope.actual > 0 && envelope.expenseIds[0] === expense.id;
              return (
              <div key={expense.id} className="py-3 border-b border-[var(--border)] last:border-0">
                <div className="flex items-center justify-between group">
                  <button
                    type="button"
                    aria-label={`${t.edit} — ${expense.name}`}
                    className="flex items-center gap-2 text-[13px] font-medium text-[var(--text-1)] cursor-pointer hover:text-[var(--accent)] transition-colors min-w-0 text-left"
                    onClick={() => editFixedExpense(expense.id, expense.name, expense.amount, expense.type, expense.category)}
                  >
                    <span className="w-[7px] h-[7px] rounded-[2px] shrink-0" style={{ background: expenseColor(expense.type) }} />
                    <span className="truncate">{expense.name}</span>
                  </button>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      aria-label={`${t.edit} — ${expense.name}`}
                      className="text-[13px] font-mono font-medium text-[var(--text-1)] cursor-pointer hover:text-[var(--accent)] transition-colors"
                      onClick={() => editFixedExpense(expense.id, expense.name, expense.amount, expense.type, expense.category)}
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
                  </div>
                </div>
                {showEnvelope && <EnvelopeBar envelope={envelope} formatCurrency={formatCurrency} labels={{ left: t.envelopeLeft, over: t.envelopeOver }} />}
              </div>
              );
            })}
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
            <Suspense fallback={<div className="h-full w-full" />}>
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
          <CategoryBreakdown />

          {/* Multi-month spending trend by category */}
          <div className={`${sectionLabel} pt-5 pb-3 border-t border-[var(--border)]`}>
            {t.spendingTrend} · {t.trendMonths}
          </div>
          <CategoryTrendChart />

          {/* Per-category monthly budgets */}
          <div className="pt-5 border-t border-[var(--border)]">
            <CategoryBudgets />
          </div>
          <CategoryRules />
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
          <div className="flex-1 min-h-[240px] w-full">
            <Suspense fallback={<div className="h-full w-full" />}><SavingsRateChart /></Suspense>
          </div>
        </div>
        <div className={`${card} p-5 md:p-7`}>
          <div className="pb-4 mb-4 border-b border-[var(--border)]">
            <h2 className={sectionLabel}>{t.charts.heatmapTitle}</h2>
            <p className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>{t.charts.heatmapSub}</p>
          </div>
          <Suspense fallback={<div className="h-[240px] w-full" />}><SpendingHeatmap /></Suspense>
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
                onClick={exportCSV}
                className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors px-2 py-1 rounded-lg hover:bg-[var(--bg-elev)]"
              >
                <Download size={13} />
                <span className="hidden sm:inline">{t.exportCSV}</span>
              </button>
            )}
          </div>
        </div>

        {logOpen && (<>
        {/* Mobile */}
        <div className="md:hidden divide-y divide-[var(--border)]">
          {dailyData.map((day) => (
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

              {day.transactions.filter(accountMatch).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {day.transactions.filter(accountMatch).map((tx) => {
                    const coveredBy = envelopeNameFor(tx);
                    const isTransfer = internalTransferIds.has(tx.id);
                    return (
                    <span key={tx.id} title={isTransfer ? t.budgetPage.internalTransfer : coveredBy ? t.envelopeCovered.replace('{name}', coveredBy) : undefined} className={`inline-flex items-center gap-1.5 bg-[var(--bg-raised)] border border-[var(--border)] px-2.5 py-1 rounded-lg text-[12px] font-medium text-[var(--text-1)] ${isTransfer ? 'opacity-60' : ''}`}>
                      {tx.category && (
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: catColor(tx.category) }} />
                      )}
                      <span>{tx.description}</span>
                      {isTransfer && <ArrowLeftRight size={11} className="text-[var(--text-3)] shrink-0" aria-label={t.budgetPage.internalTransfer} />}
                      <AccountBadge tx={tx} size="xs" />
                      <span className={`font-mono ${coveredBy ? 'text-[var(--text-3)] line-through' : 'text-[var(--text-2)]'}`}>{formatCurrency(tx.amount)}</span>
                      {coveredBy && <Wallet size={11} className="text-[var(--accent)] shrink-0" aria-hidden />}
                      <button aria-label={`${t.edit} — ${tx.description}`} onClick={() => editDailyTransaction(tx.id, tx.description, tx.amount, tx.category, tx.kind, tx.merchant)} className="text-[var(--text-2)] hover:text-[var(--accent)]">
                        <Edit2 size={11} />
                      </button>
                      <button aria-label={`${t.delete} — ${tx.description}`} onClick={() => removeDailyTransaction(tx.id, tx.description)} className="text-[var(--text-2)] hover:text-[var(--negative)]">
                        <Trash2 size={11} />
                      </button>
                    </span>
                    );
                  })}
                </div>
              )}

              <button
                onClick={() => addDailyTransaction(day.dateStr)}
                className="flex items-center gap-1 text-[var(--accent)] text-[12px] font-medium"
              >
                <PlusCircle size={13} strokeWidth={2} />
                <span>{t.budgetPage.addShort}</span>
              </button>
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
                <th className="px-7 py-3.5">{t.timestamp}</th>
                <th className="px-7 py-3.5">{t.transactionDetails}</th>
                <th className="px-7 py-3.5 text-right">{t.impact}</th>
                <th className="px-7 py-3.5 text-right">{t.runningBalance}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {dailyData.map((day) => (
                <tr key={day.dateStr} className="hover:bg-[var(--bg-raised)] transition-colors group">
                  <td className="px-7 py-4">
                    <div className="font-mono font-medium text-[13px] text-[var(--text-1)]">{format(day.date, 'dd.MM.yyyy')}</div>
                    <div className="text-[11px] text-[var(--text-2)] mt-0.5">{t.days[day.date.getDay()]}</div>
                  </td>
                  <td className="px-7 py-4">
                    <div className="flex flex-wrap gap-2">
                      {day.transactions.filter(accountMatch).map((tx) => {
                        const coveredBy = envelopeNameFor(tx);
                        const isTransfer = internalTransferIds.has(tx.id);
                        return (
                        <span key={tx.id} title={isTransfer ? t.budgetPage.internalTransfer : coveredBy ? t.envelopeCovered.replace('{name}', coveredBy) : undefined} className={`inline-flex items-center gap-2 bg-[var(--bg-raised)] border border-[var(--border)] px-3 py-1.5 rounded-lg text-[12px] font-medium text-[var(--text-1)] ${isTransfer ? 'opacity-60' : ''}`}>
                          {tx.category && (
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: catColor(tx.category) }} />
                          )}
                          <span>{tx.description}</span>
                          {isTransfer && <ArrowLeftRight size={11} className="text-[var(--text-3)] shrink-0" aria-label={t.budgetPage.internalTransfer} />}
                          <AccountBadge tx={tx} size="xs" />
                          <span className={`font-mono ${coveredBy ? 'text-[var(--text-3)] line-through' : 'text-[var(--text-2)]'}`}>{formatCurrency(tx.amount)}</span>
                          {coveredBy && <Wallet size={11} className="text-[var(--accent)] shrink-0" aria-hidden />}
                          {tx.category && (
                            <span className="text-[10px] text-[var(--text-2)] hidden lg:inline">{isCategoryKey(tx.category) ? t.categoryLabels[tx.category] : tx.category}</span>
                          )}
                          <button aria-label={`${t.edit} — ${tx.description}`} onClick={() => editDailyTransaction(tx.id, tx.description, tx.amount, tx.category, tx.kind, tx.merchant)} className="text-[var(--text-2)] hover:text-[var(--accent)] transition-colors">
                            <Edit2 size={12} />
                          </button>
                          <button aria-label={`${t.delete} — ${tx.description}`} onClick={() => removeDailyTransaction(tx.id, tx.description)} className="text-[var(--text-2)] hover:text-[var(--negative)] transition-colors">
                            <Trash2 size={12} />
                          </button>
                        </span>
                        );
                      })}
                      <button
                        onClick={() => addDailyTransaction(day.dateStr)}
                        aria-label={t.add}
                        className="text-[var(--accent)] hover:opacity-70 p-1 transition-opacity"
                      >
                        <PlusCircle size={18} strokeWidth={2} />
                      </button>
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
                <td colSpan={2} className="px-7 py-5 text-right text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-2)]">{t.endPeriodSurplus}</td>
                <td className="px-7 py-5 text-right font-mono font-medium text-[13px] text-[var(--text-2)]">
                  {formatCurrency(totalSpentThisMonth)}
                </td>
                <td className="px-7 py-5 text-right">
                  <span className={`text-xl font-bold font-mono ${dailyData[dailyData.length - 1]?.balance >= 0 ? 'text-[var(--accent)]' : 'text-[var(--negative)]'}`}>
                    {formatCurrency(dailyData[dailyData.length - 1]?.balance || 0)}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        </>)}
      </div>

      {modal && <EditModal {...modal} onCancel={closeModal} />}
      {pendingDelete && (
        <ConfirmModal
          title={t.confirmDelete}
          message={pendingDelete.type === 'expense' ? t.confirmDeleteExpenseMsg : t.confirmDeleteTransactionMsg}
          confirmLabel={t.delete}
          cancelLabel={t.cancel}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      {payslipOpen && <PayslipImportModal onClose={() => setPayslipOpen(false)} />}
    </div>
  );
};


export default BudgetPage;
