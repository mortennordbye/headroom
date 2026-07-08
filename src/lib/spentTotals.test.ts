import { describe, it, expect } from 'vitest';
import { sumLedgerSpent, sumDiscretionarySpent } from './spentTotals';

const days = [
  { spent: 500, discretionary: 200 }, // 300 envelope-covered
  { spent: 0, discretionary: 0 },
  { spent: 150, discretionary: 150 }, // fully discretionary
];

describe('spentTotals', () => {
  it('ledger spend counts everything that left the account', () => {
    expect(sumLedgerSpent(days)).toBe(650);
  });

  it('discretionary spend counts only what drew down the daily budget', () => {
    expect(sumDiscretionarySpent(days)).toBe(350);
  });

  it('both are 0 on an empty month', () => {
    expect(sumLedgerSpent([])).toBe(0);
    expect(sumDiscretionarySpent([])).toBe(0);
  });
});
