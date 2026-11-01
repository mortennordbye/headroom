import { describe, it, expect } from 'vitest';
import { isValidFinancePayload } from './payload.js';

const blob = (assets = {}, fixedExpenses = []) => ({ income: 1, assets, fixedExpenses, dailyTransactions: [] });

describe('isValidFinancePayload', () => {
  it('accepts the core shape and rejects what clearly is not the blob', () => {
    expect(isValidFinancePayload(blob())).toBe(true);
    for (const bad of [null, [], 42, { income: 1 }, { ...blob(), dailyTransactions: {} }]) {
      expect(isValidFinancePayload(bad)).toBe(false);
    }
  });

  describe('assets.departedPaydowns (optional)', () => {
    const departed = (v) => isValidFinancePayload(blob({ departedPaydowns: v }));

    it('accepts a stamp per loan, with or without uncovered months', () => {
      expect(departed({ mortgage: { lastPostedMonth: '2026-06', uncoveredMonths: { '2026-05': 0, '2026-04': 1200.5 } } })).toBe(true);
      expect(departed({ 'debt:abc-123': { lastPostedMonth: '2026-12' } })).toBe(true);
      expect(departed({})).toBe(true);
    });

    it('rejects a key that is not a loan', () => {
      expect(departed({ house: { lastPostedMonth: '2026-06' } })).toBe(false);
      expect(departed({ 'debt:': { lastPostedMonth: '2026-06' } })).toBe(false);
    });

    it('rejects a month that is not yyyy-MM', () => {
      for (const m of ['2026-13', '2026-00', 'June', '2026-6', undefined]) {
        expect(departed({ mortgage: { lastPostedMonth: m } })).toBe(false);
      }
      expect(departed({ mortgage: { lastPostedMonth: '2026-06', uncoveredMonths: { '2026-13': 0 } } })).toBe(false);
    });

    it('rejects negative or non-finite uncovered amounts, and non-objects', () => {
      expect(departed({ mortgage: { lastPostedMonth: '2026-06', uncoveredMonths: { '2026-05': -1 } } })).toBe(false);
      expect(departed({ mortgage: { lastPostedMonth: '2026-06', uncoveredMonths: { '2026-05': null } } })).toBe(false);
      expect(departed([1])).toBe(false);
      expect(departed({ mortgage: [] })).toBe(false);
    });
  });

  it("checks a fixed expense's uncovered months the same way", () => {
    expect(isValidFinancePayload(blob({}, [{ id: 'e', uncoveredMonths: { '2026-05': 0 } }]))).toBe(true);
    expect(isValidFinancePayload(blob({}, [{ id: 'e', uncoveredMonths: { May: 0 } }]))).toBe(false);
    expect(isValidFinancePayload(blob({}, [{ id: 'e', uncoveredMonths: { '2026-05': -5 } }]))).toBe(false);
  });
});
