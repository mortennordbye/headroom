import { describe, it, expect } from 'vitest';
import { deepEqual, diffBlobs, mergeChanges, revertChange } from './revert.js';

const tx = (id, amount, category = 'groceries') => ({ id, date: '2026-06-01', description: id, amount, category });

describe('deepEqual', () => {
  it('ignores object key order and undefined fields', () => {
    expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(deepEqual({ a: 1, x: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual({ a: 1 }, { a: '1' })).toBe(false);
  });
});

describe('diffBlobs', () => {
  it('lists changed top-level keys with their prior values; added keys have no before', () => {
    const d = diffBlobs({ income: 1, aiContext: 'x', goals: [] }, { income: 2, aiContext: 'x', goals: [], profile: { name: 'A' } });
    expect(d.keys.sort()).toEqual(['income', 'profile']);
    expect(d.before).toEqual({ income: 1 });
  });

  it('treats a missing previous blob as empty', () => {
    expect(diffBlobs(null, { income: 1 })).toEqual({ keys: ['income'], before: {} });
  });
});

describe('mergeChanges', () => {
  it('keeps the earliest before for each key and unions the keys', () => {
    const m = mergeChanges({ keys: ['income'], before: { income: 1 } }, { keys: ['income', 'goals'], before: { income: 2, goals: [] } });
    expect(m.keys).toEqual(['income', 'goals']);
    expect(m.before).toEqual({ income: 1, goals: [] });
  });

  it('remembers a key that was absent before the first save', () => {
    const m = mergeChanges({ keys: ['profile'], before: {} }, { keys: ['profile'], before: { profile: { name: 'A' } } });
    expect(m.before).toEqual({});
  });
});

describe('revertChange', () => {
  it('restores a scalar that nothing touched since', () => {
    const r = revertChange({ income: 2, other: 1 }, { income: 2, other: 0 }, { keys: ['income'], before: { income: 1 } });
    expect(r.blob).toEqual({ income: 1, other: 1 });
  });

  it('removes a key the change added', () => {
    const r = revertChange({ income: 1, aiContext: 'note' }, { income: 1, aiContext: 'note' }, { keys: ['aiContext'], before: {} });
    expect(r.blob).toEqual({ income: 1 });
  });

  it('refuses when the value changed again since', () => {
    const r = revertChange({ income: 3 }, { income: 2 }, { keys: ['income'], before: { income: 1 } });
    expect(r.conflicts).toEqual(['income']);
    expect(r.blob).toBeUndefined();
  });

  it('undoes one transaction edit while keeping rows a later bank sync added', () => {
    const before = [tx('t1', 100), tx('t2', 200)];
    const after = [tx('t1', 100, 'dining'), tx('t2', 200)];
    const current = [...after, tx('eb-new', 50)];
    const r = revertChange({ dailyTransactions: current }, { dailyTransactions: after }, { keys: ['dailyTransactions'], before: { dailyTransactions: before } });
    expect(r.blob.dailyTransactions).toEqual([tx('t1', 100), tx('t2', 200), tx('eb-new', 50)]);
  });

  it('removes a row the change added and puts back a row it deleted, at its old position', () => {
    const before = [tx('t1', 1), tx('t2', 2), tx('t3', 3)];
    const after = [tx('t1', 1), tx('t3', 3), tx('t9', 9)];
    const r = revertChange({ dailyTransactions: after }, { dailyTransactions: after }, { keys: ['dailyTransactions'], before: { dailyTransactions: before } });
    // Whole value unchanged since → straight restore.
    expect(r.blob.dailyTransactions).toEqual(before);
    const later = [...after, tx('eb-x', 5)];
    const r2 = revertChange({ dailyTransactions: later }, { dailyTransactions: after }, { keys: ['dailyTransactions'], before: { dailyTransactions: before } });
    expect(r2.blob.dailyTransactions.map((t) => t.id)).toEqual(['t1', 't2', 't3', 'eb-x']);
  });

  it('conflicts on the specific row that was edited again', () => {
    const before = [tx('t1', 100)];
    const after = [tx('t1', 100, 'dining')];
    const current = [tx('t1', 100, 'health')];
    const r = revertChange({ dailyTransactions: current }, { dailyTransactions: after }, { keys: ['dailyTransactions'], before: { dailyTransactions: before } });
    expect(r.conflicts).toEqual(['dailyTransactions[t1]']);
  });

  it('merges plain objects per field', () => {
    const r = revertChange(
      { monthlyIncomes: { '2026-06': 61000, '2026-07': 59000 } },
      { monthlyIncomes: { '2026-06': 61000 } },
      { keys: ['monthlyIncomes'], before: { monthlyIncomes: { '2026-06': 60000 } } },
    );
    expect(r.blob.monthlyIncomes).toEqual({ '2026-06': 60000, '2026-07': 59000 });
  });

  it('is all-or-nothing across keys', () => {
    const r = revertChange(
      { income: 2, aiContext: 'changed again' },
      { income: 2, aiContext: 'mine' },
      { keys: ['income', 'aiContext'], before: { income: 1, aiContext: '' } },
    );
    expect(r.conflicts).toEqual(['aiContext']);
  });
});
