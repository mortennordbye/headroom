import { describe, it, expect } from 'vitest';
import { allocationSyncPlan, buildActivation, sizeAllocation, type AllocationSizing } from './allocationSync';
import {
  destinationKey, isCreatableRow, type AllocationPlan, type AllocationRow, type SavingsAllocation,
} from './savingsAllocation';
import { resolveSavingsAmounts, savingsBase } from './savingsRate';
import type { FixedExpense, Saving } from '../context/FinanceContext';

const row = (p: Partial<AllocationRow> & Pick<AllocationRow, 'id' | 'amount' | 'destinationKind'>): AllocationRow =>
  ({ percent: 0, ...p });

// A sizing that resolved to exactly `rows`; only the rows and the base matter here.
const sz = (rows: AllocationRow[], percentBase: number): AllocationSizing =>
  ({ target: 0, plan: { rows, overAllocated: false } as AllocationPlan, percentBase });

const saving = (p: Partial<Saving> & Pick<Saving, 'id' | 'amount' | 'destinationKind'>): Saving =>
  ({ name: 'S', ...p });

describe('allocationSyncPlan', () => {
  it('rewrites the amount of a kr saving that drifted from its row', () => {
    const rows = [row({ id: 'a', amount: 3000, destinationKind: 'portfolio' })];
    const savings = [saving({ id: 's', amount: 2500, mode: 'amount', destinationKind: 'portfolio', allocationId: 'a' })];
    expect(allocationSyncPlan(sz(rows, 40000), savings, [])).toEqual([
      { id: 's', kind: 'saving', rowId: 'a', field: 'amount', from: 2500, to: 3000 },
    ]);
  });

  it('rewrites the percent of a % saving to the share of the base its row now implies', () => {
    const rows = [row({ id: 'a', amount: 5000, destinationKind: 'bsu' })];
    const savings = [saving({ id: 's', amount: 4000, mode: 'percent', percent: 10, destinationKind: 'bsu', allocationId: 'a' })];
    expect(allocationSyncPlan(sz(rows, 40000), savings, [])).toEqual([
      { id: 's', kind: 'saving', rowId: 'a', field: 'percent', from: 10, to: 12.5 },
    ]);
  });

  it('rewrites the amount of a mortgage or debt expense linked to its row', () => {
    const rows = [
      row({ id: 'm', amount: 2000, destinationKind: 'mortgage' }),
      row({ id: 'd', amount: 800, destinationKind: 'debt', debtId: 'debt-1' }),
    ];
    const expenses: FixedExpense[] = [
      { id: 'e1', name: 'M', amount: 1500, destinationKind: 'mortgage', allocationId: 'm' },
      { id: 'e2', name: 'D', amount: 800, destinationKind: 'debt', debtId: 'debt-1', allocationId: 'd' },
    ];
    expect(allocationSyncPlan(sz(rows, 40000), [], expenses)).toEqual([
      { id: 'e1', kind: 'expense', rowId: 'm', field: 'amount', from: 1500, to: 2000 },
    ]);
  });

  it('never touches rows without an allocationId, even at the same destination', () => {
    const rows = [row({ id: 'a', amount: 3000, destinationKind: 'portfolio' })];
    const savings = [saving({ id: 's', amount: 100, mode: 'amount', destinationKind: 'portfolio' })];
    const expenses: FixedExpense[] = [{ id: 'e', name: 'M', amount: 1, destinationKind: 'mortgage' }];
    expect(allocationSyncPlan(sz(rows, 40000), savings, expenses)).toEqual([]);
  });

  it('skips links to a deleted row and rows retargeted since activation', () => {
    const rows = [row({ id: 'a', amount: 3000, destinationKind: 'bsu' })];
    const savings = [
      saving({ id: 's1', amount: 100, mode: 'amount', destinationKind: 'portfolio', allocationId: 'a' }),
      saving({ id: 's2', amount: 100, mode: 'amount', destinationKind: 'portfolio', allocationId: 'gone' }),
    ];
    expect(allocationSyncPlan(sz(rows, 40000), savings, [])).toEqual([]);
  });

  it('leaves rest savings alone and returns nothing when everything matches', () => {
    const rows = [
      row({ id: 'a', amount: 3000, destinationKind: 'portfolio' }),
      row({ id: 'b', amount: 4000, destinationKind: 'bsu', mode: 'rest' }),
    ];
    const savings = [
      saving({ id: 's1', amount: 3000, mode: 'amount', destinationKind: 'portfolio', allocationId: 'a' }),
      saving({ id: 's2', amount: 1, mode: 'rest', destinationKind: 'bsu', allocationId: 'b' }),
    ];
    expect(allocationSyncPlan(sz(rows, 40000), savings, [])).toEqual([]);
  });

  it('skips a % saving when the base is zero (no share to take)', () => {
    const rows = [row({ id: 'a', amount: 5000, destinationKind: 'bsu' })];
    const savings = [saving({ id: 's', amount: 0, mode: 'percent', percent: 10, destinationKind: 'bsu', allocationId: 'a' })];
    expect(allocationSyncPlan(sz(rows, 0), savings, [])).toEqual([]);
  });
});

describe('allocationSyncPlan over-allocation', () => {
  it('offers nothing when the plan is over-allocated', () => {
    const rows = [row({ id: 'a', amount: 0, destinationKind: 'portfolio' })];
    const savings = [saving({ id: 's', amount: 2500, mode: 'amount', destinationKind: 'portfolio', allocationId: 'a' })];
    const over = { target: 0, plan: { rows, overAllocated: true } as AllocationPlan, percentBase: 40000 };
    expect(allocationSyncPlan(over, savings, [])).toEqual([]);
  });
});

describe('sizeAllocation', () => {
  const rent: FixedExpense = { id: 'rent', name: 'Rent', amount: 10000 };

  it('splits the target of income minus spending, ignoring savings', () => {
    const s = sizeAllocation([{ id: 'a', percent: 100, destinationKind: 'portfolio' }], 50000, [rent], 20);
    expect(s.target).toBe(8000);
    expect(s.plan.rows[0].amount).toBe(8000);
    expect(s.percentBase).toBe(40000);
  });

  it("leaves the plan's own paydowns out of the target, but takes them off the % base", () => {
    const allocs: SavingsAllocation[] = [
      { id: 'a', percent: 75, destinationKind: 'bsu' },
      { id: 'm', percent: 25, destinationKind: 'mortgage' },
    ];
    const linked: FixedExpense = { id: 'e', name: 'M', amount: 123, destinationKind: 'mortgage', allocationId: 'm' };
    const s = sizeAllocation(allocs, 50000, [rent, linked], 20);
    expect(s.target).toBe(8000);
    expect(s.percentBase).toBe(40000 - 2000);
    // Before activation the paydown isn't there yet; `creating` counts it.
    expect(sizeAllocation(allocs, 50000, [rent], 20).percentBase).toBe(40000);
    expect(sizeAllocation(allocs, 50000, [rent], 20, new Set(['m'])).percentBase).toBe(38000);
  });

  it('counts a linked paydown whose row now points elsewhere as ordinary spending', () => {
    const allocs: SavingsAllocation[] = [{ id: 'm', percent: 100, destinationKind: 'bsu' }];
    const orphan: FixedExpense = { id: 'e', name: 'M', amount: 5000, destinationKind: 'mortgage', allocationId: 'm' };
    expect(sizeAllocation(allocs, 50000, [rent, orphan], 20).target).toBe(7000);
  });
});

// Property check: drive the panel's flow (activate, edit, sync, income change)
// over random plans and assert the sizing is consistent by construction.
describe('allocation activate/sync properties', () => {
  type St = { income: number; pct: number; fixed: FixedExpense[]; savings: Saving[]; allocs: SavingsAllocation[] };
  let n = 0;
  const newId = () => `id-${n++}`;
  const size = (s: St, creating?: ReadonlySet<string>) => sizeAllocation(s.allocs, s.income, s.fixed, s.pct, creating);

  // Mirrors SavingsAllocationPanel's createExpenses.
  function activate(s: St): St {
    const { plan } = size(s);
    if (plan.overAllocated) return s;
    const committed = new Set([
      ...s.savings.filter(sv => !sv.paused).map(sv => destinationKey(sv)),
      ...s.fixed.filter(e => e.destinationKind).map(e => destinationKey({ destinationKind: e.destinationKind!, debtId: e.debtId })),
    ]);
    const creatable = plan.rows.filter(r => isCreatableRow(r, [], []) && !committed.has(destinationKey(r)));
    const made = buildActivation(creatable, size(s, new Set(creatable.map(r => r.id))), '2026-11', () => 'x', newId);
    return { ...s, savings: [...s.savings, ...made.savings], fixed: [...s.fixed, ...made.expenses] };
  }
  // Mirrors the panel's syncAmounts.
  function sync(s: St): St {
    const patch = new Map(allocationSyncPlan(size(s), s.savings, s.fixed).map(c => [c.id, { [c.field]: c.to }]));
    return {
      ...s,
      savings: s.savings.map(sv => (patch.has(sv.id) ? { ...sv, ...patch.get(sv.id) } : sv)),
      fixed: s.fixed.map(e => (patch.has(e.id) ? { ...e, ...patch.get(e.id) } : e)),
    };
  }
  const pending = (s: St) => allocationSyncPlan(size(s), s.savings, s.fixed);

  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const ri = (a: number, b: number) => Math.floor(a + rnd() * (b - a + 1));
  const kinds = ['portfolio', 'bsu', 'bufferAccount', 'mortgage'] as const;
  const modes = ['percent', 'amount', 'rest', undefined] as const;

  function gen(): St {
    const ks = [...kinds].sort(() => rnd() - 0.5).slice(0, ri(1, 4));
    const allocs: SavingsAllocation[] = ks.map((k, i) => {
      const mode = modes[ri(0, 3)];
      return { id: `a${i}`, destinationKind: k, mode, percent: ri(5, 60), amount: mode === 'amount' ? ri(100, 4000) : undefined };
    });
    // Half the runs carry a hand-made saving, often above the target on its own.
    const hand: Saving[] = rnd() < 0.5
      ? [{ id: 'hand', name: 'hand', amount: ri(100, 9000), mode: 'amount', destinationKind: ks[0] === 'mortgage' ? 'portfolio' : ks[0] }]
      : [];
    return { income: ri(20000, 80000), pct: ri(5, 40), fixed: [{ id: 'rent', name: 'r', amount: ri(5000, 20000) }], savings: hand, allocs };
  }

  it('activation then sync is a no-op, sync converges in one step, and hand-made rows never change', () => {
    for (let i = 0; i < 2000; i++) {
      const s0 = gen();
      const s1 = activate(s0);
      expect(pending(s1)).toEqual([]);

      // Activated '%' savings move their row's kroner against the real base.
      const { plan } = size(s1);
      const realBase = savingsBase(s1.income, s1.fixed);
      for (const sv of resolveSavingsAmounts(s1.savings, realBase, s1.pct)) {
        const r = plan.rows.find(x => x.id === sv.allocationId);
        if (r && sv.mode === 'percent') expect(Math.abs(sv.amount - r.amount)).toBeLessThanOrEqual(1);
      }

      const s2 = { ...s1, allocs: s1.allocs.map(a => ({ ...a, percent: ri(5, 60), amount: a.mode === 'amount' ? ri(100, 4000) : a.amount })) };
      const s3 = sync(s2);
      expect(pending(s3)).toEqual([]);

      const s4 = sync({ ...s3, income: s3.income + ri(-5000, 5000) });
      expect(pending(s4)).toEqual([]);

      expect(s4.savings.find(sv => sv.id === 'hand')).toEqual(s0.savings.find(sv => sv.id === 'hand'));
      expect(s4.fixed.find(e => e.id === 'rent')).toEqual(s0.fixed[0]);
    }
  });
});
