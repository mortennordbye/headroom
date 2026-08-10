// Splitting the savings target across destinations.
//
// `savingsTargetPercent` turns the month's residual into ONE number
// (`recommendedInvestment`). This module answers the next question — where that
// number should go — by holding a percentage allocation across the same
// destinations a fixed expense can automate, and resolving it to kr.
//
// The allocation is a PLAN. It never moves money on its own: the user turns it
// into fixed expenses explicitly, and those post through the normal automation
// runner (src/lib/automation.ts). That keeps one path to a balance change and
// keeps the amounts inside the budget, where the savings-rate math can see them.
import type { ExpenseDestinationKind } from '../context/FinanceContext';

export interface SavingsAllocation {
  id: string;
  /** Share of the savings target, in percent. Ignored when `mode` is 'amount'. */
  percent: number;
  /**
   * How this row is sized. 'percent' (the default, and the only mode before this
   * existed) tracks the target — and, once activated, tracks income. 'amount'
   * pins a fixed number of kroner, for a transfer that should not move when a
   * month is fat or lean. Absent reads as 'percent' for stored data.
   */
  mode?: 'percent' | 'amount';
  /** Fixed kroner per month. Set iff `mode` is 'amount'. */
  amount?: number;
  destinationKind: ExpenseDestinationKind;
  savingsAccountId?: string;  // set iff destinationKind === 'savingsAccount'
  debtId?: string;            // set iff destinationKind === 'debt'
}

export interface AllocationRow extends SavingsAllocation {
  /** The allocation's share of the target, in kr (whole kroner). */
  amount: number;
}

export interface AllocationPlan {
  rows: AllocationRow[];
  /** Sum of the rows' percentages. */
  totalPercent: number;
  /** Sum of the rows' kr — equals `target` exactly whenever totalPercent is 100. */
  totalAmount: number;
  /** Target minus totalAmount: what is still unallocated (negative = over-allocated). */
  remainder: number;
  /** totalPercent > 100 — the UI blocks creating expenses in this state. */
  overAllocated: boolean;
}

/** A finite, non-negative percent; anything else reads as 0 rather than NaN. */
const pct = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

/** Same guard for a fixed-kroner row: a blank or hand-edited NaN reads as 0. */
const kr = (n: number | undefined): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * Resolve an allocation to whole kroner against `target`.
 *
 * Uses largest-remainder so the rows sum EXACTLY to the allocated share of the
 * target: rounding each row independently would leave the total a krone or two
 * off, which then shows up as a phantom "1 kr unallocated" in the UI.
 *
 * A non-positive target (no residual this month) resolves every row to 0 while
 * keeping the percentages, so the plan survives a lean month unchanged.
 */
export function resolveAllocation(allocations: SavingsAllocation[], target: number): AllocationPlan {
  // Fixed-kroner rows are taken off the top: they are a stated amount, not a
  // share, so the percentages divide only what is left after them. Expressing a
  // kr row as an equivalent percentage instead would silently re-scale it every
  // time income moved — the exact thing choosing 'amount' opts out of.
  const isFixed = (a: SavingsAllocation) => a.mode === 'amount';
  const fixedTotal = allocations.reduce((s, a) => (isFixed(a) ? s + kr(a.amount) : s), 0);
  const percentTarget = Math.max(0, target - fixedTotal);

  const totalPercent = allocations.reduce((s, a) => (isFixed(a) ? s : s + pct(a.percent)), 0);
  // Fixed rows alone can exceed the target; that is over-allocation too.
  const overAllocated = totalPercent > 100 || fixedTotal > Math.max(0, target);

  if (!(percentTarget > 0)) {
    const rows = allocations.map(a => ({ ...a, amount: isFixed(a) ? kr(a.amount) : 0 }));
    const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
    return {
      rows,
      totalPercent,
      totalAmount,
      remainder: Math.round(target) - totalAmount,
      overAllocated,
    };
  }

  // Exact shares, then floor, then hand the lost kroner to the largest fractions.
  // Only the percentage rows take part: a fixed row is already a stated whole
  // number and must not drift by a krone to make someone else's rounding work.
  const exact = allocations.map(a => (isFixed(a) ? 0 : (percentTarget * pct(a.percent)) / 100));
  const amounts = allocations.map((a, i) => (isFixed(a) ? Math.round(kr(a.amount)) : Math.floor(exact[i])));
  const percentAllocated = Math.round((percentTarget * Math.min(totalPercent, 100)) / 100);
  let leftover = percentAllocated
    - allocations.reduce((s, a, i) => (isFixed(a) ? s : s + amounts[i]), 0);
  const order = allocations
    .map((a, i) => ({ i, frac: isFixed(a) ? -1 : exact[i] - Math.floor(exact[i]) }))
    .filter(o => o.frac >= 0)
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (leftover <= 0) break;
    amounts[i] += 1;
    leftover -= 1;
  }

  const rows = allocations.map((a, i) => ({ ...a, amount: amounts[i] }));
  const totalAmount = amounts.reduce((s, n) => s + n, 0);
  return {
    rows,
    totalPercent,
    totalAmount,
    remainder: Math.round(target) - totalAmount,
    overAllocated,
  };
}

/**
 * True when this row can become a fixed expense: it must move a positive amount
 * and still point at a target that exists. A row whose savings account or debt
 * has since been deleted is skipped rather than silently retargeted.
 */
export function isCreatableRow(
  row: AllocationRow,
  savingsAccountIds: string[],
  debtIds: string[],
): boolean {
  if (!(row.amount > 0)) return false;
  if (row.destinationKind === 'savingsAccount') {
    return !!row.savingsAccountId && savingsAccountIds.includes(row.savingsAccountId);
  }
  if (row.destinationKind === 'debt') {
    return !!row.debtId && debtIds.includes(row.debtId);
  }
  return true;
}

/** Stable identity for "the same destination", used to match an existing expense. */
export function destinationKey(
  d: Pick<SavingsAllocation, 'destinationKind' | 'savingsAccountId' | 'debtId'>,
): string {
  if (d.destinationKind === 'savingsAccount') return `savingsAccount:${d.savingsAccountId ?? ''}`;
  if (d.destinationKind === 'debt') return `debt:${d.debtId ?? ''}`;
  return d.destinationKind;
}
