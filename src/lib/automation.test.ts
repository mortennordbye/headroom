import { describe, it, expect } from 'vitest';
import { computeAutomationPostings, applyAmortization, automationMortgage, monthlyPaydownPrincipal, type AutomationRule, type AutomationState } from './automation';
import { currentMortgage } from './existingMortgage';

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
  scalars: { bufferAccount: 20_000, portfolio: 300_000, bsu: 50_000, pensionOtp: 210_000, pensionIps: 48_000 },
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

describe('computeAutomationPostings — adjusted months', () => {
  it('moves an adjusted month at its own amount', () => {
    const [p] = computeAutomationPostings(
      [rule({ lastPostedMonth: '2026-06', amountByMonth: { '2026-07': 0 } })], state(), '2026-07');
    expect(p.newBalance).toBe(1000);    // nothing saved in July
  });

  it('catches up each month at its own amount', () => {
    const [p] = computeAutomationPostings(
      [rule({ lastPostedMonth: '2026-04', amountByMonth: { '2026-06': 100 } })], state(), '2026-07');
    expect(p.newBalance).toBe(2100);    // 1000 + 500 (May) + 100 (Jun) + 500 (Jul)
  });

  it('applies the most recent month when capped', () => {
    const [p] = computeAutomationPostings(
      [rule({ lastPostedMonth: '2026-04', amountByMonth: { '2026-05': 0, '2026-07': 200 } })], state(), '2026-07', 1);
    expect(p.newBalance).toBe(1200);
  });

  it('takes a negative amount back out (the correction for an already-posted month)', () => {
    const [p] = computeAutomationPostings([rule({ lastPostedMonth: '2026-06', amount: -500 })], state(), '2026-07');
    expect(p.newBalance).toBe(500);
  });
});

describe('computeAutomationPostings — buffer account', () => {
  const buf = (over: Partial<AutomationRule> = {}) =>
    rule({ targetKind: 'bufferAccount', savingsAccountId: undefined, ...over });

  it('grows the single buffer scalar by amount × monthsDue', () => {
    const [p] = computeAutomationPostings([buf({ lastPostedMonth: '2026-06' })], state(), '2026-07');
    expect(p.targetKind).toBe('bufferAccount');
    expect(p.monthsDue).toBe(1);
    expect(p.newBalance).toBe(20_500);          // 20 000 + 1×500
    expect(p.savingsAccountId).toBeUndefined();
  });

  it('catches up missed months into the buffer', () => {
    const [p] = computeAutomationPostings([buf({ lastPostedMonth: '2026-04' })], state(), '2026-07');
    expect(p.newBalance).toBe(21_500);          // 20 000 + 3×500
  });

  it('two buffer rules stack in the same month (no clobber)', () => {
    const [a, b] = computeAutomationPostings(
      [buf({ id: 'b1', lastPostedMonth: '2026-06' }), buf({ id: 'b2', amount: 1000, lastPostedMonth: '2026-06' })],
      state(), '2026-07',
    );
    expect(a.newBalance).toBe(20_500);          // 20 000 + 500
    expect(b.newBalance).toBe(21_500);          // + 1000, stacked on the first
  });
});

describe('computeAutomationPostings — the other scalar targets', () => {
  const scalar = (targetKind: AutomationRule['targetKind'], over: Partial<AutomationRule> = {}) =>
    rule({ targetKind, savingsAccountId: undefined, lastPostedMonth: '2026-06', ...over });

  it.each([
    ['portfolio', 300_500],
    ['bsu', 50_500],
    ['pensionOtp', 210_500],
    ['pensionIps', 48_500],
  ] as const)('grows %s by amount × monthsDue', (kind, expected) => {
    const [p] = computeAutomationPostings([scalar(kind)], state(), '2026-07');
    expect(p.targetKind).toBe(kind);
    expect(p.newBalance).toBe(expected);
  });

  it('keeps each scalar target independent (no cross-contamination)', () => {
    const posts = computeAutomationPostings(
      [scalar('portfolio', { id: 'p' }), scalar('bsu', { id: 'b', amount: 1000 })],
      state(), '2026-07',
    );
    expect(posts.map(p => p.newBalance)).toEqual([300_500, 51_000]);
  });

  it('rounds a fractional monthly contribution (OTP is a % of salary)', () => {
    const [p] = computeAutomationPostings([scalar('pensionOtp', { amount: 1583.3333 })], state(), '2026-07');
    expect(p.newBalance).toBe(211_583);
  });

  it('catches up missed pension months in one posting', () => {
    const [p] = computeAutomationPostings(
      [scalar('pensionOtp', { amount: 1000, lastPostedMonth: '2026-04' })], state(), '2026-07',
    );
    expect(p.monthsDue).toBe(3);
    expect(p.newBalance).toBe(213_000);
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

  it('transitioning: a mortgage payment accrues interest at the current loan\'s rate', () => {
    const m = currentMortgage(
      'transitioning',
      { houseDebt: 2_000_000 },
      { currentMortgageBalance: 2_000_000, rente: 4, nedbetalingstid: 20, nedbetalingstidAsOf: '2026-01', currentMortgageBalanceAsOf: '2026-01' },
      { currentMortgageBalance: 2_000_000 },
      '2026-07',
    );
    const s = state({ housingMode: 'transitioning', ...automationMortgage(m) });
    expect(s.mortgageRate).toBe(4);
    const rule1 = rule({ id: 'm1', targetKind: 'mortgage', savingsAccountId: undefined, amount: 12_000, lastPostedMonth: '2026-06' });
    const [p] = computeAutomationPostings([rule1], s, '2026-07');
    // Interest at 4 % (not a planned loan's rate): 2 000 000 × 4 % / 12.
    expect(p.newBalance).toBe(Math.round(2_000_000 - (12_000 - 2_000_000 * 0.04 / 12)));
  });

  it('skips (without stamping) a debt rule whose debt was deleted', () => {
    expect(computeAutomationPostings([debtRule({ lastPostedMonth: '2026-06', debtId: 'gone' })], state(), '2026-07')).toHaveLength(0);
  });
});

describe('computeAutomationPostings — co-owned mortgage scope', () => {
  const m = (over: Partial<AutomationRule> = {}) =>
    rule({ id: 'm1', targetKind: 'mortgage', savingsAccountId: undefined, amount: 5000, lastPostedMonth: '2026-06', ...over });
  // 1 000 000 at 5 %: one month's interest is 4 166.67.

  it("'whole' (and absent) pays the amount as-is, whatever the share", () => {
    const s = state({ mortgageDebtShare: 0.5 });
    const [whole] = computeAutomationPostings([m({ mortgagePaymentScope: 'whole' })], s, '2026-07');
    const [absent] = computeAutomationPostings([m()], s, '2026-07');
    expect(whole.newBalance).toBe(Math.round(1_000_000 + 1_000_000 * 0.05 / 12 - 5000));
    expect(absent.newBalance).toBe(whole.newBalance);
  });

  it("'myShare' grosses the amount up by the debt share", () => {
    const [p] = computeAutomationPostings([m({ mortgagePaymentScope: 'myShare' })], state({ mortgageDebtShare: 0.5 }), '2026-07');
    expect(p.newBalance).toBe(Math.round(1_000_000 + 1_000_000 * 0.05 / 12 - 10_000));
  });

  it("'myShare' with no co-owners (share absent) pays the amount as-is", () => {
    const [p] = computeAutomationPostings([m({ mortgagePaymentScope: 'myShare' })], state(), '2026-07');
    expect(p.newBalance).toBe(Math.round(1_000_000 + 1_000_000 * 0.05 / 12 - 5000));
  });

  it("stamps a 'myShare' rule without moving the loan while the user carries none of it", () => {
    const [p] = computeAutomationPostings(
      [m({ mortgagePaymentScope: 'myShare', lastPostedMonth: '2026-01' })], state({ mortgageDebtShare: 0 }), '2026-07');
    expect(p).toMatchObject({ noChange: true, newBalance: 1_000_000, newLastPostedMonth: '2026-07' });
  });

  it('never grosses up a savings rule aimed at the mortgage (an extra payment)', () => {
    // Saving rules carry no scope, so the debt share doesn't touch them.
    const [p] = computeAutomationPostings([m({ id: 'sv1' })], state({ mortgageDebtShare: 0.25 }), '2026-07');
    expect(p.newBalance).toBe(Math.round(1_000_000 + 1_000_000 * 0.05 / 12 - 5000));
  });
});

describe('computeAutomationPostings — two payments to one loan', () => {
  const loanRule = (over: Partial<AutomationRule> = {}) =>
    rule({ targetKind: 'mortgage', savingsAccountId: undefined, lastPostedMonth: '2026-06', ...over });
  // 1 000 000 at 5 %: one month's interest is 4 166.67.

  it("charges the month's interest once, whichever order the rules come in", () => {
    const main = loanRule({ id: 'main', amount: 10_000 });
    const extra = loanRule({ id: 'extra', amount: 2000 });
    const expected = Math.round(1_000_000 + 1_000_000 * 0.05 / 12 - 12_000);
    for (const rules of [[main, extra], [extra, main]]) {
      const postings = computeAutomationPostings(rules, state(), '2026-07');
      expect(postings.map(p => p.infeasible)).toEqual([false, false]);
      expect(postings.at(-1)!.newBalance).toBe(expected);
    }
  });

  it('keeps charging interest once per month across a catch-up', () => {
    const main = loanRule({ id: 'main', amount: 10_000, lastPostedMonth: '2026-05' });
    const extra = loanRule({ id: 'extra', amount: 2000, lastPostedMonth: '2026-04' });
    const postings = computeAutomationPostings([main, extra], state(), '2026-07');
    // 'main' pays June and July with interest (its stamp says May was paid);
    // 'extra' then catches up May to July as principal only.
    const m1 = 1_000_000 + 1_000_000 * 0.05 / 12 - 10_000;
    const m2 = m1 + m1 * 0.05 / 12 - 10_000;
    expect(postings.at(-1)!.newBalance).toBe(Math.round(m2) - 6000);
  });

  it("counts a month another rule's stamp covers as interest-charged", () => {
    const main = loanRule({ id: 'main', amount: 10_000, lastPostedMonth: '2026-05' });
    const extra = loanRule({ id: 'extra', amount: 2000, lastPostedMonth: '2026-06' });
    const postings = computeAutomationPostings([main, extra], state(), '2026-07');
    // 'extra' already paid June in an earlier run, so June's interest is charged.
    const m1 = 1_000_000 - 10_000;
    const m2 = m1 + m1 * 0.05 / 12 - 10_000;
    expect(postings.at(-1)!.newBalance).toBe(Math.round(m2) - 2000);
  });

  it("treats a month another rule already posted to the loan as interest-charged", () => {
    // 'main' already posted through July, so confirming the extra payment's
    // two-month catch-up afterwards pays principal only.
    const main = loanRule({ id: 'main', amount: 10_000, lastPostedMonth: '2026-07' });
    const extra = loanRule({ id: 'extra', amount: 2000, lastPostedMonth: '2026-05' });
    const [p] = computeAutomationPostings([extra], state(), '2026-07', undefined, [main, extra]);
    expect(p.newBalance).toBe(1_000_000 - 4000);
  });

  it('charges each debt its own interest', () => {
    const s = state({ debts: { 'debt-1': { balance: 50_000, rate: 12 }, 'debt-2': { balance: 50_000, rate: 12 } } });
    const a = loanRule({ id: 'a', targetKind: 'debt', debtId: 'debt-1', amount: 5000 });
    const b = loanRule({ id: 'b', targetKind: 'debt', debtId: 'debt-2', amount: 5000 });
    const postings = computeAutomationPostings([a, b], s, '2026-07');
    expect(postings.map(p => p.newBalance)).toEqual([45_500, 45_500]);
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

describe('monthlyPaydownPrincipal', () => {
  const state = {
    mortgage: 2_400_000, mortgageRate: 5, debts: { car: { balance: 100_000, rate: 12 } },
    housingMode: 'homeowner' as const,
  };
  const MONTH = '2026-10';

  it('is the payment less the month\'s interest, mortgage and debt together', () => {
    const p = monthlyPaydownPrincipal([
      { amount: 15_000, destinationKind: 'mortgage' },
      { amount: 3_000, destinationKind: 'debt', debtId: 'car' },
    ], state, MONTH);
    expect(p).toBe(Math.round(15_000 - 2_400_000 * 0.05 / 12 + 3_000 - 100_000 * 0.12 / 12));
  });

  it('counts the mortgage at the user\'s debt share, for either payment scope', () => {
    const half = { ...state, mortgageDebtShare: 0.5 };
    // 'whole': the loan gets 15 000; half the principal is the user's.
    expect(monthlyPaydownPrincipal([{ amount: 15_000, destinationKind: 'mortgage' }], half, MONTH))
      .toBe(Math.round((15_000 - 10_000) * 0.5));
    // 'myShare': 7 500 is half the instalment, so the loan again gets 15 000.
    expect(monthlyPaydownPrincipal([{ amount: 7_500, destinationKind: 'mortgage', mortgagePaymentScope: 'myShare' }], half, MONTH))
      .toBe(Math.round((15_000 - 10_000) * 0.5));
  });

  it('a second payment to the same loan is all principal', () => {
    const p = monthlyPaydownPrincipal([
      { amount: 15_000, destinationKind: 'mortgage' },
      { amount: 2_000, destinationKind: 'mortgage' },
    ], state, MONTH);
    expect(p).toBe(15_000 - 10_000 + 2_000);
  });

  it('nothing for paused, plain, infeasible, unknown-debt or first-buyer payments', () => {
    expect(monthlyPaydownPrincipal([{ amount: 15_000, destinationKind: 'mortgage', automationPaused: true }], state, MONTH)).toBe(0);
    expect(monthlyPaydownPrincipal([{ amount: 15_000 }], state, MONTH)).toBe(0);
    expect(monthlyPaydownPrincipal([{ amount: 5_000, destinationKind: 'mortgage' }], state, MONTH)).toBe(0);
    expect(monthlyPaydownPrincipal([{ amount: 3_000, destinationKind: 'debt', debtId: 'gone' }], state, MONTH)).toBe(0);
    expect(monthlyPaydownPrincipal([{ amount: 15_000, destinationKind: 'mortgage' }], { ...state, housingMode: 'first_buyer' }, MONTH)).toBe(0);
  });

  it('a revolving card cleared every month keeps nothing', () => {
    const card = { ...state, debts: { card: { balance: 15_000, rate: 0, revolving: true } } };
    expect(monthlyPaydownPrincipal([{ amount: 15_000, destinationKind: 'debt', debtId: 'card' }], card, MONTH)).toBe(0);
  });

  it('never NaN from broken amounts or balances', () => {
    const p = monthlyPaydownPrincipal([
      { amount: NaN, destinationKind: 'mortgage' },
      { amount: 3_000, destinationKind: 'debt', debtId: 'car' },
    ], { ...state, mortgage: NaN, debts: { car: { balance: NaN, rate: 12 } } }, MONTH);
    expect(Number.isFinite(p)).toBe(true);
  });
});
