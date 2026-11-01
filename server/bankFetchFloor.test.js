import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// bank.js resolves DATA_DIR when it loads, so point it at a throwaway dir first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'headroom-floor-'));
process.env.DATA_DIR = dir;
const bank = createRequire(import.meta.url)('./bank.js');
const sessionPath = path.join(dir, 'eb-session.json');
const readStore = () => JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
const day = 864e5;
const ok = { ok: true, added: 0, fetched: 0, total: 0 };

describe('fetchFromDate', () => {
  const now = Date.parse('2026-06-30T12:00:00Z');

  it('starts at last_sync minus the overlap, or `days` back on a first sync', () => {
    expect(bank.fetchFromDate({ idPrefix: 'eb-a-', last_sync: '2026-06-20T08:00:00Z' }, {}, now)).toBe('2026-06-13');
    expect(bank.fetchFromDate({ idPrefix: 'eb-a-', last_sync: null }, {}, now, 90)).toBe('2026-04-01');
  });

  // A re-add after a remove resets last_sync, and EB_DAYS may have been raised:
  // neither may reach behind the floor the client pruned against.
  it('clamps a re-add and a raised EB_DAYS to the prefix floor', () => {
    const floors = { 'eb-a-': '2026-06-01' };
    expect(bank.fetchFromDate({ idPrefix: 'eb-a-', last_sync: null }, floors, now, 90)).toBe('2026-06-01');
    expect(bank.fetchFromDate({ idPrefix: 'eb-a-', last_sync: null }, floors, now, 3650)).toBe('2026-06-01');
    // A brand-new prefix has no floor and fetches its full history.
    expect(bank.fetchFromDate({ idPrefix: 'eb-b-', last_sync: null }, floors, now, 90)).toBe('2026-04-01');
  });

  // After a long gap the live fetch starts far back, at the floor itself, so
  // nothing in that window is pruned.
  it('a long-gap live sync starts exactly at the floor it recorded', () => {
    const lastSync = '2025-01-10T00:00:00Z';
    const floor = new Date(Date.parse(lastSync) - 7 * day).toISOString().slice(0, 10);
    expect(bank.fetchFromDate({ idPrefix: 'eb-a-', last_sync: lastSync }, { 'eb-a-': floor }, now)).toBe(floor);
  });
});

describe('fetch floor in the store', () => {
  const validUntil = () => new Date(Date.now() + 30 * day).toISOString();
  const conn = (id, aspsp) => ({ id: `${id}-x`, aspsp, idPrefix: `eb-${id}-`, session_id: 's', valid_until: validUntil(), accounts: [] });

  it('recordSync raises the floor of each synced prefix, never lowers it, and only on success', () => {
    fs.writeFileSync(sessionPath, JSON.stringify({ connections: [conn('aaaa1111', 'Bank A')], fetchFloors: { 'eb-aaaa1111-': '2099-01-01' } }));
    bank.recordSync({ ok: false, error: 'boom' });
    expect(readStore().fetchFloors['eb-aaaa1111-']).toBe('2099-01-01');
    bank.recordSync(ok);
    expect(readStore().fetchFloors['eb-aaaa1111-']).toBe('2099-01-01');

    fs.writeFileSync(sessionPath, JSON.stringify({ connections: [conn('aaaa1111', 'Bank A')] }));
    bank.recordSync(ok);
    const store = readStore();
    expect(store.fetchFloors['eb-aaaa1111-']).toBe(new Date(Date.parse(store.connections[0].last_sync) - 7 * day).toISOString().slice(0, 10));
  });

  it('keeps the floor after removeConnection, and status reports it with null for unfloored prefixes', () => {
    fs.writeFileSync(sessionPath, JSON.stringify({
      connections: [conn('aaaa1111', 'Bank A'), conn('bbbb2222', 'Bank B')],
      fetchFloors: { 'eb-aaaa1111-': '2026-05-01' },
    }));
    bank.removeConnection('aaaa1111-x');
    expect(readStore().fetchFloors).toEqual({ 'eb-aaaa1111-': '2026-05-01' });
    expect(bank.getStatus().fetchFloors).toEqual({ 'eb-aaaa1111-': '2026-05-01', 'eb-bbbb2222-': null });
  });
});
