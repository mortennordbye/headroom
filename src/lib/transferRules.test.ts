import { describe, it, expect } from 'vitest';
import { matchesTransferRule, excludedTransferIds, type TransferRule } from './transferRules';
import type { DailyTransaction } from '../context/FinanceContext';

const rules: TransferRule[] = [
  { id: '1', match: 'Til:90467295445' },
  { id: '2', match: 'MORROW BANK' },
  { id: '3', match: '9046.13' },
];

describe('matchesTransferRule', () => {
  it('matches a rule as a case-insensitive substring of merchant+description', () => {
    expect(matchesTransferRule({ description: 'Til:90467295445' }, rules)).toBe(true);
    expect(matchesTransferRule({ description: 'til: morrow bank asa betalt' }, rules)).toBe(true);
    expect(matchesTransferRule({ description: 'Til: 9046.13.03489 Betalt: 10.07.26' }, rules)).toBe(true);
    expect(matchesTransferRule({ merchant: 'MORROW BANK ASA', description: '' }, rules)).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(matchesTransferRule({ description: 'REMA 1000 KORSVOLL' }, rules)).toBe(false);
    expect(matchesTransferRule({ merchant: 'Trustly Norway AS', description: '' }, rules)).toBe(false);
  });

  it('ignores blank matches and empty rule sets', () => {
    expect(matchesTransferRule({ description: 'anything' }, [{ id: 'a', match: '   ' }])).toBe(false);
    expect(matchesTransferRule({ description: 'anything' }, [])).toBe(false);
  });
});

describe('excludedTransferIds', () => {
  const txs: DailyTransaction[] = [
    { id: 'a', date: '2026-06-01', description: 'REMA 1000', amount: 500, kind: 'expense' },
    { id: 'b', date: '2026-06-02', description: 'Til: MORROW BANK ASA', amount: 9000, kind: 'expense' },
    // An auto-detected pair: equal amount, opposite kind, different accounts, same day.
    { id: 'c', date: '2026-06-03', description: 'Overføring', amount: 3000, kind: 'expense', account: 'acc1' },
    { id: 'd', date: '2026-06-03', description: 'Innskudd', amount: 3000, kind: 'income', account: 'acc2' },
  ];

  it('combines rule matches with auto-detected transfer pairs', () => {
    const ids = excludedTransferIds(txs, [{ id: 'r', match: 'MORROW BANK' }]);
    expect(ids.has('b')).toBe(true); // rule-matched one-legged transfer
    expect(ids.has('c')).toBe(true); // auto-detected pair leg
    expect(ids.has('d')).toBe(true); // auto-detected pair leg
    expect(ids.has('a')).toBe(false); // ordinary spend stays
  });

  it('returns only auto-detected pairs when there are no rules', () => {
    const ids = excludedTransferIds(txs, []);
    expect(ids.has('c')).toBe(true);
    expect(ids.has('d')).toBe(true);
    expect(ids.has('b')).toBe(false); // no rule → the one-legged move counts as spend
  });
});
