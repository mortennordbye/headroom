import { useState, useRef, useEffect } from 'react';
import { AlertTriangle, TrendingUp, Edit2 } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useFinance } from '../context/FinanceContext';

const card = 'bg-[var(--bg-card)] rounded-[20px] border border-[var(--border)]';
const sectionLabel = 'text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-2)]';

interface EditablePillProps {
  label: string;
  value: number;
  color: 'sky' | 'emerald';
  formatCurrency: (v: number) => string;
  onCommit: (newValue: number) => void;
}

function EditablePill({ label, value, color, formatCurrency, onCommit }: EditablePillProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const bg = color === 'sky'
    ? 'bg-[var(--accent-bg)] border-[color-mix(in_srgb,var(--accent)_25%,transparent)]'
    : 'bg-[var(--positive-bg)] border-[color-mix(in_srgb,var(--positive)_25%,transparent)]';
  const valueColor = color === 'sky'
    ? 'text-sky-600'
    : 'text-emerald-600';
  const borderFocus = color === 'sky' ? 'border-sky-400' : 'border-emerald-400';

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
      className={`flex flex-col gap-1.5 rounded-xl border p-3 md:p-4 cursor-pointer ${bg}`}
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
          className={`text-[13px] md:text-[15px] font-bold font-mono bg-transparent border-b ${borderFocus} ${valueColor} outline-none w-full`}
        />
      ) : (
        <span className={`text-[13px] md:text-[15px] font-bold font-mono tracking-tight ${valueColor}`}>
          {formatCurrency(value)}
        </span>
      )}
    </div>
  );
}

export default function SmartRecommendations() {
  const {
    t,
    lang,
    averageIncome,
    totalFixedExpenses,
    recommendedSpending,
    recommendedInvestment,
    conservativeMode,
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
    setSavingsTargetPercent(((totalResidual - clamped) / totalResidual) * 100);
  };

  const handleInvestmentEdit = (newInvest: number) => {
    if (totalResidual <= 0) return;
    const clamped = Math.min(newInvest, totalResidual);
    setSavingsTargetPercent((clamped / totalResidual) * 100);
  };

  const totalSpentThisMonth = dailyData.reduce((s, d) => s + d.spent, 0);
  const spendingPct = recommendedSpending > 0
    ? Math.min(100, (totalSpentThisMonth / recommendedSpending) * 100)
    : 0;

  const recordedMonthCount = Object.keys(monthlyIncomes).length;

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayEntry = dailyData.find(d => d.dateStr === todayStr) ?? dailyData[dailyData.length - 1];
  const currentBalance = todayEntry?.balance ?? 0;

  const effectiveSavingsPct = conservativeMode
    ? Math.min(95, savingsTargetPercent + 10)
    : savingsTargetPercent;

  const pieData = [
    { name: t.fixedCosts, value: totalFixedExpenses, color: '#71717a' },
    { name: t.canSpend, value: recommendedSpending, color: '#0ea5e9' },
    { name: t.shouldInvest, value: recommendedInvestment, color: '#10b981' },
  ];
  const pieTotal = pieData.reduce((s, d) => s + d.value, 0);
  const slicePct = (v: number) => (pieTotal > 0 ? (v / pieTotal) * 100 : 0);
  const activeSlice = hoveredSlice !== null ? pieData[hoveredSlice] : null;

  return (
    <div className={`${card} p-5 md:p-7`}>
      {conservativeMode && (
        <div className="mb-4 flex items-center gap-2 border bg-[var(--warning-bg)] border-[color-mix(in_srgb,var(--warning)_30%,transparent)] rounded-xl px-4 py-2.5 text-[12px] text-[var(--warning)] font-medium">
          <AlertTriangle size={13} className="shrink-0" />
          <span>{t.conservativeWarning}</span>
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
              {t.avgIncome} ({recordedMonthCount} {lang === 'nb' ? 'mnd' : 'mo'}): {formatCurrency(averageIncome)}
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
                className="w-12 text-center text-[12px] font-bold font-mono bg-transparent border-b border-emerald-400 text-[var(--text-1)] outline-none"
              />
              <span className="text-[12px] font-bold text-[var(--text-1)]">%</span>
            </div>
          ) : (
            <button onClick={() => setEditingPct(true)} className="flex items-center gap-1 group">
              <span className="text-[13px] font-bold font-mono text-emerald-600">{effectiveSavingsPct}%</span>
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
            />
            <div className="flex flex-col gap-1.5 rounded-xl border p-3 md:p-4 bg-[var(--bg-raised)] border-[var(--border)]">
              <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-2)]">{t.residual}</span>
              <span className="text-[13px] md:text-[15px] font-bold font-mono tracking-tight text-[var(--text-1)]">{formatCurrency(currentBalance)}</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-[11px] text-[var(--text-2)]">
              <span>{lang === 'nb' ? 'Brukt' : 'Spent'}: {formatCurrency(totalSpentThisMonth)}</span>
              <span>{Math.round(spendingPct)}% {t.spentOfRecommended}</span>
            </div>
            <div className="h-2 bg-[var(--bg-elev)] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  spendingPct >= 100 ? 'bg-[#ef4444]' :
                  spendingPct >= 80 ? 'bg-amber-400' : 'bg-[#0ea5e9]'
                }`}
                style={{ width: `${Math.min(spendingPct, 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Right: donut chart */}
        <div className="w-full md:w-[200px] shrink-0">
          <div className="relative" style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={72}
                  paddingAngle={2}
                  dataKey="value"
                  strokeWidth={0}
                  onMouseEnter={(_: unknown, i: number) => setHoveredSlice(i)}
                  onMouseLeave={() => setHoveredSlice(null)}
                >
                  {pieData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.color}
                      opacity={hoveredSlice === null || hoveredSlice === i ? 1 : 0.3}
                      style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            {/* center label */}
            <div className="absolute inset-0 grid place-items-center text-center pointer-events-none">
              <div>
                <div className="text-[9px] uppercase tracking-[0.1em] text-[var(--text-3)] truncate max-w-[88px] mx-auto">
                  {activeSlice ? activeSlice.name : (lang === 'nb' ? 'Totalt' : 'Total')}
                </div>
                <div className="text-[15px] font-bold font-mono tracking-tight text-[var(--text-1)] mt-0.5">
                  {formatCurrencyShort(activeSlice ? activeSlice.value : pieTotal)}
                </div>
                {activeSlice && (
                  <div className="text-[11px] font-semibold tabular-nums mt-0.5" style={{ color: activeSlice.color }}>
                    {slicePct(activeSlice.value).toFixed(0)}%
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* Legend with shares */}
          <div className="flex flex-col gap-1.5 mt-2">
            {pieData.map((entry, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-2 cursor-pointer rounded-md px-1 py-0.5 transition-colors"
                style={{ background: hoveredSlice === i ? 'rgba(255,255,255,0.05)' : 'transparent' }}
                onMouseEnter={() => setHoveredSlice(i)}
                onMouseLeave={() => setHoveredSlice(null)}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                  <span className="text-[11px] text-[var(--text-2)] truncate">{entry.name}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 tabular-nums">
                  <span className="text-[11px] font-mono text-[var(--text-1)]">{formatCurrencyShort(entry.value)}</span>
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
