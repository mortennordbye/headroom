import React, { useState } from 'react';
import {
  PlusCircle,
  Trash2,
  Edit2,
  Download,
} from 'lucide-react';
import SmartRecommendations from '../components/SmartRecommendations';
import FunBudget from '../components/FunBudget';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
  PieChart,
  Pie,
  Legend,
} from 'recharts';
import { format, isSameMonth, startOfMonth } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance, type TransactionTemplate } from '../context/FinanceContext';
import EditModal, { type ModalField } from '../components/EditModal';
import ConfirmModal from '../components/ConfirmModal';

const CHART_COLORS = [
  '#6EE7FF', // accent
  '#3ECF8E', // positive
  '#FBBF24', // warning
  '#F472B6', // pink
  '#A78BFA', // violet
  '#34D399', // emerald
  '#F87171', // negative
  '#6E6E78', // text-3
];

const card = 'bg-[var(--bg-card)] rounded-[20px] border border-[var(--border)]';
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

  const openModal = (config: ModalConfig) => setModal(config);
  const closeModal = () => setModal(null);

  const totalFixedExpenses = fixedExpenses.reduce((sum, item) => sum + item.amount, 0);
  // Sort biggest-first so the distribution reads as a clean ranking.
  const sortedExpenses = [...fixedExpenses].sort((a, b) => b.amount - a.amount);

  // --- Validation helpers ---
  const parsePositiveNumber = (val: string): number | null => {
    const n = parseFloat(val);
    if (isNaN(n) || n < 0) return null;
    return n;
  };

  // --- Fixed Expenses ---
  const addFixedExpense = () => {
    openModal({
      title: t.fixedCosts,
      fields: [
        { key: 'name', label: t.newExpenseName, type: 'text', value: '', placeholder: 'Mat, Strøm...' },
        { key: 'amount', label: t.newAmount, type: 'number', value: '', placeholder: '0' },
      ],
      onSave: (vals) => {
        const amount = parsePositiveNumber(vals.amount);
        if (vals.name.trim() && amount !== null) {
          setFixedExpenses([...fixedExpenses, { id: crypto.randomUUID(), name: vals.name.trim(), amount }]);
          closeModal();
        } else {
          setModal(prev => prev ? { ...prev, error: !vals.name.trim() ? t.newExpenseName + ' er påkrevd' : t.newAmount + ' må være et positivt tall' } : null);
        }
      },
    });
  };

  const editFixedExpense = (id: string, name: string, amount: number) => {
    openModal({
      title: name,
      fields: [
        { key: 'name', label: t.editName, type: 'text', value: name },
        { key: 'amount', label: t.editAmount, type: 'number', value: amount.toString() },
      ],
      onSave: (vals) => {
        const newAmount = parsePositiveNumber(vals.amount);
        if (vals.name.trim() && newAmount !== null) {
          setFixedExpenses(fixedExpenses.map(e => e.id === id ? { ...e, name: vals.name.trim(), amount: newAmount } : e));
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
          }]);
          closeModal();
        } else {
          setModal(prev => prev ? { ...prev, error: !vals.description.trim() ? t.transactionDetails + ' er påkrevd' : t.impact + ' må være et positivt tall' } : null);
        }
      },
    });
  };

  const editDailyTransaction = (id: string, description: string, amount: number, category?: string) => {
    openModal({
      title: description,
      fields: [
        { key: 'description', label: t.editDescription, type: 'text', value: description },
        { key: 'amount', label: t.editAmount, type: 'number', value: amount.toString() },
        { key: 'category', label: t.category, type: 'text', value: category ?? '', placeholder: t.uncategorized },
      ],
      onSave: (vals) => {
        const newAmount = parsePositiveNumber(vals.amount);
        if (vals.description.trim() && newAmount !== null) {
          setDailyTransactions(dailyTransactions.map(tx => tx.id === id
            ? { ...tx, description: vals.description.trim(), amount: newAmount, category: vals.category.trim() || undefined }
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
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.1em]"
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
              className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full transition-colors"
              style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
            >
              → {t.today}
            </button>
          )}
        </div>
        <h1 className="text-3xl md:text-5xl font-normal leading-[1.05] tracking-[-0.03em]">
          {lang === 'nb' ? (
            <>Månedsbudsjettet <em className="font-serif italic" style={{ color: 'var(--accent)' }}>ditt</em>.</>
          ) : (
            <>Your monthly <em className="font-serif italic" style={{ color: 'var(--accent)' }}>budget</em>.</>
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
        <Card
          title={t.monthlyIncome}
          value={formatCurrency(effectiveIncome)}
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
        <Card title={t.monthlyBudget} value={formatCurrency(monthlyBudget)} accent />
        <Card title={t.dailyBudget} value={formatCurrency(dailyBudget)} />
        <Card title={t.fixedCosts} value={formatCurrency(totalFixedExpenses)} />
      </div>

      <SmartRecommendations />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 items-start">
        {/* Fixed Expenses */}
        <div className={`lg:col-span-1 ${card} p-5 md:p-7 space-y-5`}>
          <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
            <h2 className={sectionLabel}>{t.fixedCosts}</h2>
            <button
              onClick={addFixedExpense}
              className="text-[#0ea5e9] hover:opacity-70 transition-opacity"
            >
              <PlusCircle size={18} strokeWidth={2} />
            </button>
          </div>
          <div className="space-y-0">
            {fixedExpenses.map((expense) => (
              <div key={expense.id} className="flex items-center justify-between group py-3 border-b border-[var(--border)] last:border-0">
                <span
                  className="text-[13px] font-medium text-[var(--text-1)] cursor-pointer hover:text-[#0ea5e9] transition-colors"
                  onClick={() => editFixedExpense(expense.id, expense.name, expense.amount)}
                >
                  {expense.name}
                </span>
                <div className="flex items-center gap-3">
                  <span
                    className="text-[13px] font-mono font-medium text-[var(--text-1)] cursor-pointer hover:text-[#0ea5e9] transition-colors"
                    onClick={() => editFixedExpense(expense.id, expense.name, expense.amount)}
                  >
                    {formatCurrency(expense.amount)}
                  </span>
                  <button
                    onClick={() => removeFixedExpense(expense.id, expense.name)}
                    className="text-[var(--text-2)] hover:text-[#ef4444] sm:opacity-0 sm:group-hover:opacity-100 transition-all"
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
        <div className={`lg:col-span-2 ${card} p-5 md:p-7 space-y-5`}>
          <h2 className={`${sectionLabel} pb-4 border-b border-[var(--border)]`}>
            {t.distributionAnalysis}
          </h2>
          <div className="h-[280px] md:h-[340px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={sortedExpenses}
                layout="vertical"
                margin={{ top: 4, right: 60, left: 16, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.05)" />
                <XAxis type="number" hide />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={88}
                  tick={{ fontSize: 11, fill: '#9a9aa3', fontWeight: 500 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  content={({ active, payload }: any) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    const pct = totalFixedExpenses > 0 ? (d.amount / totalFixedExpenses) * 100 : 0;
                    return (
                      <div
                        className="rounded-[10px] px-3.5 py-2.5"
                        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}
                      >
                        <div className="text-[13px] font-semibold text-[var(--text-1)]">{d.name}</div>
                        <div className="text-[13px] font-mono text-[var(--text-2)] mt-0.5">{formatCurrency(d.amount)}</div>
                        <div className="text-[11px] text-[var(--text-3)] mt-1">
                          {pct.toFixed(1)}% {lang === 'nb' ? 'av faste utgifter' : 'of fixed costs'}
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="amount"
                  radius={[0, 6, 6, 0]}
                  barSize={12}
                  background={{ fill: 'rgba(255,255,255,0.04)', radius: 6 } as any}
                >
                  {sortedExpenses.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                  <LabelList
                    dataKey="amount"
                    position="right"
                    offset={10}
                    fill="#9a9aa3"
                    fontSize={11}
                    fontWeight={600}
                    formatter={(v: any) => formatCurrencyShort(Number(v ?? 0))}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Category pie chart — only shown when there's categorized data */}
          {categoryData.length > 0 && (
            <>
              <div className={`${sectionLabel} pt-2 pb-3 border-t border-[var(--border)]`}>
                {t.category} — {t.operationalLog}
              </div>
              <div className="h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      innerRadius={40}
                    >
                      {categoryData.map((entry, i) => (
                        <Cell key={i} fill={getCategoryColor(entry.name)} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => [formatCurrency(Number(value ?? 0)), '']}
                      contentStyle={{
                        borderRadius: '10px',
                        border: `1px solid ${'#2a2a2a'}`,
                        backgroundColor: 'var(--bg-card)',
                        color: 'var(--text-1)',
                        fontSize: '13px',
                      }}
                    />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      formatter={(value) => <span style={{ fontSize: '11px', color: '#737373' }}>{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      </div>

      <FunBudget />

      {/* Daily Tracker */}
      <div className={`${card} overflow-hidden`}>
        <div className="px-5 py-4 md:px-7 md:py-5 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className={sectionLabel}>{t.operationalLog}</h2>
          <div className="flex items-center gap-2">
            {totalSpentThisMonth > 0 && (
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
                    <span className="text-[12px] font-mono font-semibold text-[#ef4444]">−{formatCurrency(day.spent)}</span>
                  )}
                  <span className={`text-[12px] font-mono font-bold px-2 py-0.5 rounded-md ${
                    day.balance >= 0
                      ? 'bg-[var(--positive-bg)] text-[var(--positive)]'
                      : 'bg-red-50 text-[#ef4444]'
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
                      <button onClick={() => editDailyTransaction(tx.id, tx.description, tx.amount, tx.category)} className="text-[var(--text-2)] hover:text-[#0ea5e9]">
                        <Edit2 size={11} />
                      </button>
                      <button onClick={() => removeDailyTransaction(tx.id, tx.description)} className="text-[var(--text-2)] hover:text-[#ef4444]">
                        <Trash2 size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <button
                onClick={() => addDailyTransaction(day.dateStr)}
                className="flex items-center gap-1 text-[#0ea5e9] text-[12px] font-medium"
              >
                <PlusCircle size={13} strokeWidth={2} />
                <span>{lang === 'nb' ? 'Legg til' : 'Add'}</span>
              </button>
            </div>
          ))}

          <div className="p-4 flex justify-between items-center bg-[var(--bg-raised)]">
            <span className={sectionLabel}>{t.endPeriodSurplus}</span>
            <span className={`text-[15px] font-bold font-mono ${dailyData[dailyData.length - 1]?.balance >= 0 ? 'text-[#0ea5e9]' : 'text-[#ef4444]'}`}>
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
                          <button onClick={() => editDailyTransaction(tx.id, tx.description, tx.amount, tx.category)} className="text-[var(--text-2)] hover:text-[#0ea5e9] transition-colors">
                            <Edit2 size={12} />
                          </button>
                          <button onClick={() => removeDailyTransaction(tx.id, tx.description)} className="text-[var(--text-2)] hover:text-[#ef4444] transition-colors">
                            <Trash2 size={12} />
                          </button>
                        </span>
                      ))}
                      <button
                        onClick={() => addDailyTransaction(day.dateStr)}
                        className="text-[#0ea5e9] hover:opacity-70 p-1 transition-opacity"
                      >
                        <PlusCircle size={18} strokeWidth={2} />
                      </button>
                    </div>
                  </td>
                  <td className="px-7 py-4 text-[13px] font-mono font-medium text-right">
                    {day.spent > 0 ? (
                      <span className="text-[#ef4444]">−{formatCurrency(day.spent)}</span>
                    ) : (
                      <span className="text-[#e5e5e5]">—</span>
                    )}
                  </td>
                  <td className="px-7 py-4 text-right">
                    <span className={`text-[13px] font-mono font-bold px-2.5 py-1 rounded-md ${
                      day.balance >= 0
                        ? 'bg-[var(--positive-bg)] text-[var(--positive)]'
                        : 'bg-red-50 text-[#ef4444]'
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
                  <span className={`text-xl font-bold font-mono ${dailyData[dailyData.length - 1]?.balance >= 0 ? 'text-[#0ea5e9]' : 'text-[#ef4444]'}`}>
                    {formatCurrency(dailyData[dailyData.length - 1]?.balance || 0)}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
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
    </div>
  );
};

interface CardProps {
  title: string;
  value: string;
  sublabel?: React.ReactNode;
  accent?: boolean;
  editable?: boolean;
  onEdit?: () => void;
}

function Card({ title, value, sublabel, accent, editable, onEdit }: CardProps) {
  const accentStyle: React.CSSProperties = accent
    ? {
        background:
          'radial-gradient(circle at 90% 10%, color-mix(in srgb, var(--accent) 30%, transparent), transparent 60%), linear-gradient(135deg, color-mix(in srgb, var(--accent) 14%, transparent), color-mix(in srgb, var(--violet) 8%, transparent)), var(--bg-card)',
        borderColor: 'color-mix(in srgb, var(--accent) 25%, transparent)',
      }
    : { background: 'var(--bg-card)', borderColor: 'var(--border)' };

  return (
    <div
      className="p-5 md:p-6 rounded-[20px] border flex flex-col gap-3 transition-all hover:-translate-y-px"
      style={accentStyle}
    >
      <span
        className="text-[11px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: accent ? 'var(--accent)' : 'var(--text-3)' }}
      >
        {title}
      </span>
      <div className="flex items-baseline gap-2">
        <span
          className="text-[24px] md:text-[28px] font-semibold tracking-[-0.02em] leading-none tabular-nums"
          style={{ color: 'var(--text-1)' }}
        >
          {value}
        </span>
        {editable && (
          <button
            onClick={onEdit}
            className="p-1 rounded-md transition-colors"
            style={{ color: 'var(--text-3)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
            aria-label="Edit"
          >
            <Edit2 size={13} />
          </button>
        )}
      </div>
      {sublabel && (
        <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
          {sublabel}
        </div>
      )}
    </div>
  );
}

export default BudgetPage;
