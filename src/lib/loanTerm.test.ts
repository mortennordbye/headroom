import { describe, it, expect } from 'vitest';
import {
  termMonthsFromYears,
  splitTermMonths,
  yearsFromParts,
  effectiveRemainingMonths,
  paymentTermMonths,
  formatTerm,
  isValidTermParts,
  stampLegacyTerm,
} from './loanTerm';
import { calcHomeownerMortgageStatus } from './calculations';
import { loanTimeline } from './property';
import { addMonthsKey } from './date';

describe('term conversions', () => {
  it('converts years to whole months, guarding bad input', () => {
    expect(termMonthsFromYears(24.25)).toBe(291);
    expect(termMonthsFromYears(25)).toBe(300);
    expect(termMonthsFromYears(-1)).toBe(0);
    expect(termMonthsFromYears(NaN)).toBe(0);
    expect(termMonthsFromYears('25')).toBe(0);
    expect(termMonthsFromYears(undefined)).toBe(0);
  });
  it('splits and joins years and months', () => {
    expect(splitTermMonths(291)).toEqual({ years: 24, months: 3 });
    expect(splitTermMonths(0)).toEqual({ years: 0, months: 0 });
    expect(yearsFromParts(24, 3)).toBe(24.25);
    expect(termMonthsFromYears(yearsFromParts(12, 11))).toBe(155);
  });
  it('formats with zero parts left out', () => {
    const t = { years: 'år', months: 'mnd' };
    expect(formatTerm(291, t)).toBe('24 år 3 mnd');
    expect(formatTerm(288, t)).toBe('24 år');
    expect(formatTerm(5, t)).toBe('5 mnd');
    expect(formatTerm(0, t)).toBe('0 år');
  });
});

describe('effectiveRemainingMonths', () => {
  const h = { nedbetalingstid: 24.25, nedbetalingstidAsOf: '2026-11' };
  it('counts down across a year boundary', () => {
    expect(effectiveRemainingMonths(h, '2026-11')).toBe(291);
    expect(effectiveRemainingMonths(h, '2027-02')).toBe(288);
  });
  it('does not count up when the reference month precedes the entry', () => {
    expect(effectiveRemainingMonths(h, '2026-01')).toBe(291);
  });
  it('stops at 0 once the term has run out', () => {
    expect(effectiveRemainingMonths(h, '2060-01')).toBe(0);
  });
  it('treats a missing or non-string asOf as no countdown', () => {
    expect(effectiveRemainingMonths({ nedbetalingstid: 25 }, '2030-01')).toBe(300);
    expect(effectiveRemainingMonths({ nedbetalingstid: 25, nedbetalingstidAsOf: 202611 }, '2030-01')).toBe(300);
    expect(effectiveRemainingMonths(undefined, '2030-01')).toBe(0);
  });
});

describe('paymentTermMonths', () => {
  it('uses the term left at the month the balance was written', () => {
    expect(paymentTermMonths({ nedbetalingstid: 25, nedbetalingstidAsOf: '2026-01', currentMortgageBalanceAsOf: '2026-07' })).toBe(294);
  });
  it('adds months back when the balance is older than the term entry', () => {
    expect(paymentTermMonths({ nedbetalingstid: 25, nedbetalingstidAsOf: '2026-07', currentMortgageBalanceAsOf: '2026-01' })).toBe(306);
  });
  it('falls back to the stored term without both stamps', () => {
    expect(paymentTermMonths({ nedbetalingstid: 25, nedbetalingstidAsOf: '2026-01' })).toBe(300);
    expect(paymentTermMonths({ nedbetalingstid: 25, currentMortgageBalanceAsOf: 7 })).toBe(300);
  });
  it('keeps payment and rentefradrag stable while the display term counts down', () => {
    const h = {
      currentMortgageBalance: 3_000_000, nedbetalingstid: 24.25,
      nedbetalingstidAsOf: '2026-11', currentMortgageBalanceAsOf: '2026-11',
    };
    const status = () => calcHomeownerMortgageStatus(3_000_000, 3_500_000, 5, paymentTermMonths(h) / 12, 22);
    const now = status();
    // A year later, balance never updated: the money side is unchanged…
    expect(status()).toEqual(now);
    // …while the remaining term shows 12 months less and the payoff month holds.
    const later = '2027-11';
    expect(effectiveRemainingMonths(h, later)).toBe(291 - 12);
    const payoffNow = loanTimeline(undefined, effectiveRemainingMonths(h, '2026-11') / 12, '2026-11').payoffDate;
    const payoffLater = loanTimeline(undefined, effectiveRemainingMonths(h, later) / 12, later).payoffDate;
    expect(payoffNow).toBe(addMonthsKey('2026-11', 291));
    expect(payoffLater).toBe(payoffNow);
  });
});

describe('isValidTermParts', () => {
  it('accepts whole years 0-50 and months 0-11 with at least one month', () => {
    expect(isValidTermParts(24, 3)).toBe(true);
    expect(isValidTermParts(0, 1)).toBe(true);
    expect(isValidTermParts(50, 11)).toBe(true);
  });
  it('rejects zero, out-of-range and fractional parts', () => {
    expect(isValidTermParts(0, 0)).toBe(false);
    expect(isValidTermParts(12, 13)).toBe(false);
    expect(isValidTermParts(51, 0)).toBe(false);
    expect(isValidTermParts(-1, 5)).toBe(false);
    expect(isValidTermParts(2.5, 0)).toBe(false);
    expect(isValidTermParts(NaN, 0)).toBe(false);
  });
});

describe('stampLegacyTerm', () => {
  const base = { nedbetalingstid: 25, currentMortgageBalanceAsOf: '2026-02' };
  it('stamps the term saved before the countdown, and nothing else', () => {
    expect(stampLegacyTerm(base, '2026-11')).toEqual({ ...base, nedbetalingstidAsOf: '2026-11' });
  });
  it('leaves stamped, zero and missing terms alone', () => {
    const stamped = { ...base, nedbetalingstidAsOf: '2026-01' };
    expect(stampLegacyTerm(stamped, '2026-11')).toBe(stamped);
    const zero = { ...base, nedbetalingstid: 0 };
    expect(stampLegacyTerm(zero, '2026-11')).toBe(zero);
  });
});
