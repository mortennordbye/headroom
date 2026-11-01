import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// bank.js resolves DATA_DIR and EB_APP_ID when it loads, so set them first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'headroom-recordsync-'));
process.env.DATA_DIR = dir;
process.env.EB_APP_ID = '00000000-0000-4000-8000-000000000000';
const bank = createRequire(import.meta.url)('./bank.js');
const sessionPath = path.join(dir, 'eb-session.json');
const readStore = () => JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
const writeStore = (s) => fs.writeFileSync(sessionPath, JSON.stringify(s));
const day = 864e5;
const OLD_SYNC = '2026-01-01T00:00:00.000Z';
const conn = (id8, accounts, extra = {}) => ({
  id: `${id8}-x`, aspsp: `Bank ${id8}`, idPrefix: `eb-${id8}-`, session_id: `s-${id8}`,
  valid_until: new Date(Date.now() + 30 * day).toISOString(), last_sync: OLD_SYNC,
  accounts: accounts.map((uid) => ({ uid })), ...extra,
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllGlobals());

describe('fetchMappedTransactions + recordSync', () => {
  const pem = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.writeFileSync(path.join(dir, 'eb-key.pem'), pem);
  const tx = (ref) => ({ entry_reference: ref, booking_date: '2026-06-01', status: 'BOOK', credit_debit_indicator: 'DBIT', transaction_amount: { amount: '10', currency: 'NOK' } });

  // A: fetches fine. B: consent refused (403). C: no accounts.
  const setup = () => {
    writeStore({ connections: [conn('cccc3333', []), conn('aaaa1111', ['u1', 'u2']), conn('bbbb2222', ['b1'])] });
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = new URL(url);
      const reply = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
      if (u.pathname.startsWith('/sessions/')) return reply(200, { accounts: [] });
      if (u.pathname === '/accounts/b1/transactions') return reply(403, { error: 'no' });
      return reply(200, { transactions: [tx(`${u.pathname.split('/')[2]}-1`)] });
    }));
  };
  const byId = () => Object.fromEntries(readStore().connections.map((c) => [c.id, c]));

  it('reports which connections were fully fetched, and with which session', async () => {
    setup();
    const res = await bank.fetchMappedTransactions();
    expect(res.rows.map((r) => r.account).sort()).toEqual(['aaaa1111:u1', 'aaaa1111:u2']);
    expect(res.synced).toEqual([
      { connectionId: 'cccc3333-x', sessionId: 's-cccc3333', complete: false },
      { connectionId: 'aaaa1111-x', sessionId: 's-aaaa1111', complete: true },
      { connectionId: 'bbbb2222-x', sessionId: 's-bbbb2222', complete: false },
    ]);
  });

  // The 403 flags B for re-link; stamping it would clear that flag and, since a
  // re-link keeps last_sync, skip the window the error hid.
  it('stamps last_sync only on the fully fetched connection, keeping the 403 re-link flag', async () => {
    setup();
    const { synced } = await bank.fetchMappedTransactions();
    bank.recordSync({ ok: true, synced });
    const c = byId();
    expect(c['aaaa1111-x'].last_sync).not.toBe(OLD_SYNC);
    expect(c['aaaa1111-x'].needs_relink).toBe(false);
    expect(c['bbbb2222-x'].last_sync).toBe(OLD_SYNC);
    expect(c['bbbb2222-x'].needs_relink).toBe(true);
    expect(c['cccc3333-x'].last_sync).toBe(OLD_SYNC);
  });

  it('leaves a connection re-linked while the sync ran alone', async () => {
    setup();
    const { synced } = await bank.fetchMappedTransactions();
    // finishLink swapped in a new session between the fetch and the record.
    const s = readStore();
    Object.assign(s.connections.find((c) => c.id === 'aaaa1111-x'), { session_id: 's-new', needs_relink: false, relinked: true });
    writeStore(s);
    bank.recordSync({ ok: true, synced });
    expect(byId()['aaaa1111-x'].last_sync).toBe(OLD_SYNC);
    expect(byId()['aaaa1111-x'].relinked).toBe(true);
  });

  it('stamps nothing on a failed sync or one without a synced list', () => {
    writeStore({ connections: [conn('aaaa1111', ['u1'])] });
    bank.recordSync({ ok: false, error: 'boom', synced: [{ connectionId: 'aaaa1111-x', sessionId: 's-aaaa1111', complete: true }] });
    bank.recordSync({ ok: true });
    expect(byId()['aaaa1111-x'].last_sync).toBe(OLD_SYNC);
    expect(readStore().syncLog).toHaveLength(2);
  });
});
