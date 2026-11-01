// Sizing the savings allocation, and "Sync amounts": bringing the transfers an
// allocation created back in line with it after it was edited. The allocation
// is authoritative, but only for what it made: a saving or expense is matched
// by its `allocationId` and nothing else, so a transfer set up by hand is never
// rewritten.
import type { FixedExpense, Saving } from '../context/FinanceContext';
import {
  destinationKey, resolveAllocation, type AllocationPlan, type AllocationRow, type SavingsAllocation,
} from './savingsAllocation';
import { percentOfSavingsBase, savingsBase, savingsTargetAmount } from './savingsRate';

export interface AllocationSizing {
  /** The month's savings target in kroner, the pot the plan splits. */
  target: number;
  /** The allocation resolved against `target`. */
  plan: AllocationPlan;
  /** The savings base a '%' saving made from the plan takes its share of. */
  percentBase: number;
}

const isPaydown = (a: Pick<SavingsAllocation, 'destinationKind'>) =>
  a.destinationKind === 'mortgage' || a.destinationKind === 'debt';

/** The row a linked expense belongs to, if that row still exists and still
 *  points where the expense pays. */
function governingRow<R extends SavingsAllocation>(
  e: FixedExpense, byId: Map<string, R>,
): R | undefined {
  const row = e.allocationId ? byId.get(e.allocationId) : undefined;
  if (!row || !e.destinationKind) return undefined;
  return destinationKey(row) === destinationKey({ destinationKind: e.destinationKind, debtId: e.debtId })
    ? row : undefined;
}

/**
 * Size the allocation, the one sizing both activating it and syncing it use,
 * so syncing right after activating changes nothing.
 *
 * The pot is the savings target with the plan's own paydowns left out of the
 * spending it is a share of. A mortgage or debt paydown is spending, so counting
 * the plan's own would shrink the target every time the plan paid more, and the
 * figures would move again on every sync. Savings never enter the base.
 *
 * A '%' saving is a share of the real base, which is what the paydowns leave:
 * `percentBase` takes off the paydown rows already linked to an expense plus
 * `creating`, the paydown rows about to be activated.
 *
 * Pass the CURRENT month's income, the live fixed expenses and the base target
 * percent (not a one-month override): the result is written to live transfers.
 */
export function sizeAllocation(
  allocations: SavingsAllocation[],
  income: number,
  fixedExpenses: FixedExpense[],
  savingsTargetPercent: number,
  creating: ReadonlySet<string> = new Set(),
): AllocationSizing {
  const byId = new Map(allocations.map(a => [a.id, a]));
  const linked = new Set<string>();
  const others: FixedExpense[] = [];
  for (const e of fixedExpenses) {
    const row = governingRow(e, byId);
    if (row) linked.add(row.id);
    else others.push(e);
  }
  const base = savingsBase(income, others);
  const target = savingsTargetAmount(base, savingsTargetPercent);
  const plan = resolveAllocation(allocations, target);
  const paid = plan.rows.reduce(
    (s, r) => (isPaydown(r) && (linked.has(r.id) || creating.has(r.id)) ? s + r.amount : s), 0,
  );
  return { target, plan, percentBase: Math.max(0, base - paid) };
}

/**
 * The transfers activating `rows` creates, sized from `sizing` (pass the sizing
 * made with these rows' paydowns as `creating`). A savings destination becomes a
 * `Saving`, the mortgage or a debt a `FixedExpense`; each carries its row's id
 * as `allocationId`. `stamp` is the current month: the first move happens next
 * month, never retroactively.
 */
export function buildActivation(
  rows: AllocationRow[],
  sizing: AllocationSizing,
  stamp: string,
  labelFor: (row: AllocationRow) => string,
  newId: () => string,
): { savings: Saving[]; expenses: FixedExpense[] } {
  const savings: Saving[] = [];
  const expenses: FixedExpense[] = [];
  for (const row of rows) {
    if (isPaydown(row)) {
      expenses.push({
        id: newId(),
        name: labelFor(row),
        amount: row.amount,
        type: 'fixed',
        destinationKind: row.destinationKind as FixedExpense['destinationKind'],
        debtId: row.debtId,
        lastPostedMonth: stamp,
        allocationId: row.id,
      });
      continue;
    }
    savings.push({
      id: newId(),
      name: labelFor(row),
      amount: row.amount,
      // A 'rest' row activates as a rest row, so the live saving keeps
      // absorbing what the others leave instead of freezing at today's split.
      mode: row.mode ?? 'percent',
      // A percentage row is activated as a share of the BASE, not of the
      // target, so later editing the target percent doesn't silently re-scale
      // a live transfer.
      percent: row.mode === 'percent' || row.mode === undefined
        ? percentOfSavingsBase(row.amount, sizing.percentBase) : undefined,
      destinationKind: row.destinationKind as Saving['destinationKind'],
      savingsAccountId: row.savingsAccountId,
      lastPostedMonth: stamp,
      allocationId: row.id,
    });
  }
  return { savings, expenses };
}

export interface AllocationSyncChange {
  id: string;
  kind: 'saving' | 'expense';
  rowId: string;
  /** A '%' saving keeps tracking income, so its share is what changes. */
  field: 'amount' | 'percent';
  from: number;
  to: number;
}

/**
 * Every linked saving or expense whose figure differs from what `sizing` gives
 * its row. A '%' saving gets its row's kroner as a share of `percentBase` (as
 * activation sets it); a 'kr' saving or a paydown expense gets the row's
 * kroner. 'rest' savings already follow the remainder, a link whose row is
 * gone or now points elsewhere is left alone, and an over-allocated plan
 * offers nothing.
 */
export function allocationSyncPlan(
  sizing: AllocationSizing,
  savings: Saving[],
  expenses: FixedExpense[],
): AllocationSyncChange[] {
  // An over-allocated plan resolves its '%' rows to 0; syncing to that would
  // zero live transfers.
  if (sizing.plan.overAllocated) return [];
  const byId = new Map(sizing.plan.rows.map(r => [r.id, r]));
  const out: AllocationSyncChange[] = [];
  for (const e of expenses) {
    const row = governingRow(e, byId);
    if (row && row.amount !== e.amount) {
      out.push({ id: e.id, kind: 'expense', rowId: row.id, field: 'amount', from: e.amount, to: row.amount });
    }
  }
  for (const sv of savings) {
    const row = sv.allocationId ? byId.get(sv.allocationId) : undefined;
    if (!row || destinationKey(row) !== destinationKey(sv) || sv.mode === 'rest') continue;
    if (sv.mode === 'percent') {
      const to = percentOfSavingsBase(row.amount, sizing.percentBase);
      if (to !== undefined && to !== sv.percent) {
        out.push({ id: sv.id, kind: 'saving', rowId: row.id, field: 'percent', from: sv.percent ?? 0, to });
      }
    } else if (row.amount !== sv.amount) {
      out.push({ id: sv.id, kind: 'saving', rowId: row.id, field: 'amount', from: sv.amount, to: row.amount });
    }
  }
  return out;
}
