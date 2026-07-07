import { describe, it, expect } from 'vitest';
import type { DailyTransaction } from '../context/FinanceContext';
import { dedupeBankTransactions } from './bankDedup';

const tx = (over: Partial<DailyTransaction>): DailyTransaction => ({
  id: 'x', date: '2026-06-28', description: 'REMA 1000', amount: 100, kind: 'expense', ...over,
});

describe('dedupeBankTransactions', () => {
  it('drops a legacy bare row when a prefixed twin exists, keeping the prefixed one', () => {
    const out = dedupeBankTransactions([
      tx({ id: 'eb-3605340816', amount: 77.3 }),
      tx({ id: 'eb-e8a81f8a-3605340816', amount: 77.3, account: 'e8a81f8a:acc', bank: 'Bank Norwegian' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('eb-e8a81f8a-3605340816');
    expect(out[0].account).toBe('e8a81f8a:acc');
  });

  it('NEVER merges two different prefixed connections that reuse an entry_reference', () => {
    const out = dedupeBankTransactions([
      tx({ id: 'eb-aaaa1111-ref-1', account: 'aaaa1111:a' }),
      tx({ id: 'eb-bbbb2222-ref-1', account: 'bbbb2222:b' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('rescues a manual category from the dropped bare twin onto its survivor', () => {
    const out = dedupeBankTransactions([
      tx({ id: 'eb-999', category: 'groceries', categorySource: 'manual' }),
      tx({ id: 'eb-aaaaaaaa-999', account: 'x', category: 'other', categorySource: 'auto' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('eb-aaaaaaaa-999');
    expect(out[0].category).toBe('groceries');
    expect(out[0].categorySource).toBe('manual');
  });

  it('keeps a legacy bare row that has no prefixed twin', () => {
    const out = dedupeBankTransactions([
      tx({ id: 'eb-onlylegacy' }),
      tx({ id: 'eb-cccc3333-other', account: 'x' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('keeps genuinely distinct transactions and manual rows; is idempotent', () => {
    const clean = [tx({ id: 'eb-cccc3333-1', account: 'x' }), tx({ id: 'manual-2' }), tx({ id: 'manual-3' })];
    expect(dedupeBankTransactions(clean)).toHaveLength(3);
    expect(dedupeBankTransactions(dedupeBankTransactions(clean))).toHaveLength(3);
  });
});
