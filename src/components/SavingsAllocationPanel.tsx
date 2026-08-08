import React, { useMemo, useState } from 'react';
import { ChevronDown, Plus, Trash2, Wand2 } from 'lucide-react';
import { useFinance, type ExpenseDestinationKind } from '../context/FinanceContext';
import { Card } from './ui/Card';
import { SectionLabel } from './ui/SectionLabel';
import { Button } from './ui/Button';
import { resolveAllocation, isCreatableRow, destinationKey, type AllocationRow } from '../lib/savingsAllocation';
import { currentMonthKey } from '../lib/date';

// Turns the savings target (residual × savingsTargetPercent) into a per-destination
// plan, and — on an explicit click — into the fixed expenses that make it real.
//
// The plan itself never moves money. Creating the expenses is what activates it,
// and from there the ordinary automation runner posts them monthly. That keeps a
// single path to any balance change, and keeps the amounts inside the budget
// where the savings-rate math can already see them.

const selectCls = 'appearance-none cursor-pointer bg-[var(--bg-raised)] border border-[var(--border)] rounded-[9px] pl-3 pr-8 py-2 text-[13px] text-[var(--text-1)] outline-none focus:border-[var(--forest)] transition-colors';
const pctInputCls = 'w-[68px] bg-[var(--bg-raised)] border border-[var(--border)] rounded-[9px] px-2.5 py-2 text-[13px] font-mono tabular-nums text-right text-[var(--text-1)] outline-none focus:border-[var(--forest)] transition-colors';

export const SavingsAllocationPanel: React.FC = () => {
  const {
    t, assets, debts, housingMode, formatCurrency, recommendedInvestment,
    savingsAllocations, addSavingsAllocation, updateSavingsAllocation, removeSavingsAllocation,
    fixedExpenses, setFixedExpenses, automationEnabled,
  } = useFinance();
  const sa = t.savingsAllocation;
  const [created, setCreated] = useState(0);

  // Memoized because the `?? []` fallback is a fresh array each render, which
  // would otherwise invalidate the options memo below on every render.
  const savingsAccounts = useMemo(() => assets.savingsAccounts ?? [], [assets.savingsAccounts]);

  // One flat option list; the value encodes both kind and target id, matching the
  // `debt:<id>` / `savingsAccount:<id>` convention in destinationKey().
  const options = useMemo(() => [
    { v: 'bufferAccount', l: t.expenseDestination.buffer },
    { v: 'portfolio', l: t.expenseDestination.portfolio },
    { v: 'bsu', l: t.expenseDestination.bsu },
    ...savingsAccounts.map(s => ({ v: `savingsAccount:${s.id}`, l: `${t.expenseDestination.savings}: ${s.name}` })),
    ...(housingMode !== 'first_buyer' ? [{ v: 'mortgage', l: t.expenseDestination.mortgage }] : []),
    ...debts.map(d => ({ v: `debt:${d.id}`, l: `${t.expenseDestination.debt}: ${d.name}` })),
  ], [t, savingsAccounts, debts, housingMode]);

  const plan = useMemo(
    () => resolveAllocation(savingsAllocations, Math.max(0, recommendedInvestment)),
    [savingsAllocations, recommendedInvestment],
  );

  const savingsIds = savingsAccounts.map(s => s.id);
  const debtIds = debts.map(d => d.id);
  // What each destination ALREADY moves every month, from the live expenses.
  // Two jobs: it stops a second click duplicating a transfer, and it lets each
  // row show what is actually running rather than only what is planned.
  //
  // This matters because committing savings as a fixed expense shrinks the
  // residual, and the target is a share OF that residual — so the target falls
  // as you automate. That is correct (it is headroom you have not committed
  // yet), but it reads as the plan changing under you unless both numbers are
  // on screen. Hence the header's second line and the per-row chip.
  const committedByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of fixedExpenses) {
      if (!e.destinationKind || e.automationPaused) continue;
      const k = destinationKey({
        destinationKind: e.destinationKind, savingsAccountId: e.savingsAccountId, debtId: e.debtId,
      });
      m.set(k, (m.get(k) ?? 0) + e.amount);
    }
    return m;
  }, [fixedExpenses]);
  const committedTotal = [...committedByKey.values()].reduce((s, n) => s + n, 0);

  const creatable = plan.rows.filter(
    r => isCreatableRow(r, savingsIds, debtIds) && !committedByKey.has(destinationKey(r)),
  );

  const labelFor = (row: AllocationRow) =>
    options.find(o => o.v === destinationKey(row))?.l ?? sa.targetMissing;

  const setTarget = (id: string, value: string) => {
    const patch: Partial<AllocationRow> = {
      destinationKind: value.split(':')[0] as ExpenseDestinationKind,
      savingsAccountId: undefined,
      debtId: undefined,
    };
    if (value.startsWith('savingsAccount:')) patch.savingsAccountId = value.slice(15);
    else if (value.startsWith('debt:')) patch.debtId = value.slice(5);
    updateSavingsAllocation(id, patch);
  };

  const createExpenses = () => {
    setFixedExpenses([
      ...fixedExpenses,
      ...creatable.map(row => ({
        id: crypto.randomUUID(),
        name: labelFor(row),
        amount: row.amount,
        type: 'fixed' as const,
        destinationKind: row.destinationKind,
        savingsAccountId: row.savingsAccountId,
        debtId: row.debtId,
        // Same convention as assigning a destination by hand: the first move
        // happens NEXT month, never retroactively.
        lastPostedMonth: currentMonthKey(),
      })),
    ]);
    setCreated(creatable.length);
  };

  return (
    <Card padding="none" className="p-5 md:p-7 flex flex-col">
      <div className="flex items-baseline justify-between gap-3 flex-wrap pb-4 border-b border-[var(--border)]">
        <SectionLabel>{sa.title}</SectionLabel>
        <span className="text-[12px] font-mono tabular-nums text-right" style={{ color: 'var(--text-2)' }}>
          <span className="block">{formatCurrency(Math.max(0, recommendedInvestment))} {sa.perMonth}</span>
          {committedTotal > 0 && (
            <span className="block mt-0.5" style={{ color: 'var(--text-3)' }}>
              {sa.alreadyAutomated.replace('{amount}', formatCurrency(committedTotal))}
            </span>
          )}
        </span>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed" style={{ color: 'var(--text-3)' }}>{sa.intro}</p>

      {savingsAllocations.length === 0 ? (
        <p className="mt-5 text-[13px]" style={{ color: 'var(--text-3)' }}>{sa.empty}</p>
      ) : (
        <div className="mt-5 space-y-2.5">
          {plan.rows.map(row => (
            <div key={row.id} className="flex items-center gap-2.5 flex-wrap">
              <div className="relative">
                <select
                  className={selectCls}
                  value={destinationKey(row)}
                  onChange={e => setTarget(row.id, e.target.value)}
                  aria-label={sa.targetLabel}
                >
                  {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-2)]" />
              </div>
              <input
                className={pctInputCls}
                inputMode="decimal"
                value={row.percent}
                aria-label={sa.percentLabel}
                onChange={e => updateSavingsAllocation(row.id, { percent: Number(e.target.value) || 0 })}
              />
              <span className="text-[13px]" style={{ color: 'var(--text-3)' }}>%</span>
              {committedByKey.has(destinationKey(row)) && (
                <span
                  className="text-[10.5px] font-medium px-2 py-0.5 rounded-full"
                  style={{ background: 'var(--positive-bg)', color: 'var(--positive)' }}
                  title={sa.activeHint}
                >
                  {sa.active.replace('{amount}', formatCurrency(committedByKey.get(destinationKey(row))!))}
                </span>
              )}
              <span className="ml-auto text-[13px] font-mono tabular-nums" style={{ color: 'var(--text-1)' }}>
                {formatCurrency(row.amount)}
              </span>
              <button
                type="button"
                onClick={() => removeSavingsAllocation(row.id)}
                aria-label={sa.removeRow}
                className="p-1.5 rounded-[7px] hover:bg-[var(--bg-raised)] transition-colors"
                style={{ color: 'var(--text-3)' }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          <div className="flex items-center justify-between gap-3 pt-3 mt-1 border-t border-[var(--border)] text-[12.5px]">
            <span style={{ color: plan.overAllocated ? 'var(--negative)' : 'var(--text-2)' }}>
              {plan.totalPercent.toFixed(plan.totalPercent % 1 === 0 ? 0 : 1)} %
              {plan.remainder !== 0 && !plan.overAllocated && (
                <span style={{ color: 'var(--text-3)' }}>
                  {` · ${sa.unallocated.replace('{amount}', formatCurrency(plan.remainder))}`}
                </span>
              )}
              {plan.overAllocated && <span>{` · ${sa.overAllocated}`}</span>}
            </span>
            <span className="font-mono tabular-nums" style={{ color: 'var(--text-1)' }}>{formatCurrency(plan.totalAmount)}</span>
          </div>
        </div>
      )}

      <div className="mt-5 pt-1 flex items-center gap-2.5 flex-wrap">
        <Button
          variant="secondary"
          leadingIcon={<Plus size={14} />}
          onClick={() => addSavingsAllocation({ percent: 0, destinationKind: 'portfolio' })}
        >
          {sa.addRow}
        </Button>
        {creatable.length > 0 && !plan.overAllocated && (
          <Button variant="primary" leadingIcon={<Wand2 size={14} />} onClick={createExpenses}>
            {sa.create.replace('{count}', String(creatable.length))}
          </Button>
        )}
      </div>

      {created > 0 && (
        <p className="mt-3 text-[12px]" style={{ color: 'var(--positive)' }}>
          {sa.created.replace('{count}', String(created))}
        </p>
      )}
      {savingsAllocations.length > 0 && creatable.length === 0 && !plan.overAllocated && created === 0 && (
        <p className="mt-3 text-[12px]" style={{ color: 'var(--text-3)' }}>{sa.allCovered}</p>
      )}
      {!automationEnabled && (
        <p className="mt-3 text-[12px]" style={{ color: 'var(--warning)' }}>{t.pensionAutomation.masterOff}</p>
      )}
    </Card>
  );
};
