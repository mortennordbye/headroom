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

  it('never brings back the old mortgage balance copies a migrated blob dropped', () => {
    // The migration save dropped the copies; the balance was later set to 2 400 000.
    const before = { assets: { houseDebt: 2_500_000 }, homeowner: { currentMortgageBalance: 2_500_000, rente: 5 }, transition: { currentMortgageBalance: 2_500_000 } };
    const after = { assets: { houseDebt: 2_500_000 }, homeowner: { rente: 5 }, transition: {} };
    const current = { assets: { houseDebt: 2_400_000 }, homeowner: { rente: 5 }, transition: {} };
    const r = revertChange(current, after, before, changedKeys(before, after));
    expect(r.blob).toEqual(current);
  });

  it('undoes a balance edit saved before the copies were dropped, through assets', () => {
    const before = { assets: { houseDebt: 2_500_000 }, homeowner: { currentMortgageBalance: 2_500_000, rente: 5 }, transition: { currentMortgageBalance: 2_500_000 } };
    const after = { assets: { houseDebt: 2_400_000 }, homeowner: { currentMortgageBalance: 2_400_000, rente: 5 }, transition: { currentMortgageBalance: 2_400_000 } };
    const current = { assets: { houseDebt: 2_400_000 }, homeowner: { rente: 5 }, transition: {} };
    const r = revertChange(current, after, before, changedKeys(before, after));
    expect(r.blob).toEqual({ assets: { houseDebt: 2_500_000 }, homeowner: { rente: 5 }, transition: {} });
  });

  it('still refuses when the balance changed again since an old edit', () => {
    const before = { assets: { houseDebt: 2_500_000 }, homeowner: { currentMortgageBalance: 2_500_000 } };
    const after = { assets: { houseDebt: 2_400_000 }, homeowner: { currentMortgageBalance: 2_400_000 } };
    const current = { assets: { houseDebt: 2_300_000 }, homeowner: {} };
    expect(revertChange(current, after, before, changedKeys(before, after)).conflicts).toEqual(['assets.houseDebt']);
  });

  it('undoes an old edit to the balance shown that left the hidden assets copy unchanged', () => {
    // Drifted old data: homeowner mode showed the homeowner copy, and only that copy changed.
    const before = { housingMode: 'homeowner', assets: { houseDebt: 2_310_000 }, homeowner: { currentMortgageBalance: 2_270_000, currentMortgageBalanceAsOf: '2026-01' } };
    const after = { housingMode: 'homeowner', assets: { houseDebt: 2_310_000 }, homeowner: { currentMortgageBalance: 2_250_000, currentMortgageBalanceAsOf: '2026-04' } };
    const current = { housingMode: 'homeowner', assets: { houseDebt: 2_250_000 }, homeowner: { currentMortgageBalanceAsOf: '2026-04' } };
    expect(revertChange(current, after, before, changedKeys(before, after)).blob).toEqual(
      { housingMode: 'homeowner', assets: { houseDebt: 2_270_000 }, homeowner: { currentMortgageBalanceAsOf: '2026-01' } },
    );
  });

  it('treats an edit to the hidden assets copy as no change', () => {
    const before = { housingMode: 'homeowner', assets: { houseDebt: 2_310_000 }, homeowner: { currentMortgageBalance: 2_250_000, currentMortgageBalanceAsOf: '2026-04' } };
    const after = { housingMode: 'homeowner', assets: { houseDebt: 2_330_000 }, homeowner: { currentMortgageBalance: 2_250_000, currentMortgageBalanceAsOf: '2026-04' } };
    const current = { housingMode: 'homeowner', assets: { houseDebt: 2_250_000 }, homeowner: { currentMortgageBalanceAsOf: '2026-04' } };
    expect(revertChange(current, after, before, changedKeys(before, after)).blob).toEqual(current);
  });

  it('does not count a balance date only the load stamped as an edit', () => {
    // Undo of a restore: the restored revision had no date, the load after it stamped one.
    const before = { housingMode: 'homeowner', assets: { houseDebt: 1_800_000 }, homeowner: { currentMortgageBalanceAsOf: '2026-06' } };
    const after = { housingMode: 'homeowner', assets: { houseDebt: 1_700_000 }, homeowner: { currentMortgageBalance: 1_700_000 } };
    const current = { housingMode: 'homeowner', assets: { houseDebt: 1_700_000 }, homeowner: { currentMortgageBalanceAsOf: '2026-10' } };
    expect(revertChange(current, after, before, changedKeys(before, after)).blob).toEqual(before);
  });

  it.each(['homeowner', 'first_buyer'])('keeps a balance date set since a revision that had none on either side (%s)', (housingMode) => {
    // The revision only added a transaction; the balance date was set afterwards.
    const before = { housingMode, homeowner: { rente: 5 }, dailyTransactions: [] };
    const after = { housingMode, homeowner: { rente: 5 }, dailyTransactions: [tx('t1', -100)] };
    const current = { housingMode, homeowner: { rente: 5, currentMortgageBalanceAsOf: '2026-03' }, dailyTransactions: [tx('t1', -100)] };
    expect(revertChange(current, after, before, changedKeys(before, after)).blob).toEqual(
      { housingMode, homeowner: { rente: 5, currentMortgageBalanceAsOf: '2026-03' }, dailyTransactions: [] },
    );
  });

  it('does not borrow the current balance date outside the owner modes', () => {
    // Undo of a restore in first_buyer mode: the load stamps no balance date there.
    const before = { housingMode: 'first_buyer', homeowner: { rente: 5, currentMortgageBalanceAsOf: '2026-01' } };
    const after = { housingMode: 'first_buyer', homeowner: { rente: 4 } };
    const current = { housingMode: 'first_buyer', homeowner: { rente: 4, currentMortgageBalanceAsOf: '2026-03' } };
    expect(revertChange(current, after, before, changedKeys(before, after)).conflicts).toEqual(['homeowner.currentMortgageBalanceAsOf']);
  });

  it('does not count a loan term date only the load stamped as an edit', () => {
    // Undo of a restore of a revision saved before the term had an entry month.
    const before = { homeowner: { nedbetalingstid: 20, nedbetalingstidAsOf: '2026-01', rente: 5 } };
    const after = { homeowner: { nedbetalingstid: 22, rente: 5 } };
    const current = { homeowner: { nedbetalingstid: 22, nedbetalingstidAsOf: '2026-10', rente: 5 } };
    expect(revertChange(current, after, before, changedKeys(before, after)).blob).toEqual(before);
  });

  it('migrates a blob that was never migrated, undoing through assets', () => {
    const before = { housingMode: 'homeowner', homeowner: { currentMortgageBalance: 1, currentMortgageBalanceAsOf: '2026-01' } };
    const after = { housingMode: 'homeowner', homeowner: { currentMortgageBalance: 2, currentMortgageBalanceAsOf: '2026-01' } };
    expect(revertChange(after, after, before, ['homeowner']).blob).toEqual(
      { housingMode: 'homeowner', assets: { houseDebt: 1 }, homeowner: { currentMortgageBalanceAsOf: '2026-01' } },
    );
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
