// What was actually spent this month, measured against the budget's can-spend
// figure. Lives BELOW the bank divider on purpose.
//
// This is the only place the two worlds are compared, and it says so on its face:
// the plan figure is labelled as the plan, the spend as actual. Both used to sit in
// the "Smarte anbefalinger" card above as a bare "Budsjettbalanse" plus a progress
// bar, where a single imported transfer silently moved numbers the user reads as
// their own budget.
//
// Spend is `currentMonthSpending` — the envelope-aware, transfer-netted discretionary
// figure the vs-last-month chip also uses, so the two can never disagree.
import React from 'react';
import { useFinance } from '../context/FinanceContext';
import { Card } from './ui/Card';
import { ProgressBar } from './ui/ProgressBar';

const SpendVsPlan: React.FC = () => {
  const { t, formatCurrency, currentMonthSpending, recommendedSpending } = useFinance();

  const spent = Math.round(currentMonthSpending);
  const plan = Math.round(recommendedSpending);
  const remaining = plan - spent;
  // No plan to measure against (income ≤ fixed costs) → show the spend alone rather
  // than dividing by zero.
  const pct = plan > 0 ? Math.min(100, (spent / plan) * 100) : 0;
  const over = remaining < 0;

  return (
    <Card padding="none" className="p-5 md:p-7 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-2)]">
            {t.budgetPage.actualSpentThisMonth}
          </span>
          <span className="text-[22px] md:text-[26px] font-bold font-mono tracking-tight text-[var(--text-1)]">
            {formatCurrency(spent)}
          </span>
        </div>
        <div className="flex flex-col gap-1 md:items-end">
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-2)]">
            {t.budgetPage.againstPlan}
          </span>
          <span className="text-[15px] font-mono text-[var(--text-2)]">{formatCurrency(plan)}</span>
        </div>
      </div>

      {plan > 0 && (
        <div className="space-y-2">
          <ProgressBar
            pct={pct}
            square
            color={pct >= 100 ? 'var(--rust)' : pct >= 80 ? 'var(--brass)' : 'var(--forest-light)'}
          />
          <div className="flex justify-between text-[11px] text-[var(--text-2)]">
            <span>{Math.round(pct)}% {t.spentOfRecommended}</span>
            <span style={{ color: over ? 'var(--negative)' : 'var(--text-2)' }}>
              {over
                ? `${formatCurrency(Math.abs(remaining))} ${t.budgetPage.overPlan}`
                : `${formatCurrency(remaining)} ${t.budgetPage.leftOfPlan}`}
            </span>
          </div>
        </div>
      )}
    </Card>
  );
};

export default SpendVsPlan;
