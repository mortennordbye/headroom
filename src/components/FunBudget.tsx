import { Smile } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';

const card = 'bg-white dark:bg-[#1a1a1a] rounded-2xl border border-[#e5e5e5] dark:border-[#2a2a2a] shadow-[0_1px_4px_rgba(0,0,0,0.06)] dark:shadow-none';
const sectionLabel = 'text-[11px] font-medium uppercase tracking-[0.1em] text-[#737373]';

interface FunStatProps {
  label: string;
  value: string;
  negative?: boolean;
  highlight?: boolean;
}

function FunStat({ label, value, negative, highlight }: FunStatProps) {
  return (
    <div className="flex flex-col gap-1.5 bg-[#fafafa] dark:bg-[#222222] border border-[#e5e5e5] dark:border-[#2a2a2a] rounded-xl p-3 md:p-4">
      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#737373]">{label}</span>
      <span className={`text-[13px] md:text-[15px] font-bold font-mono tracking-tight ${
        negative ? 'text-[#ef4444]' :
        highlight ? 'text-[#ef4444]' :
        'text-[#0a0a0a] dark:text-[#fafafa]'
      }`}>
        {negative ? '−' : ''}{value}
      </span>
    </div>
  );
}

export default function FunBudget() {
  const { t, lang, fixedExpenses, dailyData, formatCurrency } = useFinance();

  const funExpense = fixedExpenses.find(e =>
    ['fun', 'moro'].includes(e.name.toLowerCase())
  );

  if (!funExpense) return null;

  const funBudget = funExpense.amount;
  const funSpent = dailyData
    .flatMap(d => d.transactions)
    .filter(tx => tx.category && ['fun', 'moro'].includes(tx.category.toLowerCase()))
    .reduce((s, tx) => s + tx.amount, 0);
  const funRemaining = funBudget - funSpent;
  const pct = funBudget > 0 ? Math.min(100, (funSpent / funBudget) * 100) : 0;

  return (
    <div className={`${card} p-5 md:p-7`}>
      <div className="flex items-center justify-between pb-4 border-b border-[#f0f0f0] dark:border-[#222222]">
        <div className="flex items-center gap-2">
          <Smile size={13} className="text-[#737373]" />
          <h2 className={sectionLabel}>{t.funBudget}</h2>
        </div>
        <span className="text-[11px] font-mono text-[#737373]">
          {funExpense.name} — {formatCurrency(funBudget)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 md:gap-3 mt-4">
        <FunStat label={t.funBudgetAllocated} value={formatCurrency(funBudget)} />
        <FunStat
          label={t.funBudgetSpent}
          value={formatCurrency(funSpent)}
          highlight={funSpent > funBudget}
        />
        <FunStat
          label={t.funBudgetRemaining}
          value={formatCurrency(Math.abs(funRemaining))}
          negative={funRemaining < 0}
        />
      </div>

      <div className="mt-5 space-y-1.5">
        <div className="h-3 bg-[#f0f0f0] dark:bg-[#222222] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              pct >= 100 ? 'bg-[#ef4444]' :
              pct >= 75 ? 'bg-amber-400' :
              'bg-[#10b981]'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-[#737373]">
          <span>0</span>
          <span>{Math.round(pct)}% {lang === 'nb' ? 'brukt' : 'used'}</span>
          <span>{formatCurrency(funBudget)}</span>
        </div>
      </div>

      {funRemaining < 0 && (
        <div className="mt-3 text-[12px] text-[#ef4444] font-medium">
          {t.funBudgetOverspent} {formatCurrency(Math.abs(funRemaining))}
        </div>
      )}

      {funSpent === 0 && (
        <p className="mt-3 text-[11px] text-[#737373]">
          {lang === 'nb'
            ? 'Ingen morsomme utgifter enda. Legg til transaksjoner med kategori "Fun" for å spore dem her.'
            : 'No fun spending yet. Add transactions with category "Fun" to track them here.'}
        </p>
      )}
    </div>
  );
}
