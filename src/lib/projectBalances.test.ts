import { describe, it, expect } from 'vitest';
import { projectSnapshotBalances, monthsAhead, type ProjectionRates } from './projectBalances';
import type { AutomationRule, AutomationState } from './automation';
import type { SnapshotBalances } from './snapshots';

const NOW = '2026-08';

const base = (over: Partial<SnapshotBalances> = {}): SnapshotBalances => ({
  savingsAccounts: [{ id: 'sav-1', name: 'Ferie', balance: 10_000 } as SnapshotBalances['savingsAccounts'][number]],
  bsu: 50_000,
  bufferAccount: 20_000,
  portfolio: 656_009,
  crypto: 5_000,
  houseValue: 4_000_000,
  houseDebt: 2_000_000,
  debts: [{ id: 'd-1', name: 'Studielån', balance: 200_000, rate: 5 } as SnapshotBalances['debts'][number]],
  otpBalance: 300_000,
  ipsBalance: 100_000,
  ...over,
});

const state = (over: Partial<AutomationState> = {}): AutomationState => ({
  savings: { 'sav-1': 10_000 },
  scalars: { bufferAccount: 20_000, portfolio: 656_009, bsu: 50_000, pensionOtp: 300_000, pensionIps: 100_000 },
  mortgage: 2_000_000,
  mortgageRate: 5,
  debts: { 'd-1': { balance: 200_000, rate: 5 } },
  housingMode: 'homeowner',
  ...over,
});

const rule = (over: Partial<AutomationRule> = {}): AutomationRule => ({
  id: 'r-1',
  name: 'Aksjer og fond',
  amount: 1_383,
  targetKind: 'portfolio',
  startMonth: '2026-09',
  lastPostedMonth: NOW,
  ...over,
});

describe('monthsAhead', () => {
  it('counts whole months forward', () => {
    expect(monthsAhead('2026-08', '2026-09')).toBe(1);
    expect(monthsAhead('2026-08', '2026-12')).toBe(4);
    expect(monthsAhead('2026-08', '2027-08')).toBe(12);
  });

  it('is 0 for the same or an earlier month', () => {
    expect(monthsAhead('2026-08', '2026-08')).toBe(0);
    expect(monthsAhead('2026-08', '2026-07')).toBe(0);
  });
});

describe('projectSnapshotBalances — contributions only', () => {
  it('adds one month of the rule to its destination', () => {
    // The reported case: 656 009 + one 1 383 kr transfer.
    const out = projectSnapshotBalances(base(), [rule()], state(), '2026-09', NOW);
    expect(out.portfolio).toBe(657_392);
  });

  it('scales with the distance travelled', () => {
    const out = projectSnapshotBalances(base(), [rule()], state(), '2026-12', NOW);
    expect(out.portfolio).toBe(656_009 + 1_383 * 4);
  });

  it('leaves untouched buckets exactly alone', () => {
    const out = projectSnapshotBalances(base(), [rule()], state(), '2027-08', NOW);
    expect(out.crypto).toBe(5_000);
    expect(out.houseValue).toBe(4_000_000);
    expect(out.bsu).toBe(50_000);
    expect(out.bufferAccount).toBe(20_000);
  });

  it('routes each target kind to the right field', () => {
    const rules = [
      rule({ id: 'a', targetKind: 'savingsAccount', savingsAccountId: 'sav-1', amount: 500 }),
      rule({ id: 'b', targetKind: 'bufferAccount', amount: 500 }),
      rule({ id: 'c', targetKind: 'bsu', amount: 100 }),
      rule({ id: 'd', targetKind: 'pensionOtp', amount: 2_000 }),
      rule({ id: 'e', targetKind: 'pensionIps', amount: 1_000 }),
    ];
    const out = projectSnapshotBalances(base(), rules, state(), '2026-10', NOW);
    expect(out.savingsAccounts[0].balance).toBe(10_000 + 500 * 2);
    expect(out.bufferAccount).toBe(20_000 + 500 * 2);
    expect(out.bsu).toBe(50_000 + 100 * 2);
    expect(out.otpBalance).toBe(300_000 + 2_000 * 2);
    expect(out.ipsBalance).toBe(100_000 + 1_000 * 2);
  });

  it('amortizes a mortgage payment down rather than adding it up', () => {
    const out = projectSnapshotBalances(
      base(), [rule({ targetKind: 'mortgage', amount: 20_000 })], state(), '2026-09', NOW);
    expect(out.houseDebt).toBeLessThan(2_000_000);
    // One month's interest at 5%/yr on 2M is ~8 333, so ~11 667 comes off.
    expect(out.houseDebt).toBeGreaterThan(2_000_000 - 20_000);
  });

  it('amortizes an extra debt payment', () => {
    const out = projectSnapshotBalances(
      base(), [rule({ targetKind: 'debt', debtId: 'd-1', amount: 5_000 })], state(), '2026-09', NOW);
    expect(out.debts[0].balance).toBeLessThan(200_000);
  });

  it('stacks two rules pointed at the same destination', () => {
    const rules = [rule({ id: 'a', amount: 1_000 }), rule({ id: 'b', amount: 500 })];
    const out = projectSnapshotBalances(base(), rules, state(), '2026-09', NOW);
    expect(out.portfolio).toBe(656_009 + 1_500);
  });

  it('returns the base unchanged for the current or a past month', () => {
    expect(projectSnapshotBalances(base(), [rule()], state(), NOW, NOW).portfolio).toBe(656_009);
    expect(projectSnapshotBalances(base(), [rule()], state(), '2026-07', NOW).portfolio).toBe(656_009);
  });

  it('is a no-op with no rules', () => {
    expect(projectSnapshotBalances(base(), [], state(), '2027-08', NOW)).toEqual(base());
  });

  it('skips a rule whose destination no longer exists', () => {
    const out = projectSnapshotBalances(
      base(), [rule({ targetKind: 'savingsAccount', savingsAccountId: 'gone' })], state(), '2026-09', NOW);
    expect(out.savingsAccounts[0].balance).toBe(10_000);
  });
});

describe('projectSnapshotBalances — with assumed growth', () => {
  const rates: ProjectionRates = { portfolio: 7, cash: 1, crypto: 0, house: 3 };

  it('compounds growth on the opening balance on top of the contributions', () => {
    const out = projectSnapshotBalances(base(), [rule()], state(), '2027-08', NOW, rates);
    const contributions = 1_383 * 12;
    const grown = 656_009 * 1.07;
    expect(out.portfolio).toBe(Math.round(grown + contributions));
  });

  it('grows buckets that no rule touches', () => {
    const out = projectSnapshotBalances(base(), [], state(), '2027-08', NOW, rates);
    expect(out.houseValue).toBe(Math.round(4_000_000 * 1.03));
    expect(out.bufferAccount).toBe(Math.round(20_000 * 1.01));
    expect(out.savingsAccounts[0].balance).toBe(Math.round(10_000 * 1.01));
  });

  it('never grows a debt — its interest is already in the amortization', () => {
    const out = projectSnapshotBalances(base(), [], state(), '2027-08', NOW, rates);
    expect(out.debts[0].balance).toBe(200_000);
    expect(out.houseDebt).toBe(2_000_000);
  });

  it('is identical to contributions-only at a 0% rate', () => {
    const zero: ProjectionRates = { portfolio: 0, cash: 0, crypto: 0, house: 0 };
    expect(projectSnapshotBalances(base(), [rule()], state(), '2026-12', NOW, zero))
      .toEqual(projectSnapshotBalances(base(), [rule()], state(), '2026-12', NOW));
  });

  it('yields a strictly larger portfolio than contributions-only', () => {
    const withGrowth = projectSnapshotBalances(base(), [rule()], state(), '2027-08', NOW, rates);
    const without = projectSnapshotBalances(base(), [rule()], state(), '2027-08', NOW);
    expect(withGrowth.portfolio).toBeGreaterThan(without.portfolio);
  });
});

describe('projectSnapshotBalances — purity', () => {
  it('never mutates the base balances', () => {
    const input = base();
    const before = JSON.parse(JSON.stringify(input));
    projectSnapshotBalances(input, [rule()], state(), '2027-08', NOW, { portfolio: 7, cash: 1, crypto: 0, house: 3 });
    expect(input).toEqual(before);
  });

  it('never mutates the automation state', () => {
    const s = state();
    const before = JSON.parse(JSON.stringify(s));
    projectSnapshotBalances(base(), [rule()], s, '2027-08', NOW);
    expect(s).toEqual(before);
  });

  it('returns fresh nested objects, so edits cannot leak back into live state', () => {
    const input = base();
    const out = projectSnapshotBalances(input, [rule()], state(), '2026-09', NOW);
    expect(out.savingsAccounts[0]).not.toBe(input.savingsAccounts[0]);
    expect(out.debts[0]).not.toBe(input.debts[0]);
  });

  it('is deterministic — same inputs, same output', () => {
    const a = projectSnapshotBalances(base(), [rule()], state(), '2027-02', NOW);
    const b = projectSnapshotBalances(base(), [rule()], state(), '2027-02', NOW);
    expect(a).toEqual(b);
  });
});
