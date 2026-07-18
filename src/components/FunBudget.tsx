import { Smile } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { ProgressBar } from './ui/ProgressBar';
import { Card } from './ui/Card';
import { SectionLabel } from './ui/SectionLabel';

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
        negative ? 'text-[var(--negative)]' :
        highlight ? 'text-[var(--negative)]' :
        'text-[var(--text-1)]'
      }`}>
        {negative ? '−' : ''}{value}
      </span>
    </div>
  );
}

export default function FunBudget() {
  const { t, reconciliation, formatCurrency } = useFinance();

  // Driven by the entertainment envelope (a fixed expense linked to the
  // canonical 'entertainment' category — see src/lib/envelopes.ts). Hidden
  // until such an envelope exists; spend is the envelope's month-to-date actual.
  const funEnvelope = reconciliation.byCategory.get('entertainment');

  if (!funEnvelope) return null;

  const funBudget = funEnvelope.budgeted;
  const funSpent = funEnvelope.actual;
  const funRemaining = funEnvelope.remaining;
  const pct = funBudget > 0 ? Math.min(100, (funSpent / funBudget) * 100) : 0;

  return (
    <Card padding="none" className="p-5 md:p-7">
      <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <Smile size={13} className="text-[var(--text-2)]" />
          <SectionLabel>{t.funBudget}</SectionLabel>
        </div>
        <span className="text-[11px] font-mono text-[var(--text-2)]">
          {t.categoryLabels.entertainment} — {formatCurrency(funBudget)}
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
        <ProgressBar
          pct={pct}
          heightClass="h-3"
          color={pct >= 100 ? 'var(--negative)' : pct >= 75 ? 'var(--brass)' : 'var(--positive)'}
        />
        <div className="flex justify-between text-[10px] text-[var(--text-2)]">
          <span>0</span>
          <span>{Math.round(pct)}% {t.common.used}</span>
          <span>{formatCurrency(funBudget)}</span>
        </div>
      </div>

      {funRemaining < 0 && (
        <div className="mt-3 text-[12px] text-[var(--negative)] font-medium">
          {t.funBudgetOverspent} {formatCurrency(Math.abs(funRemaining))}
        </div>
      )}

      {funSpent === 0 && (
        <p className="mt-3 text-[11px] text-[var(--text-2)]">
          {t.common.noFunSpending}
        </p>
      )}
    </Card>
  );
}
