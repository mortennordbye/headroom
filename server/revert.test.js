import { describe, it, expect } from 'vitest';
import { deepEqual, changedKeys, revertChange } from './revert.js';

const tx = (id, amount, category = 'groceries') => ({ id, date: '2026-06-01', description: id, amount, category });
/** Undo a change to one key: before → after was saved, current is the state now. */
const undoKey = (key, before, after, current) =>
  revertChange({ [key]: current }, { [key]: after }, before === undefined ? {} : { [key]: before }, [key]);

describe('deepEqual', () => {
  it('ignores object key order and undefined fields', () => {
    expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(deepEqual({ a: 1, x: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual({ a: 1 }, { a: '1' })).toBe(false);
    expect(deepEqual({ a: null }, { a: undefined })).toBe(false);
  });
});

describe('changedKeys', () => {
  it('lists the top-level keys that differ, including added and removed ones', () => {
    expect(changedKeys({ income: 1, aiContext: 'x', old: 1 }, { income: 2, aiContext: 'x', profile: {} }).sort())
      .toEqual(['income', 'old', 'profile']);
  });

  it('treats a missing previous blob as empty', () => {
    expect(changedKeys(null, { income: 1 })).toEqual(['income']);
  });
});

describe('revertChange', () => {
  it('restores a scalar that nothing touched since, leaving other keys alone', () => {
    const r = revertChange({ income: 2, other: 1 }, { income: 2, other: 0 }, { income: 1, other: 0 }, ['income']);
    expect(r.blob).toEqual({ income: 1, other: 1 });
  });

  it('removes a key the change added', () => {
    expect(undoKey('aiContext', undefined, 'note', 'note').blob).toEqual({});
  });

  it('refuses when the value changed again since', () => {
    const r = undoKey('income', 1, 2, 3);
    expect(r.conflicts).toEqual(['income']);
    expect(r.blob).toBeUndefined();
  });

  it('refuses when the value was deleted since, instead of rebuilding part of it', () => {
    expect(undoKey('profile', { name: 'A', city: 'B' }, { name: 'A' }, undefined).conflicts).toEqual(['profile']);
  });

  it('undoes one transaction edit while keeping rows a later bank sync added', () => {
    const r = undoKey('dailyTransactions', [tx('t1', 100), tx('t2', 200)], [tx('t1', 100, 'dining'), tx('t2', 200)],
      [tx('t1', 100, 'dining'), tx('t2', 200), tx('eb-new', 50)]);
    expect(r.blob.dailyTransactions).toEqual([tx('t1', 100), tx('t2', 200), tx('eb-new', 50)]);
  });

  it('removes a row the change added and puts back a row it deleted, at its old position', () => {
    const before = [tx('t1', 1), tx('t2', 2), tx('t3', 3)];
    const after = [tx('t1', 1), tx('t3', 3), tx('t9', 9)];
    expect(undoKey('dailyTransactions', before, after, after).blob.dailyTransactions).toEqual(before);
    const r = undoKey('dailyTransactions', before, after, [...after, tx('eb-x', 5)]);
    expect(r.blob.dailyTransactions.map((t) => t.id)).toEqual(['t1', 't2', 't3', 'eb-x']);
  });

  it('conflicts on the specific row that was edited again', () => {
    const r = undoKey('dailyTransactions', [tx('t1', 100)], [tx('t1', 100, 'dining')], [tx('t1', 100, 'health')]);
    expect(r.conflicts).toEqual(['dailyTransactions[t1]']);
  });

  it('never merges rows by id when ids repeat: whole-value or conflict', () => {
    const dupBefore = [{ id: 'x', a: 1 }, { id: 'x', a: 2 }];
    const after = [{ id: 'x', a: 1 }];
    // A later row was added, so the value isn't the saved one: no per-id merge on duplicates.
    expect(undoKey('rows', dupBefore, after, [...after, { id: 'z' }]).conflicts).toEqual(['rows']);
    // Unchanged since: the whole earlier value (both duplicates) comes back.
    expect(undoKey('rows', dupBefore, after, after).blob.rows).toEqual(dupBefore);
  });

  it('merges a set of ids per element (deletedBankIds after a later delete)', () => {
    const r = undoKey('deletedBankIds', ['eb-a'], ['eb-a', 'eb-b'], ['eb-a', 'eb-b', 'eb-c']);
    expect(r.blob.deletedBankIds).toEqual(['eb-a', 'eb-c']);
    expect(undoKey('deletedBankIds', ['eb-a'], ['eb-a', 'eb-b'], ['eb-a']).conflicts).toEqual(['deletedBankIds[eb-b]']);
  });

  it('merges plain objects per field', () => {
    const r = undoKey('monthlyIncomes', { '2026-06': 60000 }, { '2026-06': 61000 }, { '2026-06': 61000, '2026-07': 59000 });
    expect(r.blob.monthlyIncomes).toEqual({ '2026-06': 60000, '2026-07': 59000 });
  });

  it('keeps null distinct from absent', () => {
    const r = undoKey('employerSalaryOverride', null, 800000, 800000);
    expect(r.blob).toEqual({ employerSalaryOverride: null });
  });

  it('undoing an undo re-applies the change', () => {
    const first = undoKey('income', 1, 2, 2).blob; // undo: back to 1
    expect(revertChange(first, first, { income: 2 }, ['income']).blob).toEqual({ income: 2 });
  });

  it('is all-or-nothing across keys', () => {
    const r = revertChange(
      { income: 2, aiContext: 'changed again' },
      { income: 2, aiContext: 'mine' },
      { income: 1, aiContext: '' },
      ['income', 'aiContext'],
    );
    expect(r.conflicts).toEqual(['aiContext']);
  });
});
