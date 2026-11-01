import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// bank.js resolves DATA_DIR, EB_APP_ID and EB_DAYS when it loads, so set them first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'headroom-floor-'));
process.env.DATA_DIR = dir;
process.env.EB_APP_ID = '00000000-0000-4000-8000-000000000000';
process.env.EB_DAYS = '90';
const bank = createRequire(import.meta.url)('./bank.js');
const sessionPath = path.join(dir, 'eb-session.json');
const readStore = () => JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
const writeStore = (s) => fs.writeFileSync(sessionPath, JSON.stringify(s));
const day = 864e5;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const validUntil = () => new Date(Date.now() + 30 * day).toISOString();
const conn = (id8, accounts, extra = {}) => ({
  id: `${id8}-x`, aspsp: `Bank ${id8}`, idPrefix: `eb-${id8}-`, session_id: `s-${id8}`, valid_until: validUntil(),
  accounts: accounts.map((uid) => ({ uid })), ...extra,
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllGlobals());

describe('fetchFromDate', () => {
  const now = Date.parse('2026-06-30T12:00:00Z');
  const c = conn('aaaa1111', ['u1', 'u2'], { last_sync: '2026-06-20T08:00:00Z' });

  it('starts an account with a floor at its floor, even after a long gap or a re-add', () => {
    const floors = { 'aaaa1111:u1': '2025-01-03' };
    expect(bank.fetchFromDate(c, c.accounts[0], floors, now)).toBe('2025-01-03');
    expect(bank.fetchFromDate({ ...c, last_sync: null }, c.accounts[0], floors, now, 3650)).toBe('2025-01-03');
  });

  it('backfills `days` for an account with no floor in a floored connection (newly granted)', () => {
    expect(bank.fetchFromDate(c, c.accounts[1], { 'aaaa1111:u1': '2026-06-13' }, now, 90)).toBe('2026-04-01');
  });

  it('keeps the last_sync window for a connection from before floors existed', () => {
    expect(bank.fetchFromDate(c, c.accounts[1], {}, now)).toBe('2026-06-13');
    expect(bank.fetchFromDate({ ...c, last_sync: null }, c.accounts[1], {}, now, 90)).toBe('2026-04-01');
  });

  it('never starts in the future when a stored floor is', () => {
    expect(bank.fetchFromDate(c, c.accounts[0], { 'aaaa1111:u1': '2027-01-01' }, now)).toBe('2026-06-30');
  });
});

describe('dropRowsBeforeFloor', () => {
  const now = Date.parse('2026-06-30T12:00:00Z');
  const floors = { 'aaaa1111:u1': '2026-06-01' };
  const row = (id, date, account = 'aaaa1111:u1') => ({ id, date, account });

  it('drops new rows a bank returned from before floor minus the margin', () => {
    const rows = [row('old', '2026-04-15'), row('edge', '2026-05-02'), row('new', '2026-06-20'), row('known', '2026-01-01'), row('other', '2020-01-01', 'bbbb2222:u1')];
    const out = bank.dropRowsBeforeFloor(rows, new Set(['known']), floors, now);
    expect(out.map((r) => r.id)).toEqual(['edge', 'new', 'known', 'other']);
  });
});

describe('fetchMappedTransactions + recordSync', () => {
  const pem = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.writeFileSync(path.join(dir, 'eb-key.pem'), pem);
  const tx = (ref, date) => ({ entry_reference: ref, booking_date: date, status: 'BOOK', credit_debit_indicator: 'DBIT', transaction_amount: { amount: '10', currency: 'NOK' } });

  // A: u1 floored, u2 newly granted. B: consent refused (403). C: no accounts.
  const setup = () => {
    writeStore({
      connections: [conn('cccc3333', []), conn('aaaa1111', ['u1', 'u2']), conn('bbbb2222', ['b1'], { last_sync: '2026-01-01T00:00:00Z' })],
      fetchFloors: { 'aaaa1111:u1': '2026-03-01', 'bbbb2222:b1': '2025-12-25' },
    });
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = new URL(url);
      calls.push({ path: u.pathname, from: u.searchParams.get('date_from') });
      const reply = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
      if (u.pathname.startsWith('/sessions/')) return reply(200, { accounts: [] });
      if (u.pathname === '/accounts/b1/transactions') return reply(403, { error: 'no' });
      return reply(200, { transactions: [tx(`${u.pathname.split('/')[2]}-1`, '2026-06-01')] });
    }));
    return calls;
  };

  it('passes the clamped date to the bank and reports only what was fetched', async () => {
    const calls = setup();
    const res = await bank.fetchMappedTransactions();
    const from = Object.fromEntries(calls.filter((c) => c.from).map((c) => [c.path.split('/')[2], c.from]));
    expect(from.u1).toBe('2026-03-01');
    expect(from.u2).toBe(isoDay(Date.now() - 90 * day));
    expect(from.b1).toBe('2025-12-25');
    expect(res.rows.map((r) => r.account).sort()).toEqual(['aaaa1111:u1', 'aaaa1111:u2']);
    expect(res.synced).toEqual([
      { connectionId: 'cccc3333-x', sessionId: 's-cccc3333', accountKeys: [], complete: false },
      { connectionId: 'aaaa1111-x', sessionId: 's-aaaa1111', accountKeys: ['aaaa1111:u1', 'aaaa1111:u2'], complete: true },
      { connectionId: 'bbbb2222-x', sessionId: 's-bbbb2222', accountKeys: [], complete: false },
    ]);
    expect(res.floors).toEqual({ 'aaaa1111:u1': '2026-03-01', 'bbbb2222:b1': '2025-12-25' });

    bank.recordSync({ ok: true, synced: res.synced });
    const store = readStore();
    const nextFrom = isoDay(Date.now() - 7 * day);
    expect(store.fetchFloors).toEqual({ 'aaaa1111:u1': nextFrom, 'aaaa1111:u2': nextFrom, 'bbbb2222:b1': '2025-12-25' });
    const byId = Object.fromEntries(store.connections.map((c) => [c.id, c]));
    expect(byId['aaaa1111-x'].last_sync).toBeTruthy();
    expect(byId['bbbb2222-x'].last_sync).toBe('2026-01-01T00:00:00Z');
    expect(byId['bbbb2222-x'].needs_relink).toBe(true);
    expect(byId['cccc3333-x'].last_sync).toBeUndefined();
  });

  it('does not raise floors on a failed sync, for a connection re-linked mid-sync, or downwards', async () => {
    setup();
    const res = await bank.fetchMappedTransactions();
    bank.recordSync({ ok: false, error: 'boom' });
    expect(readStore().fetchFloors['aaaa1111:u1']).toBe('2026-03-01');
    // finishLink replaced the session between the fetch and the record.
    const s = readStore();
    s.connections.find((c) => c.id === 'aaaa1111-x').session_id = 's-new';
    writeStore(s);
    bank.recordSync({ ok: true, synced: res.synced });
    expect(readStore().fetchFloors).toEqual({ 'aaaa1111:u1': '2026-03-01', 'bbbb2222:b1': '2025-12-25' });
    // A floor already later than the next fetch start stays.
    writeStore({ connections: [conn('aaaa1111', ['u1'])], fetchFloors: { 'aaaa1111:u1': '2099-01-01' } });
    bank.recordSync({ ok: true, synced: [{ connectionId: 'aaaa1111-x', sessionId: 's-aaaa1111', accountKeys: ['aaaa1111:u1'], complete: true }] });
    expect(readStore().fetchFloors['aaaa1111:u1']).toBe('2099-01-01');
  });
});

describe('tombstone cutoffs in status', () => {
  it('reports account cutoffs, prefix fallbacks, keeps floors across a remove, and flags future floors', () => {
    const today = isoDay(Date.now());
    writeStore({
      connections: [conn('aaaa1111', ['u1', 'u2']), conn('bbbb2222', ['b1']), conn('dddd4444', ['d1', 'd2'])],
      fetchFloors: { 'aaaa1111:u1': '2026-05-01', 'aaaa1111:u2': '2026-06-01', 'bbbb2222:b1': '2026-05-01', 'dddd4444:d1': '2026-05-01', 'eeee5555:e1': '2999-01-01' },
    });
    bank.removeConnection('bbbb2222-x');
    expect(readStore().fetchFloors['bbbb2222:b1']).toBe('2026-05-01');
    const status = bank.getStatus();
    expect(status.tombstoneCutoffs.accounts).toEqual({
      'aaaa1111:u1': '2026-04-01', 'aaaa1111:u2': '2026-05-02', 'bbbb2222:b1': '2026-04-01', 'dddd4444:d1': '2026-04-01',
      'eeee5555:e1': isoDay(Date.parse(today) - 30 * day),
    });
    expect(status.tombstoneCutoffs.prefixes).toEqual({ 'eb-aaaa1111-': '2026-04-01', 'eb-dddd4444-': null, 'eb-bbbb2222-': null });
    expect(status.futureFloors).toEqual(['eeee5555:e1']);
  });
});
