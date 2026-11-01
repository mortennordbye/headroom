import { describe, it, expect } from 'vitest';
import { computeAutomationPostings, applyAmortization, automationMortgage, monthlyPaydownPrincipal, unpaidStampMonths, type AutomationRule, type AutomationState } from './automation';
import { currentMortgage } from './existingMortgage';
import type { CoOwner, FixedExpense } from '../context/FinanceContext';

// A co-owner holding `pct` % of the home and of the loan.
const co = (pct: number, over: Partial<CoOwner> = {}): CoOwner => ({ id: `co-${pct}`, name: 'Co', ownershipPct: pct, ...over });

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
    const s = state({ coOwners: [co(50)] });
    const [whole] = computeAutomationPostings([m({ mortgagePaymentScope: 'whole' })], s, '2026-07');
    const [absent] = computeAutomationPostings([m()], s, '2026-07');
    expect(whole.newBalance).toBe(Math.round(1_000_000 + 1_000_000 * 0.05 / 12 - 5000));
    expect(absent.newBalance).toBe(whole.newBalance);
  });

  it("'myShare' grosses the amount up by the debt share", () => {
    const [p] = computeAutomationPostings([m({ mortgagePaymentScope: 'myShare' })], state({ coOwners: [co(50)] }), '2026-07');
    expect(p.newBalance).toBe(Math.round(1_000_000 + 1_000_000 * 0.05 / 12 - 10_000));
  });

  it("'myShare' with no co-owners (share absent) pays the amount as-is", () => {
    const [p] = computeAutomationPostings([m({ mortgagePaymentScope: 'myShare' })], state(), '2026-07');
    expect(p.newBalance).toBe(Math.round(1_000_000 + 1_000_000 * 0.05 / 12 - 5000));
  });

  it("stamps a 'myShare' rule without moving the loan while the user carries none of it", () => {
    const [p] = computeAutomationPostings(
      [m({ mortgagePaymentScope: 'myShare', lastPostedMonth: '2026-01' })], state({ coOwners: [co(100)] }), '2026-07');
    expect(p).toMatchObject({ noChange: true, newBalance: 1_000_000, newLastPostedMonth: '2026-07' });
  });

  // Balance after each month's payment at 5 % (interest, then the payment).
  const amortized = (payments: number[]) =>
    Math.round(payments.reduce((bal, pay) => bal + bal * 0.05 / 12 - pay, 1_000_000));

  it("a 'myShare' catch-up grosses each month up by the share in force that month", () => {
    // Co-owner leaves after April: Mar-Apr the user pays half the instalment, May-Jun all of it.
    const [left] = computeAutomationPostings(
      [m({ mortgagePaymentScope: 'myShare', lastPostedMonth: '2026-02' })],
      state({ coOwners: [co(50, { since: '2025-01', until: '2026-04' })] }), '2026-06');
    expect(left.newBalance).toBe(amortized([10_000, 10_000, 5000, 5000]));
    // Co-owner joins in May: the reverse.
    const [joined] = computeAutomationPostings(
      [m({ mortgagePaymentScope: 'myShare', lastPostedMonth: '2026-02' })],
      state({ coOwners: [co(50, { since: '2026-05' })] }), '2026-06');
    expect(joined.newBalance).toBe(amortized([5000, 5000, 10_000, 10_000]));
  });

  it("a 'myShare' catch-up skips only the months the user carried none of the loan", () => {
    const [p] = computeAutomationPostings(
      [m({ mortgagePaymentScope: 'myShare', lastPostedMonth: '2026-02' })],
      state({ coOwners: [co(100, { until: '2026-04' })] }), '2026-06');
    expect(p.noChange).toBeUndefined();
    expect(p.newBalance).toBe(amortized([5000, 5000]));
  });

  it('never grosses up a savings rule aimed at the mortgage (an extra payment)', () => {
    // Saving rules carry no scope, so the debt share doesn't touch them.
    const [p] = computeAutomationPostings([m({ id: 'sv1' })], state({ coOwners: [co(75)] }), '2026-07');
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

  it("charges the interest of months another rule's declined catch-up skipped", () => {
    // Both rules last paid May. 'main' declined its catch-up in July: it paid
    // July only, so June's interest is still to charge when 'extra' catches up.
    const main = loanRule({ id: 'main', amount: 10_000, lastPostedMonth: '2026-07', uncoveredMonths: { '2026-06': 0 } });
    const extra = loanRule({ id: 'extra', amount: 5000, lastPostedMonth: '2026-05' });
    const [p] = computeAutomationPostings([extra], state(), '2026-07', undefined, [main, extra]);
    const june = 1_000_000 + 1_000_000 * 0.05 / 12 - 5000;
    expect(p.newBalance).toBe(Math.round(june - 5000));
  });

  it("charges only the part of a month's interest another payment has not already paid", () => {
    // 'extra' put 3000 toward June's 4166.67 of interest without covering it.
    const extra = loanRule({ id: 'extra', amount: 3000, lastPostedMonth: '2026-06', uncoveredMonths: { '2026-06': 3000 } });
    const main = loanRule({ id: 'main', amount: 10_000, lastPostedMonth: '2026-05' });
    const [p] = computeAutomationPostings([main], state(), '2026-06', undefined, [main, extra]);
    expect(p.newBalance).toBe(Math.round(1_000_000 + 1_000_000 * 0.05 / 12 - 3000 - 10_000));
  });

  it('records the months a declined loan catch-up skipped while another rule still owes them', () => {
    const main = loanRule({ id: 'main', amount: 10_000, lastPostedMonth: '2026-04' });
    const extra = loanRule({ id: 'extra', amount: 5000, lastPostedMonth: '2026-04' });
    const [p] = computeAutomationPostings([main], state(), '2026-07', 1, [main, extra]);
    expect(p.monthsDue).toBe(1);
    expect(p.uncoveredMonths).toEqual({ '2026-05': 0, '2026-06': 0 });
  });

  it('drops skipped months every other rule on the loan has already passed', () => {
    const main = loanRule({ id: 'main', amount: 10_000, lastPostedMonth: '2026-04', uncoveredMonths: { '2026-02': 0 } });
    const extra = loanRule({ id: 'extra', amount: 5000, lastPostedMonth: '2026-05' });
    const [p] = computeAutomationPostings([main], state(), '2026-07', 1, [main, extra]);
    expect(p.uncoveredMonths).toEqual({ '2026-06': 0 });
  });

  it('records no skipped months for a declined catch-up on a loan no other rule pays', () => {
    const main = loanRule({ id: 'main', amount: 10_000, lastPostedMonth: '2026-04' });
    const [p] = computeAutomationPostings([main], state(), '2026-07', 1, [main]);
    expect(p.uncoveredMonths).toEqual({});
  });

  it('leaves the recorded months alone on a posting that covers every month', () => {
    const main = loanRule({ id: 'main', amount: 10_000, lastPostedMonth: '2026-06', uncoveredMonths: { '2026-05': 0 } });
    const [p] = computeAutomationPostings([main], state(), '2026-07');
    expect(p).not.toHaveProperty('uncoveredMonths');
  });

  it("records what a payment put toward months whose interest it couldn't cover", () => {
    const main = loanRule({ id: 'main', amount: 10_000, lastPostedMonth: '2026-08', uncoveredMonths: { '2026-06': 0, '2026-07': 0 } });
    const extra = loanRule({ id: 'extra', amount: 3000, lastPostedMonth: '2026-05' });
    const other = loanRule({ id: 'other', amount: 5000, lastPostedMonth: '2026-05' });
    const [p] = computeAutomationPostings([extra], state(), '2026-08', undefined, [main, extra, other]);
    expect(p.uncoveredMonths).toEqual({ '2026-06': 3000, '2026-07': 3000 });
    expect(p.monthsShort).toBe(2);
    expect(p.infeasible).toBe(true);
  });

  // Click through the catch-up prompt the way FinanceContext does: post one
  // rule against the others, write its stamp and recorded months, move on.
  const clickThrough = (rules: AutomationRule[], steps: [string, 'all' | 'one'][], month = '2026-08') => {
    let s = state();
    for (const [id, choice] of steps) {
      const target = rules.find(r => r.id === id)!;
      const [p] = computeAutomationPostings([target], s, month, choice === 'one' ? 1 : undefined, rules);
      s = { ...s, mortgage: p.newBalance };
      rules = rules.map(r => {
        if (r.id !== id) return r;
        const { uncoveredMonths: _old, ...rest } = r;
        const kept = p.uncoveredMonths ?? r.uncoveredMonths;
        return { ...rest, lastPostedMonth: month, ...(kept && Object.keys(kept).length ? { uncoveredMonths: kept } : {}) };
      });
    }
    return s.mortgage;
  };

  it('ends at the same balance whichever of two catch-ups is answered first', () => {
    const rules = [
      loanRule({ id: 'main', amount: 10_000, lastPostedMonth: '2026-05' }),
      loanRule({ id: 'extra', amount: 3000, lastPostedMonth: '2026-05' }),
    ];
    const a = clickThrough(rules, [['main', 'one'], ['extra', 'all']]);
    const b = clickThrough(rules, [['extra', 'all'], ['main', 'one']]);
    // August: one month's interest on 1 000 000, then both payments.
    expect(a).toBe(Math.round(1_000_000 + 1_000_000 * 0.05 / 12 - 13_000));
    expect(b).toBe(a);
  });

  it('charges every skipped month its interest whichever of three catch-ups is answered first', () => {
    const rules = [
      loanRule({ id: 'main', amount: 10_000, lastPostedMonth: '2026-05' }),
      loanRule({ id: 'e1', amount: 3000, lastPostedMonth: '2026-05' }),
      loanRule({ id: 'e2', amount: 5000, lastPostedMonth: '2026-05' }),
    ];
    const a = clickThrough(rules, [['main', 'one'], ['e1', 'all'], ['e2', 'all']]);
    const b = clickThrough(rules, [['main', 'one'], ['e2', 'all'], ['e1', 'all']]);
    // Each month's interest is worked out on the balance at the click, so the
    // two orders differ by a few kroner, never by a month's interest.
    expect(Math.abs(a - b)).toBeLessThan(100);
    // June and July: 8000 paid against about 4140 of interest each; August: 18 000 after interest.
    const aug = 1_000_000 + 1_000_000 * 0.05 / 12 - 18_000;
    expect(a).toBeGreaterThan(aug - 2 * (8000 - 4100));
    expect(a).toBeLessThan(aug - 2 * (8000 - 4200));
  });

  it('never moves less on "catch up all" than on "just this month"', () => {
    const main = loanRule({ id: 'main', amount: 10_000, lastPostedMonth: '2026-08', uncoveredMonths: { '2026-06': 0, '2026-07': 0 } });
    const extra = loanRule({ id: 'extra', amount: 3000, lastPostedMonth: '2026-05' });
    const [all] = computeAutomationPostings([extra], state(), '2026-08', undefined, [main, extra]);
    const [one] = computeAutomationPostings([extra], state(), '2026-08', 1, [main, extra]);
    expect(one.newBalance).toBe(1_000_000 - 3000);
    expect(all.newBalance).toBeLessThanOrEqual(one.newBalance);
  });

  it('charges each debt its own interest', () => {
    const s = state({ debts: { 'debt-1': { balance: 50_000, rate: 12 }, 'debt-2': { balance: 50_000, rate: 12 } } });
    const a = loanRule({ id: 'a', targetKind: 'debt', debtId: 'debt-1', amount: 5000 });
    const b = loanRule({ id: 'b', targetKind: 'debt', debtId: 'debt-2', amount: 5000 });
    const postings = computeAutomationPostings([a, b], s, '2026-07');
    expect(postings.map(p => p.newBalance)).toEqual([45_500, 45_500]);
  });
});

describe('computeAutomationPostings — co-owner share changes with a second payment to the loan', () => {
  // 1 000 000 at 5 %. Co-owner A holds half through February; co-owner B holds
  // all of March only. So the user carries half the loan in February, none in
  // March, and all of it from April.
  const coOwners = [
    co(50, { id: 'a', since: '2025-01', until: '2026-02' }),
    co(100, { id: 'b', since: '2026-03', until: '2026-03' }),
  ];
  const r = 0.05 / 12;
  const mine = (over: Partial<AutomationRule>) => rule({
    id: 'mine', targetKind: 'mortgage', savingsAccountId: undefined, mortgagePaymentScope: 'myShare',
    lastPostedMonth: '2026-01', ...over,
  });
  const extra = (over: Partial<AutomationRule>) => rule({
    id: 'extra', targetKind: 'mortgage', savingsAccountId: undefined, ...over,
  });

  it("charges each month's interest once against a declined catch-up's uncovered months", () => {
    // `extra` declined its catch-up in May: it paid May only, so Feb-Apr are uncovered.
    const declined = extra({ amount: 2000, lastPostedMonth: '2026-05', uncoveredMonths: { '2026-02': 0, '2026-03': 0, '2026-04': 0 } });
    const [p] = computeAutomationPostings([mine({ amount: 5000 })], state({ coOwners }), '2026-05', undefined, [declined]);
    let bal = 1_000_000;
    bal = bal + bal * r - 10_000; // Feb: interest charged here, payment grossed up by the half share
    //                               Mar: skipped, the co-owner paid it; no interest, no payment
    bal = bal + bal * r - 5000;   // Apr: interest charged here
    bal = bal - 5000;             // May: `extra` already charged it, so all principal
    expect(p.newBalance).toBe(Math.round(bal));
    expect(p.noChange).toBeUndefined();
    expect(p.uncoveredMonths).toBeUndefined();
  });

  it('records the grossed short payments by month and the other rule charges only what is left', () => {
    // A small 'myShare' payment can't cover the interest; `extra` hasn't caught up yet.
    const pending = extra({ amount: 10_000, lastPostedMonth: '2026-01' });
    const [short] = computeAutomationPostings([mine({ amount: 2000 })], state({ coOwners }), '2026-04', undefined, [pending]);
    expect(short.newBalance).toBe(1_000_000);
    expect(short.monthsShort).toBe(2);
    // February's payment is grossed up to 4 000; March (0 % share) is never recorded.
    expect(short.uncoveredMonths).toEqual({ '2026-02': 4000, '2026-04': 2000 });

    const stamped = mine({ amount: 2000, lastPostedMonth: '2026-04', uncoveredMonths: short.uncoveredMonths });
    const [p] = computeAutomationPostings([pending], state({ coOwners }), '2026-04', undefined, [stamped]);
    let bal = 1_000_000;
    bal = bal + (bal * r - 4000) - 10_000; // Feb: only the interest left after the 4 000
    bal = bal - 10_000;                    // Mar: the co-owner covered it, all principal
    bal = bal + (bal * r - 2000) - 10_000; // Apr: only the interest left after the 2 000
    expect(p.newBalance).toBe(Math.round(bal));
  });

  describe('a co-owner carrying the whole loan through September', () => {
    const s = state({ coOwners: [co(100, { id: 'x', until: '2026-09' })] });
    const A = mine({ id: 'A', amount: 9000, lastPostedMonth: '2026-07' });
    const B = extra({ id: 'B', amount: 1000, lastPostedMonth: '2026-07' });
    const NOW = '2026-11';
    // Post `first` (the other rule waits as `others`), then the other with `first` stamped.
    const inTurn = (first: AutomationRule, second: AutomationRule, cap?: number) => {
      const [p1] = computeAutomationPostings([first], s, NOW, cap, [second]);
      const stamped = { ...first, lastPostedMonth: NOW, uncoveredMonths: p1.uncoveredMonths };
      const [p2] = computeAutomationPostings([second], { ...s, mortgage: p1.newBalance }, NOW, undefined, [stamped]);
      return { p1, p2 };
    };

    it("the co-owners' months count as paid whichever catch-up prompt is answered first", () => {
      const aThenB = inTurn(A, B).p2.newBalance;
      const both = computeAutomationPostings([A, B], s, NOW);
      expect(both[both.length - 1].newBalance).toBe(aThenB);
      // A charges Oct-Nov interest (Aug-Sep was the co-owners'); B's four
      // payments are all principal.
      let ab = 1_000_000;
      ab = ab + ab * r - 9000;
      ab = ab + ab * r - 9000;
      expect(aThenB).toBe(Math.round(ab - 4 * 1000));

      // B first: Aug-Sep are principal (not charged interest, which was the
      // 2 000 kr order gap), and its 1 000 goes toward Oct-Nov interest, which
      // A then charges only the rest of.
      const bThenA = inTurn(B, A);
      expect(bThenA.p1.newBalance).toBe(1_000_000 - 2000);
      expect(bThenA.p1.uncoveredMonths).toEqual({ '2026-10': 1000, '2026-11': 1000 });
      let ba = 1_000_000 - 2000;
      ba = ba + (ba * r - 1000) - 9000;
      ba = ba + (ba * r - 1000) - 9000;
      expect(bThenA.p2.newBalance).toBe(Math.round(ba));
      // What is left between the orders is the runner amortizing one rule at a
      // time (B's Aug-Sep principal lands before or after A's interest), which
      // two plain rules on a loan with no co-owners show too.
      expect(Math.abs(bThenA.p2.newBalance - aThenB)).toBeLessThan(50);
    });

    it('a declined catch-up never records 0 % months as uncovered', () => {
      // A declined: it pays November only. October (a month the user carried
      // the loan) stays uncovered; August and September were the co-owners'.
      const { p1, p2 } = inTurn(A, B, 1);
      expect(p1.uncoveredMonths).toEqual({ '2026-10': 0 });
      let bal = 1_000_000;
      bal = bal + bal * r - 9000; // A: November only
      // B: Aug, Sep and Nov are principal. October's interest is still due and
      // B's 1 000 can't cover it, so October moves nothing and is B's short month.
      expect(p2.newBalance).toBe(Math.round(bal - 3 * 1000));
      expect(p2.monthsShort).toBe(1);
    });
  });

  it('a 0 % month skipped in one call counts as charged for the other rule in that call', () => {
    const both = computeAutomationPostings(
      [mine({ amount: 5000 }), extra({ amount: 6000, lastPostedMonth: '2026-01' })], state({ coOwners }), '2026-04');
    const last = both[both.length - 1];
    let bal = 1_000_000;
    // `extra` (largest payment) goes first and charges each month's interest, but March's is the co-owner's.
    bal = bal + bal * r - 6000;
    bal = bal - 6000;
    bal = bal + bal * r - 6000;
    // Then `mine`, all principal: 10 000 in Feb, nothing in Mar, 5 000 in Apr.
    bal = bal - 10_000 - 5000;
    expect(last.newBalance).toBe(Math.round(bal));
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
    expect(applyAmortization(0, 5, 1000, 3)).toEqual({ balance: 0, infeasible: false, shortMonths: [] });
  });

  it('applies straight subtraction at 0% interest', () => {
    expect(applyAmortization(1000, 0, 300, 2).balance).toBe(400);
  });

  it('reports infeasible when the payment cannot cover the interest', () => {
    expect(applyAmortization(100_000, 12, 500, 3)).toEqual({ balance: 100_000, infeasible: true, shortMonths: [0, 1, 2] });
  });

  it('skips only the months whose interest the payment cannot cover', () => {
    // Month one's interest is already charged; month two's is not, and 500 can't cover it.
    expect(applyAmortization(100_000, 12, 500, 2, [Infinity, 0])).toEqual({ balance: 99_500, infeasible: true, shortMonths: [1] });
  });

  it("charges only the interest another payment hasn't already paid", () => {
    expect(applyAmortization(100_000, 12, 800, 1, [500])).toEqual({ balance: 99_700, infeasible: false, shortMonths: [] });
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
    const half = { ...state, coOwners: [co(50)] };
    // 'whole': the loan gets 15 000; half the principal is the user's.
    expect(monthlyPaydownPrincipal([{ amount: 15_000, destinationKind: 'mortgage' }], half, MONTH))
      .toBe(Math.round((15_000 - 10_000) * 0.5));
    // 'myShare': 7 500 is half the instalment, so the loan again gets 15 000.
    expect(monthlyPaydownPrincipal([{ amount: 7_500, destinationKind: 'mortgage', mortgagePaymentScope: 'myShare' }], half, MONTH))
      .toBe(Math.round((15_000 - 10_000) * 0.5));
  });

  it('counts the mortgage at the share in force in the month asked about', () => {
    const left = { ...state, coOwners: [co(50, { until: '2026-09' })] };
    expect(monthlyPaydownPrincipal([{ amount: 15_000, destinationKind: 'mortgage' }], left, MONTH))
      .toBe(15_000 - 10_000);
    expect(monthlyPaydownPrincipal([{ amount: 15_000, destinationKind: 'mortgage' }], left, '2026-09'))
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

describe('unpaidStampMonths — a stamp that pays nothing', () => {
  // 1 000 000 at 5 %: 'main' last paid May; 'extra' is stamped July without paying.
  const expense = (over: Partial<FixedExpense> = {}): FixedExpense => ({
    id: 'extra', name: 'Extra', amount: 5000, type: 'fixed', destinationKind: 'mortgage', ...over,
  });
  const main = expense({ id: 'main', amount: 10_000, lastPostedMonth: '2026-05' });
  const asRule = (e: FixedExpense): AutomationRule => ({
    id: e.id, name: e.name, amount: e.amount, targetKind: e.destinationKind!, debtId: e.debtId,
    startMonth: '2026-08', lastPostedMonth: e.lastPostedMonth, uncoveredMonths: e.uncoveredMonths,
  });
  // Main catches up June and July, each month charged its interest.
  const r = 0.05 / 12;
  const charged = Math.round((1_000_000 * (1 + r) - 10_000) * (1 + r) - 10_000);
  const mainCatchUp = (stamped: FixedExpense) =>
    computeAutomationPostings([asRule(main)], state(), '2026-07', undefined, [asRule(main), asRule(stamped)])[0].newBalance;

  it("charges interest for months a newly created expense's stamp never paid", () => {
    const created = expense({ lastPostedMonth: '2026-07' });
    const stamped = { ...created, uncoveredMonths: unpaidStampMonths(undefined, created, '2026-07', [main, created]) };
    expect(stamped.uncoveredMonths).toEqual({ '2026-06': 0, '2026-07': 0 });
    expect(mainCatchUp(stamped)).toBe(charged);
  });

  it('charges interest for the months an expense resumed from a pause skipped', () => {
    const before = expense({ lastPostedMonth: '2026-04', automationPaused: true });
    const resumed = { ...before, automationPaused: undefined, lastPostedMonth: '2026-07' };
    const stamped = { ...resumed, uncoveredMonths: unpaidStampMonths(before, resumed, '2026-07', [main, before]) };
    expect(stamped.uncoveredMonths).toEqual({ '2026-06': 0, '2026-07': 0 });
    expect(mainCatchUp(stamped)).toBe(charged);
  });

  it('charges interest for months an expense pointed at the loan never paid, dropping its old record', () => {
    const before = expense({ destinationKind: 'debt', debtId: 'debt-1', lastPostedMonth: '2026-06', uncoveredMonths: { '2026-06': 0 } });
    const moved = { ...before, destinationKind: 'mortgage' as const, debtId: undefined, lastPostedMonth: '2026-07' };
    const stamped = { ...moved, uncoveredMonths: unpaidStampMonths(before, moved, '2026-07', [main, before]) };
    expect(stamped.uncoveredMonths).toEqual({ '2026-06': 0, '2026-07': 0 });
    expect(mainCatchUp(stamped)).toBe(charged);
  });

  it('keeps the old record on resume and adds only the paused months', () => {
    const before = expense({ lastPostedMonth: '2026-06', automationPaused: true, uncoveredMonths: { '2026-06': 3000 } });
    expect(unpaidStampMonths(before, before, '2026-08', [main, before])).toEqual({ '2026-06': 3000, '2026-07': 0, '2026-08': 0 });
  });

  it('records nothing when no other active expense on the loan still owes those months', () => {
    const paused = expense({ id: 'p', lastPostedMonth: '2026-01', automationPaused: true });
    const onDebt = expense({ id: 'd', destinationKind: 'debt', debtId: 'debt-1', lastPostedMonth: '2026-01' });
    const upToDate = { ...main, lastPostedMonth: '2026-07' };
    expect(unpaidStampMonths(undefined, expense(), '2026-07', [upToDate, paused, onDebt])).toBeUndefined();
    expect(unpaidStampMonths(undefined, expense({ destinationKind: undefined }), '2026-07', [main])).toBeUndefined();
  });
});
