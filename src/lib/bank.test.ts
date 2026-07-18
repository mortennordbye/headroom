import { describe, it, expect } from 'vitest';
// The Enable Banking mapping lives in the CommonJS server engine (server/bank.js)
// so it ships in the production image; it's tested here via Vitest.
import { mapEBTransaction, mapEBTransactions, mergeTransactions, evictSupersededPending, dropStaleBareTwins, normalizeAccount } from '../../server/bank.js';
import type { MappedTransaction } from '../../server/bank';

interface EBTransaction {
  entry_reference?: string;
  transaction_amount: { currency: string; amount: string };
  credit_debit_indicator: 'DBIT' | 'CRDT';
  status: 'BOOK' | 'PDNG';
  booking_date?: string;
  value_date?: string;
  transaction_date?: string;
  creditor?: { name?: string } | null;
  debtor?: { name?: string } | null;
  remittance_information?: string[] | null;
  bank_transaction_code?: { description?: string } | null;
  merchant_category_code?: string | number | null;
}

const tx = (over: Partial<EBTransaction> = {}): EBTransaction => ({
  entry_reference: 'ref-1',
  transaction_amount: { currency: 'NOK', amount: '249.90' },
  credit_debit_indicator: 'DBIT',
  status: 'BOOK',
  booking_date: '2026-04-06',
  creditor: { name: 'REMA 1000' },
  ...over,
});

describe('mapEBTransaction', () => {
  it('maps a debit purchase to a positive expense with the merchant name', () => {
    expect(mapEBTransaction(tx())).toMatchObject({
      id: 'eb-ref-1',
      date: '2026-04-06',
      description: 'REMA 1000',
      amount: 249.9,
      kind: 'expense',
    });
  });

  it('maps a credit to income using the debtor name', () => {
    const r = mapEBTransaction(
      tx({ credit_debit_indicator: 'CRDT', creditor: null, debtor: { name: 'Employer AS' }, transaction_amount: { currency: 'NOK', amount: '1000.00' } }),
    );
    expect(r.kind).toBe('income');
    expect(r.description).toBe('Employer AS');
    expect(r.amount).toBe(1000);
  });

  it('always yields a positive amount even for a signed string', () => {
    const r = mapEBTransaction(tx({ transaction_amount: { currency: 'NOK', amount: '-50.00' } }));
    expect(r.amount).toBe(50);
    expect(r.kind).toBe('expense');
  });

  it('falls back party → remittance → bank code → Unknown', () => {
    expect(mapEBTransaction(tx({ creditor: null, remittance_information: ['Invoice 42'] })).description).toBe('Invoice 42');
    expect(mapEBTransaction(tx({ creditor: null, remittance_information: null, bank_transaction_code: { description: 'Card payment' } })).description).toBe('Card payment');
    expect(mapEBTransaction(tx({ creditor: null, remittance_information: null, bank_transaction_code: null })).description).toBe('Unknown');
  });

  it('derives a deterministic id when entry_reference is missing', () => {
    const base = tx({ entry_reference: undefined });
    expect(mapEBTransaction(base).id).toBe(mapEBTransaction(base).id);
    expect(mapEBTransaction(base).id).toContain('2026-04-06');
  });

  it('keeps the merchant name and MCC from the feed for the categorizer', () => {
    const r = mapEBTransaction(tx({ merchant_category_code: 5411 }));
    expect(r.merchant).toBe('REMA 1000');
    expect(r.mcc).toBe('5411');
  });

  it('omits merchant/mcc when the feed does not carry them', () => {
    const r = mapEBTransaction(tx({ creditor: null, remittance_information: ['Invoice 42'] }));
    expect(r.merchant).toBeUndefined();
    expect(r.mcc).toBeUndefined();
  });

  it('picks value_date then transaction_date when booking_date is absent', () => {
    expect(mapEBTransaction(tx({ booking_date: undefined, value_date: '2026-05-01' })).date).toBe('2026-05-01');
    expect(mapEBTransaction(tx({ booking_date: undefined, value_date: undefined, transaction_date: '2026-05-02' })).date).toBe('2026-05-02');
  });

  it('throws when the feed carries no usable date (would be invisible/undeletable)', () => {
    expect(() => mapEBTransaction(tx({ booking_date: undefined, value_date: undefined, transaction_date: undefined }))).toThrow();
  });

  it('infers direction from the amount sign when the indicator is absent', () => {
    // A refund with no credit_debit_indicator is income (positive), not a
    // positive expense; a purchase with no indicator stays an expense.
    const refund = mapEBTransaction(tx({ credit_debit_indicator: undefined, transaction_amount: { currency: 'NOK', amount: '200.00' } }));
    expect(refund.kind).toBe('income');
    expect(refund.amount).toBe(200);
    const purchase = mapEBTransaction(tx({ credit_debit_indicator: undefined, transaction_amount: { currency: 'NOK', amount: '-149.90' } }));
    expect(purchase.kind).toBe('expense');
    expect(purchase.amount).toBe(149.9);
  });

  it('stamps account/bank/accountName from opts, and omits them when absent', () => {
    const tagged = mapEBTransaction(tx(), { account: 'abcd1234:uid-1', bank: 'Handelsbanken', accountName: 'Brukskonto' });
    expect(tagged.account).toBe('abcd1234:uid-1');
    expect(tagged.bank).toBe('Handelsbanken');
    expect(tagged.accountName).toBe('Brukskonto');
    const bare = mapEBTransaction(tx());
    expect(bare.account).toBeUndefined();
    expect(bare.bank).toBeUndefined();
    expect(bare.accountName).toBeUndefined();
  });

  it('gives colliding entry_references distinct ids under different connection prefixes', () => {
    const a = mapEBTransaction(tx({ entry_reference: 'ref-1' }), { idPrefix: 'eb-aaaa1111-' });
    const b = mapEBTransaction(tx({ entry_reference: 'ref-1' }), { idPrefix: 'eb-bbbb2222-' });
    expect(a.id).not.toBe(b.id);
    expect(a.id.startsWith('eb-')).toBe(true);
    expect(b.id.startsWith('eb-')).toBe(true);
  });

  it('throws on an unparseable or blank amount', () => {
    expect(() => mapEBTransaction(tx({ transaction_amount: { currency: 'NOK', amount: 'n/a' } }))).toThrow();
    expect(() => mapEBTransaction(tx({ transaction_amount: { currency: 'NOK', amount: '' } }))).toThrow();
  });
});

describe('mapEBTransactions', () => {
  it('drops pending rows by default and keeps booked ones', () => {
    const rows = mapEBTransactions([tx(), tx({ entry_reference: 'ref-2', status: 'PDNG' })]);
    expect(rows.map((r: { id: string }) => r.id)).toEqual(['eb-ref-1']);
  });

  it('includes pending when asked, and skips malformed rows', () => {
    expect(mapEBTransactions([tx({ status: 'PDNG' })], { includePending: true })).toHaveLength(1);
    const rows = mapEBTransactions([tx(), tx({ entry_reference: 'ref-2', transaction_amount: { currency: 'NOK', amount: '' } })]);
    expect(rows.map((r: { id: string }) => r.id)).toEqual(['eb-ref-1']);
  });

  it('stamps `pending` on non-booked rows and leaves booked rows unflagged', () => {
    const [pending] = mapEBTransactions([tx({ status: 'PDNG' })], { includePending: true });
    expect(pending.pending).toBe(true);
    const [booked] = mapEBTransactions([tx()]);
    expect(booked.pending).toBeUndefined();
  });

  it('keeps two identical same-day no-reference rows as distinct transactions', () => {
    const twin = tx({ entry_reference: undefined });
    const rows = mapEBTransactions([twin, twin]);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).not.toBe(rows[1].id);
    // The first occurrence keeps the unsuffixed fallback id so it still matches
    // what earlier syncs stored; re-mapping the same batch yields the same ids.
    expect(rows[0].id).toBe(mapEBTransaction(twin).id);
    expect(mapEBTransactions([twin, twin]).map((r: MappedTransaction) => r.id))
      .toEqual(rows.map((r: MappedTransaction) => r.id));
  });

  it('does not suffix repeats that carry the same entry_reference', () => {
    const rows = mapEBTransactions([tx(), tx()]);
    expect(rows.map((r: MappedTransaction) => r.id)).toEqual(['eb-ref-1', 'eb-ref-1']);
  });
});

describe('normalizeAccount', () => {
  it('maps a full account object, keeping name/product/currency', () => {
    expect(normalizeAccount({ uid: 'u1', name: 'Brukskonto', product: 'Current', currency: 'NOK' }))
      .toEqual({ uid: 'u1', name: 'Brukskonto', product: 'Current', currency: 'NOK' });
  });

  it('wraps a bare uid string (ASPSPs that return only ids)', () => {
    expect(normalizeAccount('uid-abc')).toEqual({ uid: 'uid-abc' });
  });

  it('captures the IBAN from account_id so same-named accounts can be told apart', () => {
    expect(normalizeAccount({ uid: 'u1', name: 'Ola Nordmann', account_id: { iban: 'NO2090461303497' } }))
      .toEqual({ uid: 'u1', name: 'Ola Nordmann', iban: 'NO2090461303497' });
  });

  it('omits iban when the account carries no identifier', () => {
    expect(normalizeAccount({ uid: 'u1', name: 'Ola' }).iban).toBeUndefined();
  });
});

describe('mergeTransactions', () => {
  const manual = { id: 'manual-1', date: '2026-04-01', description: 'Cash', amount: 200, kind: 'expense' as const };

  it('adds imported rows while keeping manual ones', () => {
    const merged = mergeTransactions([manual], mapEBTransactions([tx()]));
    expect(merged.map((t: { id: string }) => t.id).sort()).toEqual(['eb-ref-1', 'manual-1']);
  });

  it('updates a previously imported row in place (no duplicate)', () => {
    const first = mapEBTransactions([tx()]);
    const second = mapEBTransactions([tx({ transaction_amount: { currency: 'NOK', amount: '300.00' } })]);
    const merged = mergeTransactions(first, second);
    expect(merged).toHaveLength(1);
    expect(merged[0].amount).toBe(300);
  });

  it('preserves an existing category (manual or auto) across a re-sync', () => {
    const labelled = mapEBTransactions([tx()]).map((t: MappedTransaction) => ({ ...t, category: 'groceries', categorySource: 'manual' as const }));
    const resynced = mapEBTransactions([tx({ transaction_amount: { currency: 'NOK', amount: '260.00' } })]);
    const merged = mergeTransactions(labelled, resynced);
    expect(merged).toHaveLength(1);
    expect(merged[0].amount).toBe(260); // fresh bank amount wins
    expect(merged[0].category).toBe('groceries'); // but the label survives
    expect(merged[0].categorySource).toBe('manual');
  });

  it('keeps rows from two different connections side by side (no collision)', () => {
    const bankA = mapEBTransactions([tx({ entry_reference: 'ref-1' })], { idPrefix: 'eb-aaaa1111-', account: 'aaaa1111:1', accountName: 'Card' });
    const bankB = mapEBTransactions([tx({ entry_reference: 'ref-1' })], { idPrefix: 'eb-bbbb2222-', account: 'bbbb2222:1', accountName: 'Salary' });
    const merged = mergeTransactions(bankA, bankB);
    expect(merged).toHaveLength(2);
    expect(merged.map((t: MappedTransaction) => t.accountName).sort()).toEqual(['Card', 'Salary']);
  });

  it('does not resurrect a soft-deleted row on re-sync', () => {
    const incoming = mapEBTransactions([tx()]);
    const merged = mergeTransactions([manual], incoming, ['eb-ref-1']);
    expect(merged.map((t: { id: string }) => t.id)).toEqual(['manual-1']);
  });

  it('drops an already-stored row whose id was soft-deleted', () => {
    const stored = mapEBTransactions([tx()]);
    const merged = mergeTransactions(stored, [], ['eb-ref-1']);
    expect(merged).toHaveLength(0);
  });

  it('evicts a stored pending row once its booked twin arrives (no double-count)', () => {
    const pending = mapEBTransactions(
      [tx({ entry_reference: undefined, status: 'PDNG', booking_date: undefined, value_date: '2026-04-05' })],
      { includePending: true, account: 'a:1' },
    );
    const booked = mapEBTransactions([tx({ entry_reference: 'ref-9', booking_date: '2026-04-06' })], { account: 'a:1' });
    const merged = mergeTransactions(pending, booked);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('eb-ref-9');
    expect(merged[0].pending).toBeUndefined();
  });
});

// evictSupersededPending is the CJS twin of the same function in
// src/lib/bankDedup.ts (they must stay byte-equivalent); these cases mirror
// bankDedup.test.ts.
describe('evictSupersededPending', () => {
  const p = (over: Partial<MappedTransaction>): MappedTransaction => ({
    id: 'p', date: '2026-04-05', description: 'REMA 1000', amount: 249.9, kind: 'expense', account: 'a:1', pending: true, ...over,
  });
  const b = (over: Partial<MappedTransaction>): MappedTransaction => ({
    id: 'b', date: '2026-04-06', description: 'REMA 1000', amount: 249.9, kind: 'expense', account: 'a:1', ...over,
  });

  it('drops a pending row superseded by a booked twin (same account/amount/kind, within days)', () => {
    const out = evictSupersededPending([p({}), b({})]);
    expect(out.map((t) => t.id)).toEqual(['b']);
  });

  it('keeps a pending row that has no booked twin', () => {
    expect(evictSupersededPending([p({})]).map((t) => t.id)).toEqual(['p']);
  });

  it('does not evict when the amount differs, the account differs, or the dates are far apart', () => {
    expect(evictSupersededPending([p({}), b({ amount: 250 })])).toHaveLength(2);
    expect(evictSupersededPending([p({}), b({ account: 'a:2' })])).toHaveLength(2);
    expect(evictSupersededPending([p({}), b({ date: '2026-04-20' })])).toHaveLength(2);
  });

  it('rescues a manual category from the dropped pending row onto its booked survivor', () => {
    const out = evictSupersededPending([p({ category: 'groceries', categorySource: 'manual' }), b({})]);
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe('groceries');
    expect(out[0].categorySource).toBe('manual');
  });

  it('is a no-op when there are no pending rows', () => {
    const rows = [b({ id: 'b1' }), b({ id: 'b2', amount: 10 })];
    expect(evictSupersededPending(rows)).toBe(rows);
  });
});

// dropStaleBareTwins is the CJS twin of src/lib/bankDedup.ts (the regexes must
// stay byte-equivalent); these cases mirror bankDedup.test.ts. It runs in the
// POST /api/data handler so bare rows that reconcileBankTransactions re-adds
// from the stored blob converge out instead of ping-ponging on every save.
describe('dropStaleBareTwins', () => {
  const row = (over: Partial<MappedTransaction>): MappedTransaction => ({
    id: 'x', date: '2026-06-28', description: 'REMA 1000', amount: 100, kind: 'expense', ...over,
  });

  it('drops a legacy bare row when a prefixed twin exists, keeping the prefixed one', () => {
    const out = dropStaleBareTwins([
      row({ id: 'eb-3605340816', amount: 77.3 }),
      row({ id: 'eb-e8a81f8a-3605340816', amount: 77.3, account: 'e8a81f8a:acc', bank: 'Bank Norwegian' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('eb-e8a81f8a-3605340816');
  });

  it('NEVER merges two different prefixed connections that reuse an entry_reference', () => {
    const out = dropStaleBareTwins([
      row({ id: 'eb-aaaa1111-ref-1', account: 'aaaa1111:a' }),
      row({ id: 'eb-bbbb2222-ref-1', account: 'bbbb2222:b' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('rescues a manual category from the dropped bare twin onto its survivor', () => {
    const out = dropStaleBareTwins([
      row({ id: 'eb-999', category: 'groceries', categorySource: 'manual' }),
      row({ id: 'eb-aaaaaaaa-999', account: 'x', category: 'other', categorySource: 'auto' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('eb-aaaaaaaa-999');
    expect(out[0].category).toBe('groceries');
    expect(out[0].categorySource).toBe('manual');
  });

  it('keeps a legacy bare row that has no prefixed twin, manual rows, and is idempotent', () => {
    const clean = [row({ id: 'eb-onlylegacy' }), row({ id: 'eb-cccc3333-other', account: 'x' }), row({ id: 'manual-2' })];
    expect(dropStaleBareTwins(clean)).toHaveLength(3);
    expect(dropStaleBareTwins(dropStaleBareTwins(clean))).toHaveLength(3);
  });
});
