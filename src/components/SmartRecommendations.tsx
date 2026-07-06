import { useState, useRef, useEffect } from 'react';
import { AlertTriangle, TrendingUp, Edit2 } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';

const card = 'bg-[var(--bg-card)] rounded-[8px] border border-[var(--border)]';
const sectionLabel = 'text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-2)]';

// Category roles (shared by the pills, allocation strip and legend).
const ROLE_FIXED = 'var(--teal)';
const ROLE_SPEND = 'var(--forest-light)';
const ROLE_INVEST = 'var(--slate)';

interface EditablePillProps {
  label: string;
  value: number;
  color: 'sky' | 'emerald';
  formatCurrency: (v: number) => string;
  onCommit: (newValue: number) => void;
  hint?: string;
}

function EditablePill({ label, value, color, formatCurrency, onCommit, hint }: EditablePillProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 'sky' = "kan bruke" (forest-light), 'emerald' = "investering" (slate).
  const roleColor = color === 'sky' ? ROLE_SPEND : ROLE_INVEST;
  const bg = 'bg-[var(--bg-raised)] border-[var(--border)]';

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const startEditing = () => {
    setDraft(Math.round(value).toString());
    setEditing(true);
  };

  const commit = () => {
    const n = parseFloat(draft);
    if (!isNaN(n) && n >= 0) onCommit(n);
    setEditing(false);
  };

  return (
    <div
      className={`flex flex-col gap-1.5 rounded-[6px] border p-3 md:p-4 cursor-pointer ${bg}`}
      onClick={() => { if (!editing) startEditing(); }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-2)]">{label}</span>
        <Edit2 size={11} className="opacity-40 hover:opacity-100 transition-opacity text-[var(--text-2)]" />
      </div>
      {editing ? (
        <input
          ref={inputRef}
          type="number"
          min={0}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          className="text-[13px] md:text-[15px] font-bold font-mono bg-transparent border-b outline-none w-full"
          style={{ color: roleColor, borderColor: roleColor }}
        />
      ) : (
        <span className="text-[13px] md:text-[15px] font-bold font-mono tracking-tight" style={{ color: roleColor }}>
          {formatCurrency(value)}
        </span>
      )}
      {hint && (
        <span className="text-[10px] text-[var(--warning)] leading-tight">{hint}</span>
      )}
    </div>
  );
}

export default function SmartRecommendations() {
  const {
    t,
    averageIncome,
    totalFixedExpenses,
    recommendedSpending,
    recommendedInvestment,
    suggestedInvestment,
    conservativeMode,
    conservativeReason,
    monthlyIncomes,
    savingsTargetPercent,
    setSavingsTargetPercent,
    dailyData,
    formatCurrency,
    formatCurrencyShort,
    totalResidual,
  } = useFinance();

  const [editingPct, setEditingPct] = useState(false);
  const [pctDraft, setPctDraft] = useState('');
  const [hoveredSlice, setHoveredSlice] = useState<number | null>(null);
  const pctInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingPct) {
      // Seed the draft from the live value when entering edit mode, then select it.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPctDraft(savingsTargetPercent.toString());
      setTimeout(() => pctInputRef.current?.select(), 0);
    }
  }, [editingPct, savingsTargetPercent]);

  const commitPct = () => {
    const n = parseFloat(pctDraft);
    if (!isNaN(n) && n >= 0 && n <= 100) setSavingsTargetPercent(n);
    setEditingPct(false);
  };

  const handleSpendingEdit = (newSpending: number) => {
    if (totalResidual <= 0) return;
    const clamped = Math.min(newSpending, totalResidual);
    setSavingsTargetPercent(Math.round(((totalResidual - clamped) / totalResidual) * 100));
  };

  const handleInvestmentEdit = (newInvest: number) => {
    if (totalResidual <= 0) return;
    const clamped = Math.min(newInvest, totalResidual);
    setSavingsTargetPercent(Math.round((clamped / totalResidual) * 100));
  };

  const totalSpentThisMonth = dailyData.reduce((s, d) => s + d.spent, 0);
  const spendingPct = recommendedSpending > 0
    ? Math.min(100, (totalSpentThisMonth / recommendedSpending) * 100)
    : 0;

  const recordedMonthCount = Object.keys(monthlyIncomes).length;

  // Money still left this month after fixed costs and what's actually been spent
  // (income − fixed − spent). A true monthly balance that falls as you spend —
  // not a daily-accrual tracker, and not the plan's unallocated remainder (which
  // is ~0, since recommended spend + invest already split the whole residual).
  const budgetBalance = Math.round(totalResidual - totalSpentThisMonth);

  const pieData = [
    { name: t.fixedCosts, value: totalFixedExpenses, color: ROLE_FIXED },
    { name: t.canSpend, value: recommendedSpending, color: ROLE_SPEND },
    { name: t.shouldInvest, value: recommendedInvestment, color: ROLE_INVEST },
  ];
  const pieTotal = pieData.reduce((s, d) => s + d.value, 0);
  const slicePct = (v: number) => (pieTotal > 0 ? (v / pieTotal) * 100 : 0);

  return (
    <div data-tour="budget-plan" className={`${card} p-5 md:p-7`}>
      {conservativeMode && (
        <div className="mb-4 flex items-center gap-2 border bg-[var(--warning-bg)] border-[color-mix(in_srgb,var(--warning)_30%,transparent)] rounded-[6px] px-4 py-2.5 text-[12px] text-[var(--warning)] font-medium">
          <AlertTriangle size={13} className="shrink-0" />
          <span>{conservativeReason === 'volatility' ? t.volatileIncomeWarning : t.conservativeWarning}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between pb-4 border-b border-[var(--border)]">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp size={13} className="text-[var(--text-2)]" />
            <h2 className={sectionLabel}>{t.smartRecommendations}</h2>
          </div>
          {recordedMonthCount > 0 && (
            <p className="text-[11px] text-[var(--text-2)] mt-1 ml-5">
              {t.avgIncome} ({recordedMonthCount} {t.common.moAbbr}): {formatCurrency(averageIncome)}
            </p>
          )}
        </div>

        {/* Savings % badge */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-2)]">{t.savingsTarget}</span>
          {editingPct ? (
            <div className="flex items-center gap-1">
              <input
                ref={pctInputRef}
                type="number"
                min={0}
                max={100}
                value={pctDraft}
                onChange={e => setPctDraft(e.target.value)}
                onBlur={commitPct}
                onKeyDown={e => { if (e.key === 'Enter') commitPct(); if (e.key === 'Escape') setEditingPct(false); }}
                className="w-12 text-center text-[12px] font-bold font-mono bg-transparent border-b border-[var(--forest-light)] text-[var(--text-1)] outline-none"
              />
              <span className="text-[12px] font-bold text-[var(--text-1)]">%</span>
            </div>
          ) : (
            <button onClick={() => setEditingPct(true)} className="flex items-center gap-1 group">
              <span className="text-[13px] font-bold font-mono text-[var(--forest-light)]">{Math.round(savingsTargetPercent)}%</span>
              <Edit2 size={11} className="text-[var(--text-2)] opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )}
        </div>
      </div>

      {/* Main content: stats + chart */}
      <div className="mt-4 flex flex-col md:flex-row gap-4 md:gap-6 items-start">
        {/* Left: pills + progress */}
        <div className="flex-1 space-y-4 min-w-0">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 md:gap-3">
            <EditablePill
              label={t.canSpend}
              value={recommendedSpending}
              color="sky"
              formatCurrency={formatCurrency}
              onCommit={handleSpendingEdit}
            />
            <EditablePill
              label={t.shouldInvest}
              value={recommendedInvestment}
              color="emerald"
              formatCurrency={formatCurrency}
              onCommit={handleInvestmentEdit}
              hint={conservativeMode && suggestedInvestment > recommendedInvestment
                ? `${t.common.recommended}: ${formatCurrency(suggestedInvestment)}`
                : undefined}
            />
            <div className="flex flex-col gap-1.5 rounded-[8px] border p-3 md:p-4 bg-[var(--bg-raised)] border-[var(--border)]">
              <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-2)]">{t.residual}</span>
              <span
                className="text-[13px] md:text-[15px] font-bold font-mono tracking-tight"
                style={{ color: budgetBalance < 0 ? 'var(--negative)' : 'var(--text-1)' }}
              >
                {formatCurrency(budgetBalance)}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-[11px] text-[var(--text-2)]">
              <span>{t.common.spent}: {formatCurrency(totalSpentThisMonth)}</span>
              <span>{Math.round(spendingPct)}% {t.spentOfRecommended}</span>
            </div>
            <div className="h-2 bg-[var(--bg-elev)] rounded-[3px] overflow-hidden">
              <div
                className={`h-full rounded-[3px] transition-all duration-500 ${
                  spendingPct >= 100 ? 'bg-[var(--rust)]' :
                  spendingPct >= 80 ? 'bg-[var(--brass)]' : 'bg-[var(--forest-light)]'
                }`}
                style={{ width: `${Math.min(spendingPct, 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Right: allocation strip + legend (replaces the donut) */}
        <div className="w-full md:w-[240px] shrink-0">
          <div className="flex items-baseline justify-between text-[10px] uppercase tracking-[0.1em] text-[var(--text-3)] mb-2">
            <span>{t.common.allocation}</span>
            <span className="font-mono">{formatCurrencyShort(pieTotal)}</span>
          </div>
          <div className="flex h-[30px] rounded-[4px] overflow-hidden border border-[var(--rule)]">
            {pieData.map((entry, i) => {
              const pct = slicePct(entry.value);
              if (pct <= 0) return null;
              return (
                <div
                  key={i}
                  className="flex items-center justify-center font-mono text-[10px] transition-opacity"
                  style={{
                    width: `${pct}%`,
                    background: entry.color,
                    color: '#0E1310',
                    opacity: hoveredSlice === null || hoveredSlice === i ? 1 : 0.4,
                  }}
                  onMouseEnter={() => setHoveredSlice(i)}
                  onMouseLeave={() => setHoveredSlice(null)}
                >
                  {pct >= 10 ? `${pct.toFixed(0)}%` : ''}
                </div>
              );
            })}
          </div>
          {/* Legend with shares */}
          <div className="flex flex-col gap-2 mt-4">
            {pieData.map((entry, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-2 cursor-pointer transition-opacity"
                style={{ opacity: hoveredSlice === null || hoveredSlice === i ? 1 : 0.4 }}
                onMouseEnter={() => setHoveredSlice(i)}
                onMouseLeave={() => setHoveredSlice(null)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-[9px] h-[9px] rounded-[2px] shrink-0" style={{ backgroundColor: entry.color }} />
                  <span className="text-[12px] text-[var(--text-2)] truncate">{entry.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 tabular-nums">
                  <span className="text-[12px] font-mono text-[var(--text-1)]">{formatCurrencyShort(entry.value)}</span>
                  <span className="text-[10px] text-[var(--text-3)] w-8 text-right">{slicePct(entry.value).toFixed(0)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
