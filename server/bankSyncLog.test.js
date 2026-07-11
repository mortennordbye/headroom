import { describe, it, expect } from 'vitest';
import { makeSyncEntry, appendSyncLog } from './bank.js';

describe('makeSyncEntry', () => {
  it('records counts on a successful outcome', () => {
    const e = makeSyncEntry({ ok: true, added: 3, fetched: 40, total: 512 }, '2026-07-11T09:00:00.000Z');
    expect(e).toEqual({ at: '2026-07-11T09:00:00.000Z', ok: true, added: 3, fetched: 40, total: 512 });
  });

  it('defaults missing/non-finite counts to 0', () => {
    const e = makeSyncEntry({ ok: true }, '2026-07-11T09:00:00.000Z');
    expect(e).toEqual({ at: '2026-07-11T09:00:00.000Z', ok: true, added: 0, fetched: 0, total: 0 });
  });

  it('records a truncated error on a failed outcome (no counts)', () => {
    const e = makeSyncEntry({ ok: false, error: 'x'.repeat(300) }, '2026-07-11T09:00:00.000Z');
    expect(e.ok).toBe(false);
    expect(e.error).toHaveLength(200);
    expect(e).not.toHaveProperty('added');
  });

  it('treats a missing ok flag as success', () => {
    expect(makeSyncEntry({ added: 1 }, 't').ok).toBe(true);
  });

  it('stores a compact summary of added transactions', () => {
    const e = makeSyncEntry(
      { ok: true, added: 2, items: [
        { id: 'a', date: '2026-07-05T00:00:00.000Z', description: 'Rema 1000', amount: 742, extra: 'dropped' },
        { date: '2026-07-06', description: 'x'.repeat(120), amount: 3.5 },
      ] },
      't',
    );
    expect(e.items).toEqual([
      { date: '2026-07-05', description: 'Rema 1000', amount: 742 },
      { date: '2026-07-06', description: 'x'.repeat(80), amount: 3.5 },
    ]);
  });

  it('omits items when none were added, and caps the list at 50', () => {
    expect(makeSyncEntry({ ok: true, items: [] }, 't')).not.toHaveProperty('items');
    const many = Array.from({ length: 60 }, (_, i) => ({ date: '2026-07-05', description: `d${i}`, amount: i }));
    expect(makeSyncEntry({ ok: true, items: many }, 't').items).toHaveLength(50);
  });
});

describe('appendSyncLog', () => {
  it('appends newest to the end and caps to max', () => {
    let log = [];
    for (let i = 1; i <= 5; i++) log = appendSyncLog(log, { at: `t${i}`, ok: true }, 3);
    expect(log.map((e) => e.at)).toEqual(['t3', 't4', 't5']);
  });

  it('tolerates a non-array starting log', () => {
    expect(appendSyncLog(undefined, { at: 't1', ok: true }, 3)).toEqual([{ at: 't1', ok: true }]);
  });
});
