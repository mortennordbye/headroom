import { Smile } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';

const card = 'bg-[var(--bg-card)] rounded-[8px] border border-[var(--border)]';
const sectionLabel = 'text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-2)]';

interface FunStatProps {
  label: string;
  value: string;
  negative?: boolean;
  highlight?: boolean;
}

function FunStat({ label, value, negative, highlight }: FunStatProps) {
  return (
    <div className="flex flex-col gap-1.5 bg-[var(--bg-raised)] border border-[var(--border)] rounded-[8px] p-3 md:p-4">
      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-2)]">{label}</span>
      <span className={`text-[13px] md:text-[15px] font-bold font-mono tracking-tight ${
        negative ? 'text-[#B5533A]' :
        highlight ? 'text-[#B5533A]' :
        'text-[var(--text-1)]'
      }`}>
        {negative ? '−' : ''}{value}
      </span>
    </div>
  );
}

export default function FunBudget() {
  const { t, fixedExpenses, dailyData, formatCurrency } = useFinance();

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
      <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <Smile size={13} className="text-[var(--text-2)]" />
          <h2 className={sectionLabel}>{t.funBudget}</h2>
        </div>
        <span className="text-[11px] font-mono text-[var(--text-2)]">
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
        <div className="h-3 bg-[var(--bg-elev)] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              pct >= 100 ? 'bg-[#B5533A]' :
              pct >= 75 ? 'bg-[var(--brass)]' :
              'bg-[#7FCBA0]'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-[var(--text-2)]">
          <span>0</span>
          <span>{Math.round(pct)}% {t.common.used}</span>
          <span>{formatCurrency(funBudget)}</span>
        </div>
      </div>

      {funRemaining < 0 && (
        <div className="mt-3 text-[12px] text-[#B5533A] font-medium">
          {t.funBudgetOverspent} {formatCurrency(Math.abs(funRemaining))}
        </div>
      )}

      {funSpent === 0 && (
        <p className="mt-3 text-[11px] text-[var(--text-2)]">
          {t.common.noFunSpending}
        </p>
      )}
    </div>
  );
}
