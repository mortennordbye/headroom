import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrateHistory, historyStatements } from './history.js';

let db;
beforeEach(() => { db = new Database(':memory:'); });
afterEach(() => { db.close(); });

const insert = (stmts, rev, content) =>
  stmts.insert.run(rev, `2026-01-0${rev}T00:00:00.000Z`, content, 'ui', null, null, content);

describe('migrateHistory', () => {
  it('adds bytes to a pre-bytes table and backfills existing rows', () => {
    // The table as volumes from before the bytes column have it.
    db.exec(`CREATE TABLE finance_history (rev INTEGER PRIMARY KEY, ts TEXT NOT NULL, content TEXT NOT NULL,
      source TEXT, label TEXT, change TEXT)`);
    db.prepare('INSERT INTO finance_history (rev, ts, content) VALUES (?, ?, ?)').run(1, 't1', 'abc');
    db.prepare('INSERT INTO finance_history (rev, ts, content) VALUES (?, ?, ?)').run(2, 't2', '{"æøå":1}');

    migrateHistory(db);

    const rows = db.prepare('SELECT rev, bytes, LENGTH(content) AS len FROM finance_history ORDER BY rev').all();
    expect(rows).toEqual([{ rev: 1, bytes: 3, len: 3 }, { rev: 2, bytes: 9, len: 9 }]);
  });

  it('prunes backfilled rows the same as new ones', () => {
    db.exec(`CREATE TABLE finance_history (rev INTEGER PRIMARY KEY, ts TEXT NOT NULL, content TEXT NOT NULL,
      source TEXT, label TEXT, change TEXT)`);
    db.prepare('INSERT INTO finance_history (rev, ts, content) VALUES (?, ?, ?)').run(1, 't1', 'x'.repeat(10));
    migrateHistory(db);
    const stmts = historyStatements(db);
    insert(stmts, 2, 'x'.repeat(10));
    stmts.pruneBytes.run(15, 1);
    expect(stmts.list.all().map((r) => r.rev)).toEqual([2]);
  });

  it('is idempotent and creates the table on a fresh DB', () => {
    migrateHistory(db);
    migrateHistory(db);
    const cols = db.prepare('PRAGMA table_info(finance_history)').all().map((c) => c.name);
    expect(cols).toEqual(['rev', 'ts', 'content', 'source', 'label', 'change', 'bytes']);
  });

  it('lets the size prune read sizes from the covering index', () => {
    migrateHistory(db);
    const plan = db.prepare(
      'EXPLAIN QUERY PLAN SELECT rev, SUM(bytes) OVER (ORDER BY rev DESC) AS total FROM finance_history'
    ).all().map((r) => r.detail).join('\n');
    expect(plan).toContain('COVERING INDEX finance_history_rev_bytes');
  });
});

describe('historyStatements', () => {
  let stmts;
  beforeEach(() => {
    migrateHistory(db);
    stmts = historyStatements(db);
  });

  it('stores each snapshot size at insert and lists it', () => {
    insert(stmts, 1, 'x'.repeat(5));
    insert(stmts, 2, '{"a":"ø"}');
    const listed = stmts.list.all().map((r) => [r.rev, r.bytes]);
    const measured = db.prepare('SELECT rev, LENGTH(content) AS len FROM finance_history ORDER BY rev DESC')
      .all().map((r) => [r.rev, r.len]);
    expect(listed).toEqual(measured);
    expect(listed).toEqual([[2, 9], [1, 5]]);
  });

  it('prunes the oldest revisions once the newer ones exceed the size cap', () => {
    for (let rev = 1; rev <= 5; rev++) insert(stmts, rev, 'x'.repeat(10));
    // Running totals newest-first: 5→10, 4→20, 3→30, 2→40, 1→50. Cap 25 drops 3, 2, 1.
    stmts.pruneBytes.run(25, 1);
    expect(stmts.list.all().map((r) => r.rev)).toEqual([5, 4]);
  });

  it('keeps the newest MIN revisions even over the size cap', () => {
    for (let rev = 1; rev <= 5; rev++) insert(stmts, rev, 'x'.repeat(10));
    stmts.pruneBytes.run(15, 3);
    expect(stmts.list.all().map((r) => r.rev)).toEqual([5, 4, 3]);
  });
});
