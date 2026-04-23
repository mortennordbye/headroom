import { useState, useRef, useEffect } from 'react';
import { AlertTriangle, TrendingUp, Edit2 } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { useFinance } from '../context/FinanceContext';

const card = 'bg-white dark:bg-[#1a1a1a] rounded-2xl border border-[#e5e5e5] dark:border-[#2a2a2a] shadow-[0_1px_4px_rgba(0,0,0,0.06)] dark:shadow-none';
const sectionLabel = 'text-[11px] font-medium uppercase tracking-[0.1em] text-[#737373]';

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
    ? 'bg-sky-50 dark:bg-sky-950/20 border-sky-100 dark:border-sky-900/40'
    : 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/40';
  const valueColor = color === 'sky'
    ? 'text-sky-600 dark:text-sky-400'
    : 'text-emerald-600 dark:text-emerald-400';
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
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#737373]">{label}</span>
        <Edit2 size={11} className="opacity-40 hover:opacity-100 transition-opacity text-[#737373]" />
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
    totalResidual,
  } = useFinance();

  const [editingPct, setEditingPct] = useState(false);
  const [pctDraft, setPctDraft] = useState('');
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
    { name: t.fixedCosts, value: totalFixedExpenses, color: '#404040' },
    { name: t.canSpend, value: recommendedSpending, color: '#0ea5e9' },
    { name: t.shouldInvest, value: recommendedInvestment, color: '#10b981' },
  ];

  return (
    <div className={`${card} p-5 md:p-7`}>
      {conservativeMode && (
        <div className="mb-4 flex items-center gap-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-xl px-4 py-2.5 text-[12px] text-amber-700 dark:text-amber-400 font-medium">
          <AlertTriangle size={13} className="shrink-0" />
          <span>{t.conservativeWarning}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between pb-4 border-b border-[#f0f0f0] dark:border-[#222222]">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp size={13} className="text-[#737373]" />
            <h2 className={sectionLabel}>{t.smartRecommendations}</h2>
          </div>
          {recordedMonthCount > 0 && (
            <p className="text-[11px] text-[#737373] mt-1 ml-5">
              {t.avgIncome} ({recordedMonthCount} {lang === 'nb' ? 'mnd' : 'mo'}): {formatCurrency(averageIncome)}
            </p>
          )}
        </div>

        {/* Savings % badge */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#737373]">{t.savingsTarget}</span>
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
                className="w-12 text-center text-[12px] font-bold font-mono bg-transparent border-b border-emerald-400 text-[#0a0a0a] dark:text-[#fafafa] outline-none"
              />
              <span className="text-[12px] font-bold text-[#0a0a0a] dark:text-[#fafafa]">%</span>
            </div>
          ) : (
            <button onClick={() => setEditingPct(true)} className="flex items-center gap-1 group">
              <span className="text-[13px] font-bold font-mono text-emerald-600 dark:text-emerald-400">{effectiveSavingsPct}%</span>
              <Edit2 size={11} className="text-[#737373] opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )}
        </div>
      </div>

      {/* Main content: stats + chart */}
      <div className="mt-4 flex flex-col md:flex-row gap-4 md:gap-6 items-start">
        {/* Left: pills + progress */}
        <div className="flex-1 space-y-4 min-w-0">
          <div className="grid grid-cols-3 gap-2 md:gap-3">
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
            <div className="flex flex-col gap-1.5 rounded-xl border p-3 md:p-4 bg-[#fafafa] dark:bg-[#222222] border-[#e5e5e5] dark:border-[#2a2a2a]">
              <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#737373]">{t.residual}</span>
              <span className="text-[13px] md:text-[15px] font-bold font-mono tracking-tight text-[#0a0a0a] dark:text-[#fafafa]">{formatCurrency(currentBalance)}</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-[11px] text-[#737373]">
              <span>{lang === 'nb' ? 'Brukt' : 'Spent'}: {formatCurrency(totalSpentThisMonth)}</span>
              <span>{Math.round(spendingPct)}% {t.spentOfRecommended}</span>
            </div>
            <div className="h-2 bg-[#f0f0f0] dark:bg-[#222222] rounded-full overflow-hidden">
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

        {/* Right: pie chart */}
        <div className="w-full md:w-[200px] shrink-0">
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={72}
                paddingAngle={2}
                dataKey="value"
                strokeWidth={0}
              >
                {pieData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => formatCurrency(Number(value))}
                contentStyle={{
                  background: 'var(--tooltip-bg, #1a1a1a)',
                  border: '1px solid #2a2a2a',
                  borderRadius: '10px',
                  fontSize: '11px',
                  color: '#fafafa',
                }}
                itemStyle={{ color: '#fafafa' }}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* Legend */}
          <div className="flex flex-col gap-1 mt-1">
            {pieData.map((entry, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                <span className="text-[10px] text-[#737373] truncate">{entry.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
