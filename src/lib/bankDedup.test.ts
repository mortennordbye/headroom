import { describe, it, expect } from 'vitest';
import type { DailyTransaction, DeletedBankTombstone } from '../context/FinanceContext';
import { dedupeBankTransactions, evictSupersededPending, addDeletedBankTombstones, forgetRestoredBankRows, prunableBankTombstoneIds } from './bankDedup';

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
      tx({ id: 'eb-aaaaaaaa-999', account: 'aaaaaaaa:acc', category: 'other', categorySource: 'auto' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('eb-aaaaaaaa-999');
    expect(out[0].category).toBe('groceries');
    expect(out[0].categorySource).toBe('manual');
  });

  it('rescues a segment from the dropped bare twin onto its survivor', () => {
    const out = dedupeBankTransactions([
      tx({ id: 'eb-999', segment: 'oneOff' }),
      tx({ id: 'eb-aaaaaaaa-999', account: 'aaaaaaaa:acc' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].segment).toBe('oneOff');
  });

  it('keeps a legacy bare row that has no prefixed twin', () => {
    const out = dedupeBankTransactions([
      tx({ id: 'eb-onlylegacy' }),
      tx({ id: 'eb-cccc3333-other', account: 'cccc3333:acc' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('keeps genuinely distinct transactions and manual rows; is idempotent', () => {
    const clean = [tx({ id: 'eb-cccc3333-1', account: 'cccc3333:acc' }), tx({ id: 'manual-2' }), tx({ id: 'manual-3' })];
    expect(dedupeBankTransactions(clean)).toHaveLength(3);
    expect(dedupeBankTransactions(dedupeBankTransactions(clean))).toHaveLength(3);
  });

  // A legacy bare ref can itself start with 8 hex chars + '-'. The 8-hex segment
  // only counts as a connection prefix when a known connection has it.
  it('treats eb-<8hex>-<rest> as bare when no connection has that prefix', () => {
    const out = dedupeBankTransactions([
      tx({ id: 'eb-deadbeef-5678' }),
      tx({ id: 'eb-5678' }),
    ]);
    expect(out.map((t) => t.id)).toEqual(['eb-deadbeef-5678', 'eb-5678']);
  });

  it('drops the bare twin of a legacy ref that starts with 8 hex chars + "-"', () => {
    const out = dedupeBankTransactions([
      tx({ id: 'eb-deadbeef-5678' }),
      tx({ id: 'eb-aaaa1111-deadbeef-5678', account: 'aaaa1111:acc' }),
    ]);
    expect(out.map((t) => t.id)).toEqual(['eb-aaaa1111-deadbeef-5678']);
  });

  it('still reads a real prefixed id as prefixed, known from its account key', () => {
    const out = dedupeBankTransactions([
      tx({ id: 'eb-a1b2c3d4-5678', account: 'a1b2c3d4:acc' }),
      tx({ id: 'eb-5678' }),
    ]);
    expect(out.map((t) => t.id)).toEqual(['eb-a1b2c3d4-5678']);
  });

  it('still reads a real prefixed id as prefixed, known from a connection prefix', () => {
    const out = dedupeBankTransactions([
      tx({ id: 'eb-a1b2c3d4-5678' }),
      tx({ id: 'eb-5678' }),
    ], ['eb-a1b2c3d4-']);
    expect(out.map((t) => t.id)).toEqual(['eb-a1b2c3d4-5678']);
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

  it("rescues a pending row's segment onto the booked twin, never over the twin's own", () => {
    expect(evictSupersededPending([p({ segment: 'transfer' }), b({})])[0].segment).toBe('transfer');
    expect(evictSupersededPending([p({ segment: 'transfer' }), b({ segment: 'oneOff' })])[0].segment).toBe('oneOff');
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

describe('addDeletedBankTombstones', () => {
  it("records a deleted bank row's fingerprint, without category or other display fields", () => {
    const row = tx({ id: 'eb-aaaa1111-2026-10-27-0', account: 'aaaa1111:1', category: 'groceries', merchant: 'REMA' });
    expect(addDeletedBankTombstones([], [row])).toEqual([
      { id: 'eb-aaaa1111-2026-10-27-0', date: '2026-06-28', amount: 100, account: 'aaaa1111:1', description: 'REMA 1000', kind: 'expense' },
    ]);
  });

  it('keeps the pending flag so a pending tombstone never matches', () => {
    expect(addDeletedBankTombstones([], [tx({ id: 'eb-p', pending: true })])[0].pending).toBe(true);
  });

  it('skips manual rows and ids it already holds, and returns the same array when nothing is added', () => {
    const prev = addDeletedBankTombstones([], [tx({ id: 'eb-1' })]);
    expect(addDeletedBankTombstones(prev, [tx({ id: 'eb-1' }), tx({ id: 'manual-1' })])).toBe(prev);
  });
});

describe('forgetRestoredBankRows', () => {
  // Undoing a delete puts the row back; its id must leave deletedBankIds (and its
  // tombstone go), or the next sync drops the restored row again.
  it('drops ids and tombstones of rows that are present again', () => {
    expect(forgetRestoredBankRows(['eb-1', 'eb-2'], new Set(['eb-1', 't1']))).toEqual(['eb-2']);
    const tombs = addDeletedBankTombstones([], [tx({ id: 'eb-1' }), tx({ id: 'eb-2' })]);
    expect(forgetRestoredBankRows(tombs, new Set(['eb-2'])).map((t) => t.id)).toEqual(['eb-1']);
  });

  it('returns the same array when nothing was restored', () => {
    const ids = ['eb-1'];
    expect(forgetRestoredBankRows(ids, new Set(['t1']))).toBe(ids);
  });
});

describe('prunableBankTombstoneIds', () => {
  const tomb = (id: string, date: string, account?: string): DeletedBankTombstone => ({
    id, date, amount: 100, description: 'Shop', ...(account ? { account } : {}),
  });

  it('prunes a tombstone dated before its account cutoff, and keeps the cutoff day and after', () => {
    const cutoffs = { accounts: { 'aaaa1111:u1': '2026-05-02' } };
    const out = prunableBankTombstoneIds([
      tomb('eb-aaaa1111-old', '2026-04-01', 'aaaa1111:u1'),
      tomb('eb-aaaa1111-edge', '2026-05-02', 'aaaa1111:u1'),
      tomb('eb-aaaa1111-new', '2026-05-20', 'aaaa1111:u1'),
    ], cutoffs);
    expect([...out]).toEqual(['eb-aaaa1111-old']);
  });

  // A removed connection's account floors stay in the store, and a re-add reuses
  // the connection id (so the same account keys) and is clamped to them.
  it('prunes by a removed connection\'s kept account cutoff (re-add after remove)', () => {
    const cutoffs = { accounts: { 'bbbb2222:u1': '2026-02-01' }, prefixes: { 'eb-bbbb2222-': null } };
    const out = prunableBankTombstoneIds([
      tomb('eb-bbbb2222-old', '2026-01-10', 'bbbb2222:u1'),
      tomb('eb-bbbb2222-recent', '2026-02-20', 'bbbb2222:u1'),
      tomb('eb-bbbb2222-noacct', '2020-01-01'),
    ], cutoffs);
    expect([...out]).toEqual(['eb-bbbb2222-old']);
  });

  // After a long gap the next fetch starts at the account floor, far back; only
  // rows before it (less the margin, already in the cutoff) go.
  it('keeps everything a long-gap sync can still refetch', () => {
    const cutoffs = { accounts: { 'aaaa1111:u1': '2024-12-02' } };
    const out = prunableBankTombstoneIds([
      tomb('eb-aaaa1111-a', '2025-03-01', 'aaaa1111:u1'),
      tomb('eb-aaaa1111-b', '2024-12-02', 'aaaa1111:u1'),
      tomb('eb-aaaa1111-c', '2024-11-01', 'aaaa1111:u1'),
    ], cutoffs);
    expect([...out]).toEqual(['eb-aaaa1111-c']);
  });

  it('keeps a tombstone whose account has no cutoff (a newly granted account backfills)', () => {
    const cutoffs = { accounts: { 'aaaa1111:u1': '2026-05-01' }, prefixes: { 'eb-aaaa1111-': '2026-05-01' } };
    expect(prunableBankTombstoneIds([tomb('eb-aaaa1111-x', '2020-01-01', 'aaaa1111:u2')], cutoffs).size).toBe(0);
    expect(prunableBankTombstoneIds([tomb('eb-aaaa1111-x', '2020-01-01', 'aaaa1111:u1')], undefined).size).toBe(0);
  });

  it('falls back to the lowest matching prefix cutoff without an account, kept on none or a null', () => {
    const tombs = [tomb('eb-aaaa1111-x', '2026-02-01')];
    expect(prunableBankTombstoneIds(tombs, { prefixes: { 'eb-cccc3333-': '2026-06-01' } }).size).toBe(0);
    expect(prunableBankTombstoneIds(tombs, { prefixes: { 'eb-': null, 'eb-aaaa1111-': '2026-06-01' } }).size).toBe(0);
    expect(prunableBankTombstoneIds(tombs, { prefixes: { 'eb-': '2026-01-15', 'eb-aaaa1111-': '2026-06-01' } }).size).toBe(0);
    expect([...prunableBankTombstoneIds(tombs, { prefixes: { 'eb-': '2026-04-01', 'eb-aaaa1111-': '2026-06-01' } })]).toEqual(['eb-aaaa1111-x']);
  });

  it('keeps tombstones with an unreadable date, and a duplicate id when any copy must stay', () => {
    const cutoffs = { accounts: { a: '2026-06-01' } };
    expect(prunableBankTombstoneIds([tomb('eb-x', '', 'a'), tomb('eb-y', 'garbage', 'a')], cutoffs).size).toBe(0);
    expect(prunableBankTombstoneIds([tomb('eb-x', '2026-01-01', 'a'), tomb('eb-x', '2026-06-30', 'a')], cutoffs).size).toBe(0);
  });

  it('feeds forgetRestoredBankRows to drop ids and tombstones, leaving undated legacy ids', () => {
    const tombs = [tomb('eb-aaaa1111-old', '2026-01-01', 'a'), tomb('eb-aaaa1111-new', '2026-05-30', 'a')];
    const gone = prunableBankTombstoneIds(tombs, { accounts: { a: '2026-05-01' } });
    expect(forgetRestoredBankRows(['eb-legacy-undated', 'eb-aaaa1111-old', 'eb-aaaa1111-new'], gone)).toEqual(['eb-legacy-undated', 'eb-aaaa1111-new']);
    expect(forgetRestoredBankRows(tombs, gone).map((t) => t.id)).toEqual(['eb-aaaa1111-new']);
  });
});
