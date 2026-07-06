import { describe, it, expect } from 'vitest';
// The Enable Banking mapping lives in the CommonJS server engine (server/bank.js)
// so it ships in the production image; it's tested here via Vitest.
import { mapEBTransaction, mapEBTransactions, mergeTransactions } from '../../server/bank.js';
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
});
