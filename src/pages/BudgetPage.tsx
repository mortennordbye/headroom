import React, { useState, lazy, Suspense } from 'react';
import {
  PlusCircle,
  Trash2,
  Edit2,
  Download,
  FileUp,
  ChevronDown,
} from 'lucide-react';
import SmartRecommendations from '../components/SmartRecommendations';
import FunBudget from '../components/FunBudget';
import PayslipImportModal from '../components/PayslipImportModal';
import { format, isSameMonth, startOfMonth } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance, type TransactionTemplate, type ExpenseType } from '../context/FinanceContext';
import EditModal, { type ModalField } from '../components/EditModal';
import { parseLocaleNumber } from '../lib/validators';
import ConfirmModal from '../components/ConfirmModal';
import { StatCard } from '../components/ui/StatCard';

// Recharts (~150 KB gz) is lazy-loaded so it stays off the first-paint critical
// path of the default (Budget) route; it's precached after the first visit.
const BudgetDistributionChart = lazy(() => import('../components/BudgetDistributionChart'));
const SavingsRateChart = lazy(() => import('../components/charts/SavingsRateChart'));
const SpendingHeatmap = lazy(() => import('../components/charts/SpendingHeatmap'));

// Old-money category roles (concrete hex — recharts sets these as SVG attributes,
// which do not resolve CSS var()). Restricted to the 4 category hues + neutrals;
// no brass (reserved) and no decorative rainbow.
const CHART_COLORS = [
  '#3F7373', // teal
  '#5B7280', // slate
  '#1F5A42', // forest
  '#B5533A', // rust
  '#7FCBA0', // forest-light
  '#5F6555', // text-dim (→ "Annet")
];
// Fixed-expense type → role colour (matches the reference legend).
const EXPENSE_TYPE_COLOR: Record<ExpenseType, string> = {
  fixed: '#3F7373',        // teal — recurring/structural
  variable: '#1F5A42',     // forest — variable spend
  subscription: '#5B7280', // slate — subscriptions
  insurance: '#B5533A',    // rust — insurance
};
const expenseColor = (type?: ExpenseType) => EXPENSE_TYPE_COLOR[type ?? 'fixed'];

const card = 'bg-[var(--bg-card)] rounded-[8px] border border-[var(--border)]';
const sectionLabel = 'text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-2)] font-semibold';

function getCategoryColor(category: string): string {
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = ((hash << 5) - hash) + category.charCodeAt(i);
    hash |= 0;
  }
  return CHART_COLORS[Math.abs(hash) % CHART_COLORS.length];
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
    monthlyBudget,
    dailyBudget,
    fixedExpenses,
    setFixedExpenses,
    dailyData,
    dailyTransactions,
    setDailyTransactions,
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

  // --- Fixed Expenses ---
  const typeOptions = (Object.keys(EXPENSE_TYPE_COLOR) as ExpenseType[]).map(v => ({ value: v, label: t.expenseType[v] }));

  const addFixedExpense = () => {
    openModal({
      title: t.fixedCosts,
      fields: [
        { key: 'name', label: t.newExpenseName, type: 'text', value: '', placeholder: 'Mat, Strøm...' },
        { key: 'amount', label: t.newAmount, type: 'number', value: '', placeholder: '0' },
        { key: 'type', label: t.expenseTypeLabel, type: 'select', value: 'fixed', options: typeOptions },
      ],
      onSave: (vals) => {
        const amount = parsePositiveNumber(vals.amount);
        if (vals.name.trim() && amount !== null) {
          setFixedExpenses([...fixedExpenses, { id: crypto.randomUUID(), name: vals.name.trim(), amount, type: vals.type as ExpenseType }]);
          closeModal();
        } else {
          setModal(prev => prev ? { ...prev, error: !vals.name.trim() ? t.newExpenseName + ' er påkrevd' : t.newAmount + ' må være et positivt tall' } : null);
        }
      },
    });
  };

  const editFixedExpense = (id: string, name: string, amount: number, type?: ExpenseType) => {
    openModal({
      title: name,
      fields: [
        { key: 'name', label: t.editName, type: 'text', value: name },
        { key: 'amount', label: t.editAmount, type: 'number', value: amount.toString() },
        { key: 'type', label: t.expenseTypeLabel, type: 'select', value: type ?? 'fixed', options: typeOptions },
      ],
      onSave: (vals) => {
        const newAmount = parsePositiveNumber(vals.amount);
        if (vals.name.trim() && newAmount !== null) {
          setFixedExpenses(fixedExpenses.map(e => e.id === id ? { ...e, name: vals.name.trim(), amount: newAmount, type: vals.type as ExpenseType } : e));
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

  // --- Daily Transactions ---
  const addDailyTransaction = (dateStr: string, prefill?: Partial<TransactionTemplate>) => {
    openModal({
      title: format(new Date(dateStr + 'T00:00:00'), 'dd.MM.yyyy'),
      fields: [
        { key: 'description', label: t.transactionDetails, type: 'text', value: prefill?.description ?? '', placeholder: 'Dagligvare, Kaffe...' },
        { key: 'amount', label: t.impact, type: 'number', value: prefill?.amount?.toString() ?? '', placeholder: '0' },
        { key: 'category', label: t.category, type: 'text', value: prefill?.category ?? '', placeholder: t.uncategorized },
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
            kind: vals.kind === 'income' ? 'income' : 'expense',
          }]);
          closeModal();
        } else {
          setModal(prev => prev ? { ...prev, error: !vals.description.trim() ? t.transactionDetails + ' er påkrevd' : t.impact + ' må være et positivt tall' } : null);
        }
      },
    });
  };

  const editDailyTransaction = (id: string, description: string, amount: number, category?: string, kind?: 'income' | 'expense') => {
    openModal({
      title: description,
      fields: [
        { key: 'description', label: t.editDescription, type: 'text', value: description },
        { key: 'amount', label: t.editAmount, type: 'number', value: amount.toString() },
        { key: 'category', label: t.category, type: 'text', value: category ?? '', placeholder: t.uncategorized },
        kindField(kind === 'income' ? 'income' : 'expense'),
      ],
      onSave: (vals) => {
        const newAmount = parsePositiveNumber(vals.amount);
        if (vals.description.trim() && newAmount !== null) {
          setDailyTransactions(dailyTransactions.map(tx => tx.id === id
            ? { ...tx, description: vals.description.trim(), amount: newAmount, category: vals.category.trim() || undefined, kind: vals.kind === 'income' ? 'income' : 'expense' }
            : tx
          ));
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
        tx.category ? `"${tx.category}"` : '',
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

  // --- Category breakdown for pie chart ---
  const categoryData = (() => {
    const all = dailyData.flatMap(d => d.transactions).filter(tx => tx.category);
    const map: Record<string, number> = {};
    for (const tx of all) {
      map[tx.category!] = (map[tx.category!] ?? 0) + tx.amount;
    }
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  })();

  const totalSpentThisMonth = dailyData.reduce((sum, d) => sum + d.spent, 0);

  const dateLocale = lang === 'nb' ? nb : enUS;
  const monthLabel = format(currentMonth, 'MMMM yyyy', { locale: dateLocale });
  const monthKey = format(currentMonth, 'yyyy-MM');
  const monthPayslip = payslips[monthKey];
  const today = new Date();
  const isCurrentMonth = isSameMonth(currentMonth, today);
  const isPast = currentMonth < startOfMonth(today);
  const incomeDiffPct = averageIncome > 0 ? ((effectiveIncome - averageIncome) / averageIncome) * 100 : 0;

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
          {lang === 'nb' ? (
            <>Månedsbudsjettet <em className="font-serif italic" style={{ color: 'var(--brass)' }}>ditt</em>.</>
          ) : (
            <>Your monthly <em className="font-serif italic" style={{ color: 'var(--brass)' }}>budget</em>.</>
          )}
        </h1>
        <p className="mt-3 text-[15px] leading-[1.55] max-w-2xl" style={{ color: 'var(--text-2)' }}>
          {lang === 'nb'
            ? `Inntekt på ${formatCurrency(effectiveIncome)}${averageIncome > 0 && Object.keys(monthlyIncomes).length > 1 ? ` (${incomeDiffPct >= 0 ? '+' : ''}${incomeDiffPct.toFixed(1)}% vs snitt)` : ''}. Følg med på faste utgifter, daglige transaksjoner og hvor mye du kan bruke.`
            : `Income ${formatCurrency(effectiveIncome)}${averageIncome > 0 && Object.keys(monthlyIncomes).length > 1 ? ` (${incomeDiffPct >= 0 ? '+' : ''}${incomeDiffPct.toFixed(1)}% vs avg)` : ''}. Track fixed costs, daily spending, and what's left in your budget.`}
        </p>
      </header>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
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
                    {lang === 'nb' ? 'auto' : 'auto'}: {formatCurrency(derivedMonthlyIncome)}
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
                    {lang === 'nb' ? 'snitt' : 'avg'}: {formatCurrency(averageIncome)}
                  </span>
                </>
              )}
            </div>
          )}
          editable
          onEdit={() => openModal({
            title: t.monthlyIncome,
            fields: [{ key: 'income', label: t.editIncome, type: 'number', value: effectiveIncome.toString() }],
            onSave: (vals) => {
              const n = parsePositiveNumber(vals.income);
              if (n !== null) {
                const key = format(currentMonth, 'yyyy-MM');
                setMonthlyIncomeForMonth(key, n);
                closeModal();
              } else {
                setModal(prev => prev ? { ...prev, error: t.editAmount + ' må være et positivt tall' } : null);
              }
            },
          })}
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
              className="text-[11px] font-medium text-[var(--text-2)] hover:text-[#B5533A] transition-colors"
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
        <div className={`lg:col-span-1 ${card} p-5 md:p-7 space-y-5`}>
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
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {(Object.keys(EXPENSE_TYPE_COLOR) as ExpenseType[]).map(ty => (
              <span key={ty} className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-2)' }}>
                <span className="w-[7px] h-[7px] rounded-[2px]" style={{ background: EXPENSE_TYPE_COLOR[ty] }} />
                {t.expenseType[ty]}
              </span>
            ))}
          </div>
          <div className="space-y-0">
            {fixedExpenses.map((expense) => (
              <div key={expense.id} className="flex items-center justify-between group py-3 border-b border-[var(--border)] last:border-0">
                <button
                  type="button"
                  aria-label={`${t.edit} — ${expense.name}`}
                  className="flex items-center gap-2 text-[13px] font-medium text-[var(--text-1)] cursor-pointer hover:text-[var(--accent)] transition-colors min-w-0 text-left"
                  onClick={() => editFixedExpense(expense.id, expense.name, expense.amount, expense.type)}
                >
                  <span className="w-[7px] h-[7px] rounded-[2px] shrink-0" style={{ background: expenseColor(expense.type) }} />
                  <span className="truncate">{expense.name}</span>
                </button>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    aria-label={`${t.edit} — ${expense.name}`}
                    className="text-[13px] font-mono font-medium text-[var(--text-1)] cursor-pointer hover:text-[var(--accent)] transition-colors"
                    onClick={() => editFixedExpense(expense.id, expense.name, expense.amount, expense.type)}
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
            ))}
            <div className="pt-5 flex justify-between items-baseline">
              <span className={sectionLabel}>{t.aggregate}</span>
              <span className="text-xl font-bold font-mono text-[var(--text-1)]">{formatCurrency(totalFixedExpenses)}</span>
            </div>
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
                lang={lang}
              />
            </Suspense>
          </div>

          {/* Category breakdown — direct-labeled bar list (top 4 + "Annet"), no pie */}
          {categoryData.length > 0 && (() => {
            const sorted = [...categoryData].sort((a, b) => b.value - a.value);
            const head = sorted.slice(0, 4);
            const rest = sorted.slice(4);
            const rows = rest.length
              ? [...head, { name: lang === 'nb' ? 'Annet' : 'Other', value: rest.reduce((s, r) => s + r.value, 0) }]
              : head;
            const catTotal = rows.reduce((s, r) => s + r.value, 0);
            const isAnnet = (name: string) => name === 'Annet' || name === 'Other';
            return (
              <>
                <div className={`${sectionLabel} pt-2 pb-3 border-t border-[var(--border)]`}>
                  {t.category} — {t.operationalLog}
                </div>
                <div className="flex flex-col gap-3">
                  {rows.map((r, i) => {
                    const pct = catTotal > 0 ? (r.value / catTotal) * 100 : 0;
                    const color = isAnnet(r.name) ? '#5F6555' : getCategoryColor(r.name);
                    return (
                      <div key={i} className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-[12.5px]">
                          <span className="flex items-center gap-2 text-[var(--text-1)] min-w-0">
                            <span className="w-[7px] h-[7px] rounded-[2px] shrink-0" style={{ backgroundColor: color }} />
                            <span className="truncate">{r.name}</span>
                          </span>
                          <span className="font-mono text-[var(--text-2)] tabular-nums shrink-0">{formatCurrency(r.value)}</span>
                        </div>
                        <div className="h-1.5 rounded-[3px] bg-[var(--bg-raised)] overflow-hidden">
                          <div className="h-full rounded-[3px]" style={{ width: `${pct}%`, background: color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      </div>

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

              {day.transactions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {day.transactions.map((tx) => (
                    <span key={tx.id} className="inline-flex items-center gap-1.5 bg-[var(--bg-raised)] border border-[var(--border)] px-2.5 py-1 rounded-lg text-[12px] font-medium text-[var(--text-1)]">
                      {tx.category && (
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: getCategoryColor(tx.category) }} />
                      )}
                      <span>{tx.description}</span>
                      <span className="font-mono text-[var(--text-2)]">{formatCurrency(tx.amount)}</span>
                      <button aria-label={`${t.edit} — ${tx.description}`} onClick={() => editDailyTransaction(tx.id, tx.description, tx.amount, tx.category, tx.kind)} className="text-[var(--text-2)] hover:text-[var(--accent)]">
                        <Edit2 size={11} />
                      </button>
                      <button aria-label={`${t.delete} — ${tx.description}`} onClick={() => removeDailyTransaction(tx.id, tx.description)} className="text-[var(--text-2)] hover:text-[var(--negative)]">
                        <Trash2 size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <button
                onClick={() => addDailyTransaction(day.dateStr)}
                className="flex items-center gap-1 text-[var(--accent)] text-[12px] font-medium"
              >
                <PlusCircle size={13} strokeWidth={2} />
                <span>{lang === 'nb' ? 'Legg til' : 'Add'}</span>
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
                      {day.transactions.map((tx) => (
                        <span key={tx.id} className="inline-flex items-center gap-2 bg-[var(--bg-raised)] border border-[var(--border)] px-3 py-1.5 rounded-lg text-[12px] font-medium text-[var(--text-1)]">
                          {tx.category && (
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: getCategoryColor(tx.category) }} />
                          )}
                          <span>{tx.description}</span>
                          <span className="font-mono text-[var(--text-2)]">{formatCurrency(tx.amount)}</span>
                          {tx.category && (
                            <span className="text-[10px] text-[var(--text-2)] hidden lg:inline">{tx.category}</span>
                          )}
                          <button aria-label={`${t.edit} — ${tx.description}`} onClick={() => editDailyTransaction(tx.id, tx.description, tx.amount, tx.category, tx.kind)} className="text-[var(--text-2)] hover:text-[var(--accent)] transition-colors">
                            <Edit2 size={12} />
                          </button>
                          <button aria-label={`${t.delete} — ${tx.description}`} onClick={() => removeDailyTransaction(tx.id, tx.description)} className="text-[var(--text-2)] hover:text-[var(--negative)] transition-colors">
                            <Trash2 size={12} />
                          </button>
                        </span>
                      ))}
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
