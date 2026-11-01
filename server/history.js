// Schema and statements for finance_history, the rolling per-write snapshots of
// the finance blob (see recordHistory in index.js). Kept apart from index.js so
// the migration and the prune/list queries can be tested on a throwaway DB.

/** Create or upgrade the finance_history table. Idempotent; run on every startup. */
function migrateHistory(db) {
  // Kept IN the volume (separate from the blob itself, like auth/caches). A
  // fine-grained undo/restore net on top of the coarse nightly .sqlite backups:
  // every committed revision is snapshotted here, with who wrote it and what it
  // changed, and pruned to the retention window (DATA_HISTORY_DAYS).
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_history (
      rev INTEGER PRIMARY KEY,
      ts TEXT NOT NULL,
      content TEXT NOT NULL
    );
  `);
  // Who made each revision and what it changed (see appendHistory). Older rows
  // have NULLs: they can still be restored, just not undone on their own.
  const cols = db.prepare('PRAGMA table_info(finance_history)').all().map((c) => c.name);
  if (!cols.includes('source')) db.exec('ALTER TABLE finance_history ADD COLUMN source TEXT');
  if (!cols.includes('label')) db.exec('ALTER TABLE finance_history ADD COLUMN label TEXT');
  if (!cols.includes('change')) db.exec('ALTER TABLE finance_history ADD COLUMN change TEXT');
  // Each snapshot's size, stored at insert so the size prune doesn't read every
  // snapshot on each save. The backfill runs on every startup, not just when the
  // column is added: an older image rolled back to inserts rows without bytes,
  // which would otherwise count as 0 toward the cap. A no-op once filled.
  if (!cols.includes('bytes')) db.exec('ALTER TABLE finance_history ADD COLUMN bytes INTEGER');
  db.exec('UPDATE finance_history SET bytes = LENGTH(content) WHERE bytes IS NULL');
  // bytes sits after content in the row, so reading it from the table still
  // walks each snapshot's overflow pages. The covering index lets the prune's
  // running total skip the table entirely.
  db.exec('CREATE INDEX IF NOT EXISTS finance_history_rev_bytes ON finance_history (rev, bytes)');
}

/** Prepared statements over finance_history. Call after migrateHistory. */
function historyStatements(db) {
  return {
    // content is bound twice: once stored, once measured.
    insert: db.prepare(
      'INSERT OR REPLACE INTO finance_history (rev, ts, content, source, label, change, bytes) VALUES (?, ?, ?, ?, ?, ?, LENGTH(?))'
    ),
    newest: db.prepare(
      'SELECT rev, ts, source, change FROM finance_history ORDER BY rev DESC LIMIT 1'
    ),
    delete: db.prepare('DELETE FROM finance_history WHERE rev = ?'),
    // Drop revisions past the retention window, keeping the newest MIN.
    pruneAge: db.prepare(
      'DELETE FROM finance_history WHERE ts < ? AND rev NOT IN (SELECT rev FROM finance_history ORDER BY rev DESC LIMIT ?)'
    ),
    // Drop the oldest revisions once the newest ones already add up to MAX_BYTES.
    pruneBytes: db.prepare(
      'DELETE FROM finance_history WHERE rev IN (' +
      'SELECT rev FROM (SELECT rev, SUM(bytes) OVER (ORDER BY rev DESC) AS total FROM finance_history) WHERE total > ?' +
      ') AND rev NOT IN (SELECT rev FROM finance_history ORDER BY rev DESC LIMIT ?)'
    ),
    list: db.prepare(
      'SELECT rev, ts, bytes, source, label, change FROM finance_history ORDER BY rev DESC'
    ),
    get: db.prepare('SELECT rev, ts, content, source, label, change FROM finance_history WHERE rev = ?'),
  };
}

module.exports = { migrateHistory, historyStatements };
