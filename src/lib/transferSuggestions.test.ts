import { describe, it, expect } from 'vitest';
import { suggestTransferRules } from './transferSuggestions';
import type { DailyTransaction } from '../context/FinanceContext';

let n = 0;
const tx = (over: Partial<DailyTransaction>): DailyTransaction => ({
  id: `t${n++}`, date: '2026-05-10', description: 'x', amount: 0, kind: 'expense', ...over,
});

describe('suggestTransferRules', () => {
  it('groups a recurring transfer to an account number into one suggestion', () => {
    const s = suggestTransferRules([
      tx({ date: '2026-04-21', amount: 5000, description: 'Til: 9046.13.96452 Betalt: 21.04.26' }),
      tx({ date: '2026-05-21', amount: 5000, description: 'Til: 9046.13.96452 Betalt: 21.05.26' }),
    ], []);
    expect(s).toHaveLength(1);
    expect(s[0].match).toBe('9046.13.96452');
    expect(s[0].total).toBe(10000);
    expect(s[0].months).toBe(2);
    expect(s[0].txCount).toBe(2);
    expect(s[0].signals).toContain('accountNumber');
    expect(s[0].signals).toContain('recurring');
  });

  it('strips the statement noise after the payee name', () => {
    const s = suggestTransferRules([
      tx({ amount: 23000, description: 'Til: Trustly Norway AS Betalt: 21.05.26' }),
    ], []);
    expect(s[0].match).toBe('trustly norway as');
  });

  it('ranks by total so the biggest distortion comes first', () => {
    const s = suggestTransferRules([
      tx({ amount: 3000, description: 'Til: Small Dest' }),
      tx({ amount: 23000, description: 'Til: Big Dest' }),
    ], []);
    expect(s.map((x) => x.match)).toEqual(['big dest', 'small dest']);
  });

  it('ignores ordinary card spend with no transfer signal', () => {
    const s = suggestTransferRules([
      tx({ amount: 9290, description: 'ONA PALM BEACH', merchant: 'ONA PALM BEACH' }),
      tx({ amount: 5000, description: 'BIG SHOP', merchant: 'BIG SHOP' }),
    ], []);
    expect(s).toEqual([]);
  });

  it('drops small one-off payments to people', () => {
    // Real signal shape, but 800 kr once is splitting a bill, not moving savings.
    const s = suggestTransferRules([tx({ amount: 800, description: 'Til: Some Person' })], []);
    expect(s).toEqual([]);
  });

  it('keeps a small transfer that repeats across three months', () => {
    const s = suggestTransferRules([
      tx({ date: '2026-03-01', amount: 500, description: 'Til: Some Person' }),
      tx({ date: '2026-04-01', amount: 500, description: 'Til: Some Person' }),
      tx({ date: '2026-05-01', amount: 500, description: 'Til: Some Person' }),
    ], []);
    expect(s).toHaveLength(1);
    expect(s[0].months).toBe(3);
    expect(s[0].signals).toContain('recurring');
  });

  it('skips destinations an existing rule already covers', () => {
    const txs = [tx({ amount: 23000, description: 'Til: Trustly Norway AS Betalt: 21.05.26' })];
    expect(suggestTransferRules(txs, [{ id: 'r1', match: 'trustly' }])).toEqual([]);
  });

  it('skips a two-legged pair the matcher already proved internal', () => {
    // Same amount, different accounts, within 3 days → netted by transfers.ts.
    const s = suggestTransferRules([
      tx({ date: '2026-05-10', amount: 8000, description: 'Til: 9046.13.96452', account: 'a:1' }),
      tx({ date: '2026-05-11', amount: 8000, description: 'Fra konto', account: 'a:2', kind: 'income' }),
    ], []);
    expect(s).toEqual([]);
  });

  it('ignores income rows', () => {
    expect(suggestTransferRules([
      tx({ amount: 23000, description: 'Til: Trustly Norway AS', kind: 'income' }),
    ], [])).toEqual([]);
  });
});
