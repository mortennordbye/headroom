import { describe, it, expect } from 'vitest';
import { accountGroupLabel, accountGroupKey } from './account';
import type { DailyTransaction } from '../context/FinanceContext';

function tx(overrides: Partial<DailyTransaction>): DailyTransaction {
  return { id: '1', date: '2026-01-01', description: 'x', amount: -100, ...overrides };
}

describe('accountGroupLabel', () => {
  it('prefers the custom label, then the account name, then the bank', () => {
    expect(accountGroupLabel(tx({ account: 'acc1', accountName: 'Brukskonto', bank: 'DNB' }), { acc1: 'My Account' }))
      .toBe('My Account');
    expect(accountGroupLabel(tx({ account: 'acc1', accountName: 'Brukskonto', bank: 'DNB' }), {}))
      .toBe('Brukskonto');
    expect(accountGroupLabel(tx({ account: 'acc1', bank: 'DNB' }), {}))
      .toBe('DNB');
  });

  it('returns null for manual rows with no connected account', () => {
    expect(accountGroupLabel(tx({}), { acc1: 'My Account' })).toBeNull();
  });
});

describe('accountGroupKey', () => {
  it('groups by custom label when set, else by the account id', () => {
    expect(accountGroupKey(tx({ account: 'acc1' }), { acc1: 'Shared Label' })).toBe('Shared Label');
    expect(accountGroupKey(tx({ account: 'acc1' }), {})).toBe('acc1');
    expect(accountGroupKey(tx({ account: 'acc2' }), { acc1: 'Shared Label' })).toBe('acc2');
  });

  it('returns null for manual rows with no connected account', () => {
    expect(accountGroupKey(tx({}), {})).toBeNull();
  });
});
