import { describe, it, expect } from 'vitest';
import { allocationSyncPlan, buildActivation, sizeAllocation, type AllocationSizing } from './allocationSync';
import {
  destinationKey, isCreatableRow, planPaydownTotal, type AllocationPlan, type AllocationRow, type SavingsAllocation,
} from './savingsAllocation';
import { resolveSavingsAmounts, savingsBase, savingsContributionTotal } from './savingsRate';
import { calcRecommendations, planMonthlySavingFor } from './calculations';
import { withLinkedPayments } from './debt';
import type { Debt, FixedExpense, Saving } from '../context/FinanceContext';

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

describe('buildActivation paydowns', () => {
  it("records the months a new paydown's stamp covers but another expense on the loan still owes", () => {
    const rows = [row({ id: 'm', amount: 4000, destinationKind: 'mortgage' })];
    const existing: FixedExpense[] = [
      { id: 'main', name: 'Lån', amount: 10_000, type: 'fixed', destinationKind: 'mortgage', lastPostedMonth: '2026-09' },
    ];
    const { expenses } = buildActivation(rows, sz(rows, 0), '2026-11', () => 'Extra', () => 'new', existing);
    expect(expenses[0]).toMatchObject({ lastPostedMonth: '2026-11', uncoveredMonths: { '2026-10': 0, '2026-11': 0 } });
  });

  it('records nothing when no other expense pays that loan', () => {
    const rows = [row({ id: 'm', amount: 4000, destinationKind: 'mortgage' })];
    const { expenses } = buildActivation(rows, sz(rows, 0), '2026-11', () => 'Extra', () => 'new', []);
    expect(expenses[0]).not.toHaveProperty('uncoveredMonths');
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

// What the budget reads once the plan is live, the way FinanceContext and the
// MCP derive it: live savings resolved with the plan's paydowns, then the
// recommendation with those paydowns counted as set aside.
function budgetFromLive(income: number, fixed: FixedExpense[], savings: Saving[], allocs: SavingsAllocation[], pct: number) {
  const paydown = planPaydownTotal(allocs, fixed);
  const live = resolveSavingsAmounts(savings, savingsBase(income, fixed), pct, paydown);
  const transfers = savingsContributionTotal(live);
  const consumption = fixed.reduce((s, e) => s + e.amount, 0);
  const recs = calcRecommendations(income, income, consumption + transfers, 0, pct, transfers + paydown);
  return {
    paydown, transfers, recs,
    // The Budget Saving pill: transfers + paydowns + the unallocated rest.
    savingPill: transfers + paydown + recs.recommendedInvestment,
    // What a projection annualises as cash.
    cash: planMonthlySavingFor(income, consumption, transfers, pct, paydown),
  };
}

describe('the panel and the budget agree once a paydown row is active', () => {
  const rent: FixedExpense = { id: 'rent', name: 'Rent', amount: 10000 };
  const activateAll = (allocs: SavingsAllocation[], fixed: FixedExpense[], income: number, pct: number) => {
    let n = 0;
    const plan = sizeAllocation(allocs, income, fixed, pct).plan;
    const creating = new Set(plan.rows.map(r => r.id));
    return buildActivation(plan.rows, sizeAllocation(allocs, income, fixed, pct, creating), '2026-11',
      () => 'x', () => `n${n++}`, fixed);
  };

  it('a mortgage paydown and a rest row: same target, nothing unallocated', () => {
    const allocs: SavingsAllocation[] = [
      { id: 'm', percent: 0, mode: 'amount', amount: 2000, destinationKind: 'mortgage' },
      { id: 'r', percent: 0, mode: 'rest', destinationKind: 'bsu' },
    ];
    const sizing = sizeAllocation(allocs, 50000, [rent], 20);
    expect(sizing.target).toBe(8000);
    const made = activateAll(allocs, [rent], 50000, 20);
    const b = budgetFromLive(50000, [rent, ...made.expenses], made.savings, allocs, 20);
    expect(b.paydown).toBe(2000);
    expect(b.transfers).toBe(6000);
    expect(b.recs.recommendedInvestment).toBe(0);
    expect(b.savingPill).toBe(sizing.target);
    expect(b.recs.recommendedSpending).toBe(50000 - 10000 - sizing.target);
  });

  it('a partial plan leaves the same remainder unallocated in both', () => {
    const allocs: SavingsAllocation[] = [
      { id: 'm', percent: 25, destinationKind: 'mortgage' },
      { id: 'b', percent: 50, destinationKind: 'bsu' },
    ];
    const sizing = sizeAllocation(allocs, 50000, [rent], 20);
    const made = activateAll(allocs, [rent], 50000, 20);
    const b = budgetFromLive(50000, [rent, ...made.expenses], made.savings, allocs, 20);
    expect(b.recs.recommendedInvestment).toBe(sizing.plan.remainder);
    expect(b.savingPill).toBe(sizing.target);
  });

  it('projections do not count a debt paydown twice: cash plus the loan payment is the target', () => {
    const debt: Debt = { id: 'card', name: 'Card', type: 'consumer', balance: 50000, rate: 12, minPayment: 500 };
    const allocs: SavingsAllocation[] = [
      { id: 'd', percent: 0, mode: 'amount', amount: 2000, destinationKind: 'debt', debtId: 'card' },
      { id: 'r', percent: 0, mode: 'rest', destinationKind: 'portfolio' },
    ];
    const made = activateAll(allocs, [rent], 50000, 20);
    const fixed = [rent, ...made.expenses];
    const b = budgetFromLive(50000, fixed, made.savings, allocs, 20);
    // The projection amortizes the debt at the linked payment...
    const [projected] = withLinkedPayments([debt], fixed);
    expect(projected.minPayment).toBe(2000);
    // ...so its cash leaves the paydown out, and the two add up to the target.
    expect(b.cash).toBe(6000);
    expect(b.cash + projected.minPayment).toBe(sizeAllocation(allocs, 50000, [rent], 20).target);
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
    const made = buildActivation(creatable, size(s, new Set(creatable.map(r => r.id))), '2026-11', () => 'x', newId, s.fixed);
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

      // Activated savings move their row's kroner against the real base.
      const { plan, target } = size(s1);
      const realBase = savingsBase(s1.income, s1.fixed);
      const paydown = planPaydownTotal(s1.allocs, s1.fixed);
      // A rest row is only the plan's own when no hand-made saving shares the target.
      const planOnly = s1.savings.every(sv => sv.allocationId);
      for (const sv of resolveSavingsAmounts(s1.savings, realBase, s1.pct, paydown)) {
        const r = plan.rows.find(x => x.id === sv.allocationId);
        if (r && sv.mode === 'percent') expect(Math.abs(sv.amount - r.amount)).toBeLessThanOrEqual(1);
        if (r && sv.mode === 'rest' && planOnly) expect(Math.abs(sv.amount - r.amount)).toBeLessThanOrEqual(plan.rows.length);
      }
      // And the budget's saving is the panel's target whenever the plan fits it.
      if (!plan.overAllocated && planOnly) {
        const b = budgetFromLive(s1.income, s1.fixed, s1.savings, s1.allocs, s1.pct);
        expect(Math.abs(b.savingPill - target)).toBeLessThanOrEqual(plan.rows.length);
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
