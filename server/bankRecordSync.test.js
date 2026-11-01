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
process.env.EB_DAYS = '90';
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

  // A: fetches fine. B: consent refused (403). C: no accounts (self-heals the
  // account list, which writes the store). `onA` runs while A is fetched.
  const setup = ({ order = ['cccc3333', 'aaaa1111', 'bbbb2222'], onA = () => {} } = {}) => {
    const all = { aaaa1111: conn('aaaa1111', ['u1', 'u2']), bbbb2222: conn('bbbb2222', ['b1']), cccc3333: conn('cccc3333', []) };
    writeStore({ connections: order.map((id) => all[id]) });
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = new URL(url);
      calls.push({ path: u.pathname, from: u.searchParams.get('date_from') });
      const reply = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
      if (u.pathname === '/accounts/u1/transactions') onA();
      if (u.pathname.startsWith('/sessions/')) return reply(200, { accounts: [] });
      if (u.pathname === '/accounts/b1/transactions') return reply(403, { error: 'no' });
      return reply(200, { transactions: [tx(`${u.pathname.split('/')[2]}-1`)] });
    }));
    return calls;
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

  // The sync works from a snapshot read at its start; C's account refresh must
  // not write that snapshot back over changes made since.
  it("keeps a 403's re-link flag when a later connection refreshes its accounts", async () => {
    setup({ order: ['aaaa1111', 'bbbb2222', 'cccc3333'] });
    await bank.fetchMappedTransactions();
    expect(byId()['bbbb2222-x'].needs_relink).toBe(true);
    expect(byId()['cccc3333-x'].accounts_note).toBe('no-accounts-granted');
  });

  it('keeps a connection removed during the sync removed', async () => {
    setup({ order: ['aaaa1111', 'cccc3333'], onA: () => bank.removeConnection('cccc3333-x') });
    await bank.fetchMappedTransactions();
    expect(Object.keys(byId())).toEqual(['aaaa1111-x']);
    expect(readStore().removed.map((c) => c.id)).toEqual(['cccc3333-x']);
  });

  it('keeps a re-link made during the sync', async () => {
    const relink = () => {
      const st = readStore();
      Object.assign(st.connections.find((c) => c.id === 'cccc3333-x'), { session_id: 's-new', accounts: [{ uid: 'n1' }] });
      writeStore(st);
    };
    setup({ order: ['aaaa1111', 'cccc3333'], onA: relink });
    await bank.fetchMappedTransactions();
    expect(byId()['cccc3333-x']).toMatchObject({ session_id: 's-new', accounts: [{ uid: 'n1' }] });
  });

  it('never fetches from further back than EB_DAYS, however old last_sync is', async () => {
    const calls = setup({ order: ['aaaa1111'] });
    const st = readStore();
    st.connections[0].last_sync = new Date(Date.now() - 400 * day).toISOString();
    writeStore(st);
    await bank.fetchMappedTransactions();
    const floor = new Date(Date.now() - 90 * day).toISOString().slice(0, 10);
    expect(calls.filter((c) => c.from).map((c) => c.from)).toEqual([floor, floor]);
  });

  it("stamps each row with its linked account's number, whitespace removed", async () => {
    // Fictitious account numbers.
    writeStore({ connections: [{ ...conn('aaaa1111', []), accounts: [{ uid: 'u1', iban: 'NO12 4444 5566 666' }, { uid: 'u2' }] }] });
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const ref = new URL(url).pathname.split('/')[2];
      return { ok: true, status: 200, text: async () => JSON.stringify({ transactions: [tx(`${ref}-1`)] }) };
    }));
    const { rows } = await bank.fetchMappedTransactions();
    const byAccount = Object.fromEntries(rows.map((r) => [r.account, r.accountNumber]));
    expect(byAccount).toEqual({ 'aaaa1111:u1': 'NO1244445566666', 'aaaa1111:u2': undefined });
  });

  // Fictitious account numbers. `details` maps uid → the /details response.
  const stubAccounts = (details = {}) => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const [, , uid, what] = new URL(url).pathname.split('/');
      calls.push(`${uid}/${what}`);
      const body = what === 'details' ? (details[uid] || {}) : { transactions: [tx(`${uid}-1`)] };
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    }));
    return calls;
  };
  const numbers = (rows) => Object.fromEntries(rows.map((r) => [r.account, r.accountNumber]));

  it('leaves the number off rows from loan and card accounts, keeping unknown types', async () => {
    writeStore({ connections: [{ ...conn('aaaa1111', []), accounts: [
      { uid: 'u1', iban: '11112233333', cash_account_type: 'CACC' },
      { uid: 'u2', iban: '44445566666', cash_account_type: 'LOAN' },
      { uid: 'u3', iban: '77778899999', cash_account_type: 'CARD' },
      { uid: 'u4', iban: '12121212121' },
    ] }] });
    stubAccounts();
    const { rows } = await bank.fetchMappedTransactions();
    expect(numbers(rows)).toEqual({
      'aaaa1111:u1': '11112233333', 'aaaa1111:u2': undefined, 'aaaa1111:u3': undefined, 'aaaa1111:u4': '12121212121',
    });
  });

  it('fetches the missing account type once for accounts linked before it was captured', async () => {
    writeStore({ connections: [{ ...conn('aaaa1111', []), accounts: [
      { uid: 'u1', iban: '11112233333' },
      { uid: 'u2', iban: '44445566666' },
    ] }] });
    const calls = stubAccounts({ u1: { cash_account_type: 'SVGS' }, u2: { cash_account_type: 'LOAN' } });
    const { rows } = await bank.fetchMappedTransactions();
    expect(numbers(rows)).toEqual({ 'aaaa1111:u1': '11112233333', 'aaaa1111:u2': undefined });
    const stored = readStore().connections[0];
    expect(stored.accounts.map((a) => a.cash_account_type)).toEqual(['SVGS', 'LOAN']);
    expect(stored.accounts_typed).toBe(true);
    calls.length = 0;
    await bank.fetchMappedTransactions();
    expect(calls.filter((c) => c.endsWith('/details'))).toEqual([]);
  });

  // `detailsOk()` decides per call whether /details succeeds.
  const stubFailingDetails = (detailsOk = () => false) => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const isDetails = new URL(url).pathname.endsWith('/details');
      if (isDetails) calls.push(url);
      const ok = !isDetails || detailsOk();
      const body = !isDetails ? { transactions: [tx('u1-1')] } : ok ? { cash_account_type: 'CACC' } : { error: 'x' };
      return { ok, status: ok ? 200 : 500, text: async () => JSON.stringify(body) };
    }));
    return calls;
  };

  it('keeps an account counting as own when its details cannot be fetched', async () => {
    writeStore({ connections: [{ ...conn('aaaa1111', []), accounts: [{ uid: 'u1', iban: '11112233333' }] }] });
    stubFailingDetails();
    const { rows } = await bank.fetchMappedTransactions();
    expect(numbers(rows)).toEqual({ 'aaaa1111:u1': '11112233333' });
    expect(readStore().connections[0].accounts_typed).toBeUndefined();
    expect(readStore().connections[0].accounts_type_attempts).toBe(1);
  });

  it('retries the details fetch on a later sync and marks it done once it succeeds', async () => {
    writeStore({ connections: [{ ...conn('aaaa1111', []), accounts: [{ uid: 'u1', iban: '11112233333' }] }] });
    let ok = false;
    const calls = stubFailingDetails(() => ok);
    await bank.fetchMappedTransactions();
    ok = true;
    await bank.fetchMappedTransactions();
    expect(calls).toHaveLength(2);
    expect(readStore().connections[0]).toMatchObject({ accounts_typed: true, accounts: [{ cash_account_type: 'CACC' }] });
  });

  it('stops trying the details fetch after three failed syncs', async () => {
    writeStore({ connections: [{ ...conn('aaaa1111', []), accounts: [{ uid: 'u1', iban: '11112233333' }] }] });
    const calls = stubFailingDetails();
    for (let i = 0; i < 5; i++) await bank.fetchMappedTransactions();
    expect(calls).toHaveLength(3);
    expect(readStore().connections[0].accounts_type_attempts).toBe(3);
    expect(readStore().connections[0].accounts_typed).toBeUndefined();
  });

  it('logs a sync that fully fetched no connection as a failure', () => {
    writeStore({ connections: [conn('bbbb2222', ['b1'])] });
    bank.recordSync({ ok: true, added: 0, fetched: 0, total: 0, synced: [{ connectionId: 'bbbb2222-x', sessionId: 's-bbbb2222', complete: false }] });
    expect(readStore().syncLog.at(-1)).toMatchObject({ ok: false, error: 'no bank connection could be fully synced' });
  });
});

describe('lastSyncAgeMs', () => {
  it('uses the newest successful log entry, so a connection without last_sync does not reset it', () => {
    const now = Date.parse('2026-07-11T12:00:00Z');
    writeStore({
      connections: [{ ...conn('cccc3333', []), last_sync: null }],
      syncLog: [{ at: '2026-07-11T10:00:00Z', ok: true }, { at: '2026-07-11T11:00:00Z', ok: false }],
    });
    expect(bank.lastSyncAgeMs(now)).toBe(2 * 3600_000);
    writeStore({ connections: [{ ...conn('cccc3333', []), last_sync: null }] });
    expect(bank.lastSyncAgeMs(now)).toBe(Infinity);
  });
});
