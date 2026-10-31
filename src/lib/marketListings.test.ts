import { describe, it, expect } from 'vitest';
import { listingMetrics, saleTotalPerSqm, saleOverAskingPct, sortRows, inRange } from './marketListings';

describe('listingMetrics', () => {
  it('adds fellesgjeld to the total and reports price change and days listed', () => {
    expect(
      listingMetrics({
        url: 'u', bra: 50, askingPrice: 4_800_000, fellesgjeld: 200_000, firstAskingPrice: 5_000_000,
        firstSeen: '2026-09-28', lastSeen: '2026-10-25',
      }),
    ).toEqual({ totalPrice: 5_000_000, totalPerSqm: 100_000, priceChange: -200_000, daysListed: 27 });
  });

  it('returns nulls instead of NaN when inputs are missing', () => {
    expect(listingMetrics({ url: 'u', firstSeen: '2026-10-25', lastSeen: '2026-10-25' })).toEqual({
      totalPrice: null, totalPerSqm: null, priceChange: null, daysListed: 0,
    });
    expect(listingMetrics({ url: 'u', askingPrice: 1_000_000, bra: 0, firstSeen: 'x', lastSeen: 'y' }).totalPerSqm).toBeNull();
  });
});

describe('sale helpers', () => {
  it('price per m² uses the total price', () => {
    expect(saleTotalPerSqm({ address: 'a', bra: 40, soldPrice: 3_900_000, fellesgjeld: 100_000, soldOn: '2026-01-01' })).toBe(100_000);
    expect(saleTotalPerSqm({ address: 'a', soldPrice: 3_900_000, soldOn: '2026-01-01' })).toBeNull();
  });

  it('over asking in percent', () => {
    expect(saleOverAskingPct({ address: 'a', soldPrice: 4_100_000, askingPrice: 4_000_000, soldOn: '2026-01-01' })).toBe(2.5);
    expect(saleOverAskingPct({ address: 'a', soldPrice: 4_100_000, soldOn: '2026-01-01' })).toBeNull();
  });
});


describe('sortRows', () => {
  const rows = [
    { a: 'Testveien 10A', n: 3 },
    { a: 'Testveien 3B', n: null },
    { a: 'testveien 2', n: 1 },
    { a: 'Testveien 3A', n: 2 },
  ];

  it('sorts numbers both ways with missing values last', () => {
    expect(sortRows(rows, (r) => r.n, 'asc').map((r) => r.n)).toEqual([1, 2, 3, null]);
    expect(sortRows(rows, (r) => r.n, 'desc').map((r) => r.n)).toEqual([3, 2, 1, null]);
  });

  it('sorts text in natural, case-insensitive order', () => {
    expect(sortRows(rows, (r) => r.a, 'asc').map((r) => r.a)).toEqual(['testveien 2', 'Testveien 3A', 'Testveien 3B', 'Testveien 10A']);
  });

  it('is stable and does not mutate the input', () => {
    const same = [{ k: 1, id: 'x' }, { k: 1, id: 'y' }, { k: 0, id: 'z' }];
    expect(sortRows(same, (r) => r.k, 'desc').map((r) => r.id)).toEqual(['x', 'y', 'z']);
    expect(same.map((r) => r.id)).toEqual(['x', 'y', 'z']);
  });

  it('treats NaN as missing', () => {
    expect(sortRows([{ n: Number.NaN }, { n: 5 }], (r) => r.n, 'asc').map((r) => r.n)).toEqual([5, Number.NaN]);
  });
});

describe('inRange', () => {
  it('is open without bounds and inclusive with them', () => {
    expect(inRange(null)).toBe(true);
    expect(inRange(40, 38, 40)).toBe(true);
    expect(inRange(41, 38, 40)).toBe(false);
    expect(inRange(37, 38, null)).toBe(false);
    expect(inRange(37, null, 40)).toBe(true);
  });

  it('excludes a missing value once a bound is set', () => {
    expect(inRange(null, 38)).toBe(false);
    expect(inRange(undefined, null, 40)).toBe(false);
  });
});
