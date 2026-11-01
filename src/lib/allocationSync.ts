// "Sync amounts": bring the transfers an allocation created back in line with
// the allocation after it was edited. The allocation is authoritative, but only
// for what it made: a saving or expense is matched by its `allocationId` and
// nothing else, so a transfer set up by hand is never rewritten.
import type { FixedExpense, Saving } from '../context/FinanceContext';
import { destinationKey, type AllocationRow } from './savingsAllocation';
import { percentOfSavingsBase } from './savingsRate';

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
 * Every linked saving or expense whose figure differs from what its allocation
 * row now implies. A '%' saving gets the share of the savings base its row's
 * kroner make up (as at creation); a 'kr' saving or a paydown expense gets the
 * row's kroner. `base` is today's savings base, before any of these changes.
 * 'rest' savings already follow the remainder, and a link whose row is gone or
 * now points elsewhere is left alone.
 */
export function allocationSyncPlan(
  rows: AllocationRow[],
  savings: Saving[],
  expenses: FixedExpense[],
  base: number,
): AllocationSyncChange[] {
  const byId = new Map(rows.map(r => [r.id, r]));
  const out: AllocationSyncChange[] = [];
  for (const e of expenses) {
    const row = e.allocationId ? byId.get(e.allocationId) : undefined;
    if (!row || !e.destinationKind || destinationKey(row) !== destinationKey({ destinationKind: e.destinationKind, debtId: e.debtId })) continue;
    if (row.amount !== e.amount) {
      out.push({ id: e.id, kind: 'expense', rowId: row.id, field: 'amount', from: e.amount, to: row.amount });
    }
  }
  // A paydown is spending, so the base a '%' saving takes its share of is the
  // one left after the expense changes above.
  const baseAfter = out.reduce((b, c) => b + c.from - c.to, base);
  for (const sv of savings) {
    const row = sv.allocationId ? byId.get(sv.allocationId) : undefined;
    if (!row || destinationKey(row) !== destinationKey(sv) || sv.mode === 'rest') continue;
    if (sv.mode === 'percent') {
      const to = percentOfSavingsBase(row.amount, baseAfter);
      if (to !== undefined && to !== sv.percent) {
        out.push({ id: sv.id, kind: 'saving', rowId: row.id, field: 'percent', from: sv.percent ?? 0, to });
      }
    } else if (row.amount !== sv.amount) {
      out.push({ id: sv.id, kind: 'saving', rowId: row.id, field: 'amount', from: sv.amount, to: row.amount });
    }
  }
  return out;
}
