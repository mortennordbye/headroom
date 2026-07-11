import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  startBackupSchedule, runBackup, prune, listBackups, backupFilename, newestAgeMs, parseCount,
} from './backup.js';

const SUFFIX_LEN = '.sqlite'.length;

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-backup-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// A stand-in for better-sqlite3's db.backup(dest): just writes a file.
const fakeDb = { backup: async (dest) => fs.writeFileSync(dest, 'snapshot') };

describe('parseCount', () => {
  it('parses non-negative integers, else falls back', () => {
    expect(parseCount('5', 7)).toBe(5);
    expect(parseCount('0', 7)).toBe(0);
    expect(parseCount(undefined, 7)).toBe(7);
    expect(parseCount('nope', 7)).toBe(7);
    expect(parseCount('-3', 7)).toBe(7);
  });
});

describe('backupFilename', () => {
  it('is filesystem-safe and chronologically sortable', () => {
    const a = backupFilename(new Date('2026-07-11T09:30:00.000Z'));
    const b = backupFilename(new Date('2026-07-11T10:30:00.000Z'));
    expect(a).toBe('headroom-2026-07-11T09-30-00-000Z.sqlite');
    expect(a < b).toBe(true); // lexical sort == time sort
    expect(a).not.toContain(':'); // ':' is unsafe in filenames on some platforms
    expect(a.slice(0, -SUFFIX_LEN)).not.toContain('.'); // no '.' in the timestamp stem
  });
});

describe('prune', () => {
  const write = (name) => fs.writeFileSync(path.join(dir, name), 'x');

  it('keeps only the N newest snapshots, deleting the oldest', () => {
    for (const d of ['01', '02', '03', '04', '05']) write(`headroom-2026-07-${d}T00-00-00-000Z.sqlite`);
    const removed = prune(dir, 2);
    expect(removed).toEqual([
      'headroom-2026-07-01T00-00-00-000Z.sqlite',
      'headroom-2026-07-02T00-00-00-000Z.sqlite',
      'headroom-2026-07-03T00-00-00-000Z.sqlite',
    ]);
    expect(listBackups(dir)).toHaveLength(2);
  });

  it('prunes nothing when keep is 0 or fewer files than keep', () => {
    write('headroom-2026-07-01T00-00-00-000Z.sqlite');
    expect(prune(dir, 0)).toEqual([]);
    expect(prune(dir, 5)).toEqual([]);
    expect(listBackups(dir)).toHaveLength(1);
  });

  it('ignores unrelated files', () => {
    write('headroom-2026-07-01T00-00-00-000Z.sqlite');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
    prune(dir, 0);
    expect(listBackups(dir)).toEqual(['headroom-2026-07-01T00-00-00-000Z.sqlite']);
  });
});

describe('runBackup', () => {
  it('creates the dir, writes a snapshot, and prunes to keep', async () => {
    const sub = path.join(dir, 'backups');
    let d = new Date('2026-07-01T00:00:00.000Z');
    for (let i = 0; i < 4; i++) {
      await runBackup(fakeDb, sub, 2, d);
      d = new Date(d.getTime() + 24 * 3600_000);
    }
    const files = listBackups(sub);
    expect(files).toHaveLength(2);
    expect(files[files.length - 1]).toBe('headroom-2026-07-04T00-00-00-000Z.sqlite');
    expect(fs.readFileSync(path.join(sub, files[0]), 'utf8')).toBe('snapshot');
  });
});

describe('newestAgeMs', () => {
  it('is Infinity with no snapshots', () => {
    expect(newestAgeMs(dir, new Date())).toBe(Infinity);
  });
});

describe('startBackupSchedule', () => {
  it('returns null when disabled (intervalHours <= 0)', () => {
    expect(startBackupSchedule(fakeDb, dir, { intervalHours: 0, keep: 7 })).toBeNull();
    expect(startBackupSchedule(fakeDb, dir, { intervalHours: -1, keep: 7 })).toBeNull();
  });

  it('backs up promptly on first start when no snapshot exists, then can be stopped', async () => {
    const logs = [];
    const handle = startBackupSchedule(fakeDb, dir, {
      intervalHours: 24, keep: 3, log: (m) => logs.push(m), clock: () => new Date('2026-07-11T00:00:00.000Z'),
    });
    expect(handle).not.toBeNull();
    // firstDelay is 0 (no existing snapshot) → the timeout fires on the next tick.
    await new Promise((r) => setTimeout(r, 20));
    expect(listBackups(handle.dir)).toHaveLength(1);
    handle.stop();
  });
});
