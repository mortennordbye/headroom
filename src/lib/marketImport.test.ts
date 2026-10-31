import { describe, it, expect } from 'vitest';
import { saleFromForm, parseMarketFile, batches } from './marketImport';

const form = {
  address: ' Testveien 3A ',
  postnr: '0570',
  bra: '40',
  soldPrice: '3 950 000',
  soldOn: '16.03.2026',
};

describe('saleFromForm', () => {
  it('builds an import row, tolerating thousands spaces and Norwegian dates', () => {
    expect(saleFromForm({ ...form, unit: 'H0201', askingPrice: '3950000', fellesgjeld: '68 724' })).toEqual({
      sale: {
        address: 'Testveien 3A', postnr: '0570', bra: 40, soldPrice: 3_950_000, soldOn: '2026-03-16',
        source: 'manual', unit: 'H0201', askingPrice: 3_950_000, fellesgjeld: 68_724,
      },
    });
  });

  it('accepts the non-breaking spaces a copied amount often has', () => {
    const r = saleFromForm({ ...form, soldPrice: '3\u00a0950\u00a0000' });
    expect('sale' in r && r.sale.soldPrice).toBe(3_950_000);
  });

  it('leaves optional fields out when empty', () => {
    const r = saleFromForm(form);
    expect('sale' in r && r.sale).not.toHaveProperty('askingPrice');
    expect('sale' in r && r.sale).not.toHaveProperty('unit');
  });

  it('names the first invalid field', () => {
    expect(saleFromForm({ ...form, address: ' ' })).toEqual({ error: 'address' });
    expect(saleFromForm({ ...form, postnr: '57' })).toEqual({ error: 'postnr' });
    expect(saleFromForm({ ...form, bra: '0' })).toEqual({ error: 'bra' });
    expect(saleFromForm({ ...form, soldPrice: 'mye' })).toEqual({ error: 'soldPrice' });
    expect(saleFromForm({ ...form, soldOn: '' })).toEqual({ error: 'soldOn' });
    expect(saleFromForm({ ...form, soldOn: '2026-03' })).toEqual({ error: 'soldOn' });
    expect(saleFromForm({ ...form, askingPrice: '-5' })).toEqual({ error: 'askingPrice' });
  });
});

describe('parseMarketFile', () => {
  it('reads sales, listings and seenOn', () => {
    const r = parseMarketFile(JSON.stringify({ sales: [{ address: 'a' }], listings: [{ url: 'u' }], seenOn: '2026-10-25' }));
    expect(r).toEqual({ sales: [{ address: 'a' }], listings: [{ url: 'u' }], seenOn: '2026-10-25' });
  });

  it('allows either list to be missing', () => {
    expect(parseMarketFile('{"sales":[{"address":"a"}]}')).toEqual({ sales: [{ address: 'a' }], listings: [] });
  });

  it('rejects broken JSON, wrong shapes and empty files', () => {
    expect(parseMarketFile('{nope')).toEqual({ error: 'json' });
    expect(parseMarketFile('[]')).toEqual({ error: 'shape' });
    expect(parseMarketFile('{"sales":{}}')).toEqual({ error: 'shape' });
    expect(parseMarketFile('{"sales":[1]}')).toEqual({ error: 'shape' });
    expect(parseMarketFile('{"sales":[],"seenOn":"25.10.2026"}')).toEqual({ error: 'shape' });
    expect(parseMarketFile('{"sales":[],"listings":[]}')).toEqual({ error: 'empty' });
  });
});

describe('batches', () => {
  it('splits into request-sized chunks', () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batches([], 2)).toEqual([]);
  });
});
