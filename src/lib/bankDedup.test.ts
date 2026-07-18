import { describe, it, expect } from 'vitest';
import type { DailyTransaction } from '../context/FinanceContext';
import { dedupeBankTransactions, evictSupersededPending } from './bankDedup';

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

  // Documents the known regex ambiguity (see bankDedup.ts / BACKLOG.md): an id of
  // shape `eb-<8hex>-<rest>` is always read as PREFIXED (conn=<8hex>, ref=<rest>),
  // even though a legacy bare id could theoretically have that exact text. Left
  // as-is because no safe discriminator exists; this test locks current behavior.
  it('classifies an ambiguous eb-<8hex>-<rest> id as prefixed', () => {
    const out = dedupeBankTransactions([
      tx({ id: 'eb-a1b2c3d4-5678', account: 'ambiguous' }),
      tx({ id: 'eb-5678', amount: 100 }),
    ]);
    // Read as prefixed with ref '5678'; the bare 'eb-5678' shares that ref, so it
    // is dropped as a stale twin (the survivor keeps the prefixed id).
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('eb-a1b2c3d4-5678');
  });
});

// Twin of evictSupersededPending in server/bank.js — these mirror the cases in
// bank.test.ts so the two implementations stay in lockstep.
describe('evictSupersededPending', () => {
  const p = (over: Partial<DailyTransaction>): DailyTransaction => ({
    id: 'p', date: '2026-04-05', description: 'REMA 1000', amount: 249.9, kind: 'expense', account: 'a:1', pending: true, ...over,
  });
  const b = (over: Partial<DailyTransaction>): DailyTransaction => ({
    id: 'b', date: '2026-04-06', description: 'REMA 1000', amount: 249.9, kind: 'expense', account: 'a:1', ...over,
  });

  it('drops a pending row superseded by a booked twin', () => {
    expect(evictSupersededPending([p({}), b({})]).map((t) => t.id)).toEqual(['b']);
  });

  it('keeps a pending row with no booked twin, and is a no-op without pending rows', () => {
    expect(evictSupersededPending([p({})]).map((t) => t.id)).toEqual(['p']);
    const booked = [b({ id: 'b1' }), b({ id: 'b2', amount: 10 })];
    expect(evictSupersededPending(booked)).toBe(booked);
  });

  it('does not evict on differing amount, account, or far-apart dates', () => {
    expect(evictSupersededPending([p({}), b({ amount: 250 })])).toHaveLength(2);
    expect(evictSupersededPending([p({}), b({ account: 'a:2' })])).toHaveLength(2);
    expect(evictSupersededPending([p({}), b({ date: '2026-04-20' })])).toHaveLength(2);
  });

  it('rescues a manual category from the dropped pending row onto its survivor', () => {
    const out = evictSupersededPending([p({ category: 'groceries', categorySource: 'manual' }), b({})]);
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe('groceries');
    expect(out[0].categorySource).toBe('manual');
  });
});
