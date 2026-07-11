import { describe, it, expect } from 'vitest';
import { computeAutomationPostings, applyAmortization, type AutomationRule, type AutomationState } from './automation';

const rule = (over: Partial<AutomationRule> = {}): AutomationRule => ({
  id: 'a1',
  name: 'Rule',
  amount: 500,
  targetKind: 'savingsAccount',
  savingsAccountId: 'sav-1',
  startMonth: '2026-01',
  ...over,
});

const state = (over: Partial<AutomationState> = {}): AutomationState => ({
  savings: { 'sav-1': 1000 },
  mortgage: 1_000_000,
  mortgageRate: 5,
  debts: { 'debt-1': { balance: 50_000, rate: 12 } },
  housingMode: 'homeowner',
  ...over,
});

describe('computeAutomationPostings — savings', () => {
  it('posts one month when a single month is due', () => {
    const [p] = computeAutomationPostings([rule({ lastPostedMonth: '2026-06' })], state(), '2026-07');
    expect(p.monthsDue).toBe(1);
    expect(p.newBalance).toBe(1500);
    expect(p.newLastPostedMonth).toBe('2026-07');
  });

  it('catches up all missed months at once', () => {
    const [p] = computeAutomationPostings([rule({ lastPostedMonth: '2026-04' })], state(), '2026-07');
    expect(p.monthsDue).toBe(3);        // May, Jun, Jul
    expect(p.newBalance).toBe(2500);    // 1000 + 3×500
    expect(p.newLastPostedMonth).toBe('2026-07');
  });

  it('caps the applied months when capMonths is given but still stamps to current', () => {
    const [p] = computeAutomationPostings([rule({ lastPostedMonth: '2026-04' })], state(), '2026-07', 1);
    expect(p.monthsDue).toBe(1);
    expect(p.newBalance).toBe(1500);    // only one month applied
    expect(p.newLastPostedMonth).toBe('2026-07'); // rest of the gap skipped
  });

  it('starts from startMonth when never posted (next-month default → no post in start-1)', () => {
    expect(computeAutomationPostings([rule({ startMonth: '2026-08' })], state(), '2026-07')).toHaveLength(0);
    const [p] = computeAutomationPostings([rule({ startMonth: '2026-08' })], state(), '2026-08');
    expect(p.monthsDue).toBe(1);
  });

  it('does not post again in the same month it last posted', () => {
    expect(computeAutomationPostings([rule({ lastPostedMonth: '2026-07' })], state(), '2026-07')).toHaveLength(0);
  });

  it('skips (without stamping) a savings rule whose account was deleted', () => {
    expect(computeAutomationPostings([rule({ lastPostedMonth: '2026-06', savingsAccountId: 'gone' })], state(), '2026-07')).toHaveLength(0);
  });
});

describe('computeAutomationPostings — amortization-aware paydown', () => {
  const debtRule = (over: Partial<AutomationRule> = {}) =>
    rule({ id: 'p1', targetKind: 'debt', debtId: 'debt-1', savingsAccountId: undefined, amount: 5000, ...over });

  it('reduces a debt by the principal portion, not the full payment', () => {
    const [p] = computeAutomationPostings([debtRule({ lastPostedMonth: '2026-06' })], state(), '2026-07');
    // interest = 50000 × 12%/12 = 500; principal reduction = 5000 − 500 = 4500
    expect(p.newBalance).toBe(45_500);
  });

  it('compounds interest across a multi-month catch-up', () => {
    const [p] = computeAutomationPostings([debtRule({ lastPostedMonth: '2026-05' })], state(), '2026-07');
    // m1: 50000+500−5000 = 45500 ; m2: 45500+455−5000 = 40955
    expect(p.monthsDue).toBe(2);
    expect(p.newBalance).toBe(40_955);
  });

  it('floors a debt at 0 rather than going negative', () => {
    const s = state({ debts: { 'debt-1': { balance: 300, rate: 0 } } });
    const [p] = computeAutomationPostings([debtRule({ lastPostedMonth: '2026-06', amount: 500 })], s, '2026-07');
    expect(p.newBalance).toBe(0);
  });

  it('clears a small balance mid-catch-up and stays at 0', () => {
    const s = state({ mortgage: 700, mortgageRate: 5 });
    const m = rule({ id: 'm1', targetKind: 'mortgage', savingsAccountId: undefined, amount: 500, lastPostedMonth: '2026-05' });
    const [p] = computeAutomationPostings([m], s, '2026-07'); // 2 months due
    expect(p.newBalance).toBe(0);
  });

  it('flags an under-funded paydown (payment ≤ interest) and leaves the balance unchanged', () => {
    const s = state({ debts: { 'debt-1': { balance: 50_000, rate: 12 } } });
    const [p] = computeAutomationPostings([debtRule({ lastPostedMonth: '2026-06', amount: 400 })], s, '2026-07');
    expect(p.infeasible).toBe(true);
    expect(p.newBalance).toBe(50_000);
  });

  it('skips a mortgage rule while in first_buyer mode (no mortgage exists)', () => {
    const s = state({ housingMode: 'first_buyer' });
    const m = rule({ id: 'm1', targetKind: 'mortgage', savingsAccountId: undefined, amount: 5000, lastPostedMonth: '2026-06' });
    expect(computeAutomationPostings([m], s, '2026-07')).toHaveLength(0);
  });

  it('skips (without stamping) a debt rule whose debt was deleted', () => {
    expect(computeAutomationPostings([debtRule({ lastPostedMonth: '2026-06', debtId: 'gone' })], state(), '2026-07')).toHaveLength(0);
  });
});

describe('computeAutomationPostings — mixed batch', () => {
  it('resolves several rules in one call', () => {
    const savings = rule({ id: 's1', lastPostedMonth: '2026-06' });
    const debt = rule({ id: 'd1', targetKind: 'debt', debtId: 'debt-1', savingsAccountId: undefined, amount: 5000, lastPostedMonth: '2026-06' });
    const postings = computeAutomationPostings([savings, debt], state(), '2026-07');
    expect(postings.map(p => p.rule.id).sort()).toEqual(['d1', 's1']);
  });

  it('stacks two rules pointed at the same savings account', () => {
    const a = rule({ id: 'a', amount: 500, lastPostedMonth: '2026-06' });
    const b = rule({ id: 'b', amount: 300, lastPostedMonth: '2026-06' });
    const postings = computeAutomationPostings([a, b], state(), '2026-07'); // base 1000
    expect(postings.find(p => p.rule.id === 'a')!.newBalance).toBe(1500);
    expect(postings.find(p => p.rule.id === 'b')!.newBalance).toBe(1800); // cumulative
  });
});

describe('applyAmortization', () => {
  it('is a no-op on a zero balance', () => {
    expect(applyAmortization(0, 5, 1000, 3)).toEqual({ balance: 0, infeasible: false });
  });

  it('applies straight subtraction at 0% interest', () => {
    expect(applyAmortization(1000, 0, 300, 2).balance).toBe(400);
  });

  it('reports infeasible when the payment cannot cover the interest', () => {
    expect(applyAmortization(100_000, 12, 500, 6)).toEqual({ balance: 100_000, infeasible: true });
  });
});
