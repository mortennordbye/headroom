// Automated, rotating on-disk backups of the SQLite database.
//
// Runs inside the existing single `node index.js` process (no cron, no extra
// image package, no new dependency): on a fixed interval it uses better-sqlite3's
// built-in online `.backup()` — a consistent copy even while the DB is open — to
// write a timestamped snapshot into `${DATA_DIR}/backups`, then prunes to the N
// newest. The `db` handle is injected so this module has no hard dependency on
// better-sqlite3 and stays unit-testable with a fake.
//
// Config (env, read in index.js): BACKUP_INTERVAL_HOURS (default 24, 0 disables),
// BACKUP_KEEP (default 7). Snapshots land on the same volume as the DB; the
// off-volume `make backup` still complements them.
const fs = require('fs');
const path = require('path');

const DIR_NAME = 'backups';
const PREFIX = 'headroom-';
const SUFFIX = '.sqlite';

/** Parse a non-negative integer env value, falling back when absent/invalid. */
function parseCount(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** A filesystem-safe, chronologically-sortable snapshot filename for `date`. */
function backupFilename(date) {
  // 2026-07-11T09-30-00-000Z — ISO with ':' and '.' swapped for '-'.
  return `${PREFIX}${date.toISOString().replace(/[:.]/g, '-')}${SUFFIX}`;
}

/** Our snapshot files in a directory, oldest → newest (ISO names sort by time). */
function listBackups(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => n.startsWith(PREFIX) && n.endsWith(SUFFIX)).sort();
}

/** Delete all but the `keep` newest snapshots. `keep <= 0` prunes nothing. */
function prune(dir, keep) {
  if (keep <= 0) return [];
  const files = listBackups(dir);
  const removed = files.slice(0, Math.max(0, files.length - keep));
  for (const name of removed) {
    try {
      fs.unlinkSync(path.join(dir, name));
    } catch {
      // A backup that vanished between listing and unlink is fine to ignore.
    }
  }
  return removed;
}

/** Write one snapshot then prune. Resolves to the snapshot path. */
async function runBackup(db, dir, keep, now) {
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, backupFilename(now));
  await db.backup(dest);
  prune(dir, keep);
  return dest;
}

/** Age in ms of the newest snapshot, or Infinity when there are none. */
function newestAgeMs(dir, now) {
  const files = listBackups(dir);
  if (files.length === 0) return Infinity;
  const newest = files[files.length - 1];
  try {
    return now.getTime() - fs.statSync(path.join(dir, newest)).mtimeMs;
  } catch {
    return Infinity;
  }
}

/**
 * Start the rotating backup schedule. Returns null (disabled) when
 * `intervalHours <= 0`, else a handle with `{ dir, stop() }`. The first run is
 * delayed by the time left on the interval since the newest existing snapshot,
 * so frequent restarts don't churn (and a long-down instance backs up promptly).
 * Timers are unref'd so they never keep the process alive on their own.
 */
function startBackupSchedule(db, dataDir, { intervalHours, keep, log = console.log, clock = () => new Date() } = {}) {
  if (!(intervalHours > 0)) return null;
  const dir = path.join(dataDir, DIR_NAME);
  const intervalMs = intervalHours * 3600_000;

  const tick = () => runBackup(db, dir, keep, clock())
    .then((dest) => log(`[backup] wrote ${path.basename(dest)} (keep ${keep})`))
    .catch((err) => log(`[backup] failed: ${err && err.message}`));

  const age = newestAgeMs(dir, clock());
  const firstDelay = Math.max(0, intervalMs - (Number.isFinite(age) ? age : intervalMs));

  let interval = null;
  const first = setTimeout(() => {
    tick();
    interval = setInterval(tick, intervalMs);
    if (interval.unref) interval.unref();
  }, firstDelay);
  if (first.unref) first.unref();

  return {
    dir,
    stop() {
      clearTimeout(first);
      if (interval) clearInterval(interval);
    },
  };
}

module.exports = {
  startBackupSchedule,
  runBackup,
  prune,
  listBackups,
  backupFilename,
  newestAgeMs,
  parseCount,
};
