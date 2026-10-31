import { describe, it, expect } from 'vitest';
import {
  valuationFromSales, streetName, weightedPercentile, quarterOf, bedroomsFromRooms, valuationConfidence, valuationHistory,
  type ComparableSale,
} from './marketValuation';

const ASOF = '2026-10-31';
const home = { address: 'Testveien 3D', postnr: '0570', sizeSqm: 40 };

const sale = (over: Partial<ComparableSale>): ComparableSale => ({
  address: 'Testveien 3A',
  postnr: '0570',
  bra: 40,
  soldPrice: 4_000_000,
  soldOn: '2026-03-01',
  ...over,
});

describe('streetName', () => {
  it('drops the number, entrance letter and city', () => {
    expect(streetName('Testveien 3D')).toBe('testveien');
    expect(streetName('Store  Ringvei 12, Oslo')).toBe('store ringvei');
    expect(streetName('Gate 5 B')).toBe('gate');
  });
});

describe('valuationFromSales', () => {
  it('uses the weighted 25th/50th/75th percentile of price per m² on the same street', () => {
    const sales = [
      sale({ soldPrice: 3_800_000 }), // 95 000/m²
      sale({ soldPrice: 4_000_000 }), // 100 000/m²
      sale({ soldPrice: 4_200_000 }), // 105 000/m²
      sale({ soldPrice: 4_400_000 }), // 110 000/m²
    ];
    const v = valuationFromSales(home, sales, { asOf: ASOF })!;
    expect(v.scope).toBe('street');
    expect(v.count).toBe(4);
    // Equal weights (same date and size): each value sits at the middle of a
    // quarter of the weight, so the 25th lies halfway between the first two.
    expect(v.perSqm).toEqual({ low: 97_500, mid: 102_500, high: 107_500 });
    expect(v.low).toBe(3_900_000);
    expect(v.mid).toBe(4_100_000);
    expect(v.high).toBe(4_300_000);
    expect(v.sameRooms).toBe(false);
    expect(v.timeAdjusted).toBe(false);
  });

  it('prices on total price per m² and takes the home’s own fellesgjeld off', () => {
    const sales = [1, 2, 3].map(() => sale({ soldPrice: 3_000_000, fellesgjeld: 1_000_000 }));
    const v = valuationFromSales({ ...home, fellesgjeld: 500_000 }, sales, { asOf: ASOF })!;
    expect(v.perSqm.mid).toBe(100_000);
    expect(v.mid).toBe(3_500_000);
  });

  it('falls back to the postnummer when the street has too few sales', () => {
    const sales = [
      sale({}),
      sale({ address: 'Annengata 1' }),
      sale({ address: 'Tredjegata 9' }),
    ];
    expect(valuationFromSales(home, sales, { asOf: ASOF })!.scope).toBe('postnr');
  });

  it('ignores sales that are too old, in the future, a different size, or unusable', () => {
    const sales = [
      sale({}),
      sale({ soldOn: '2024-01-01' }), // older than 24 months
      sale({ soldOn: '2026-11-15' }), // after asOf
      sale({ bra: 60 }), // outside ±25 %
      sale({ bra: null }),
      sale({ soldPrice: 0 }),
    ];
    expect(valuationFromSales(home, sales, { asOf: ASOF })).toBeNull();
  });

  it('does not match the same street name in another postnummer', () => {
    const sales = [1, 2, 3].map(() => sale({ postnr: '5003' }));
    expect(valuationFromSales(home, sales, { asOf: ASOF })).toBeNull();
  });

  it('returns null when fellesgjeld leaves nothing to estimate', () => {
    const sales = [sale({}), sale({}), sale({})]; // 100 000/m² × 40 m² = 4 000 000
    expect(valuationFromSales({ ...home, fellesgjeld: 4_000_000 }, sales, { asOf: ASOF })).toBeNull();
  });

  it('returns null without a size, never NaN', () => {
    expect(valuationFromSales({ ...home, sizeSqm: undefined }, [sale({}), sale({}), sale({})], { asOf: ASOF })).toBeNull();
    expect(valuationFromSales({ ...home, sizeSqm: 0 }, [sale({}), sale({}), sale({})], { asOf: ASOF })).toBeNull();
  });

  it('reports the median sold-over-asking and lists the newest comparables first', () => {
    const sales = [
      sale({ soldOn: '2026-01-01', askingPrice: 4_000_000, soldPrice: 4_000_000 }),
      sale({ soldOn: '2026-06-01', askingPrice: 4_000_000, soldPrice: 4_200_000 }),
      sale({ soldOn: '2026-03-01', askingPrice: 4_000_000, soldPrice: 4_400_000 }),
      sale({ soldOn: '2026-02-01' }), // no asking price: not in the ratio
    ];
    const v = valuationFromSales(home, sales, { asOf: ASOF, listLimit: 2 })!;
    expect(v.overAskingPct).toBe(5);
    expect(v.comps.map((c) => c.soldOn)).toEqual(['2026-06-01', '2026-03-01']);
    expect(v.count).toBe(4);
  });
});

describe('weightedPercentile', () => {
  it('equals the ordinary median with equal weights', () => {
    const pts = [1, 2, 3, 4, 5].map((value) => ({ value, weight: 1 }));
    expect(weightedPercentile(pts, 0.5)).toBe(3);
  });

  it('pulls toward heavier values and clamps at the ends', () => {
    const pts = [{ value: 100, weight: 3 }, { value: 200, weight: 1 }];
    expect(weightedPercentile(pts, 0.5)).toBe(125); // points at 0.375 and 0.875 of the weight
    expect(weightedPercentile(pts, 0)).toBe(100);
    expect(weightedPercentile(pts, 1)).toBe(200);
  });

  it('is NaN for no usable points', () => {
    expect(weightedPercentile([], 0.5)).toBeNaN();
    expect(weightedPercentile([{ value: 1, weight: 0 }], 0.5)).toBeNaN();
  });
});

describe('quarterOf', () => {
  it('maps a day to its quarter', () => {
    expect(quarterOf('2026-01-01')).toBe('2026K1');
    expect(quarterOf('2026-09-30')).toBe('2026K3');
    expect(quarterOf('2026-10-09')).toBe('2026K4');
  });
});

describe('valuationFromSales: representativeness', () => {
  const oneBed = (soldPrice: number) => sale({ soldPrice, bedrooms: 1 });
  const twoBed = (soldPrice: number) => sale({ soldPrice, bedrooms: 2 });
  const zeroBed = (soldPrice: number) => sale({ soldPrice, bedrooms: 0 });

  it('leaves out sales with a different stated bedroom count when enough remain', () => {
    const sales = [oneBed(4_000_000), oneBed(4_000_000), oneBed(4_000_000), twoBed(5_000_000), twoBed(5_000_000)];
    const v = valuationFromSales({ ...home, bedrooms: 1 }, sales, { asOf: ASOF })!;
    expect(v.sameRooms).toBe(true);
    expect(v.count).toBe(3);
    expect(v.mid).toBe(4_000_000);
  });

  it('treats a bedroom count of 0 as not stated', () => {
    // Listing sites report a missing count as 0, so 0 must not rule a sale out.
    const sales = [oneBed(4_000_000), zeroBed(4_000_000), zeroBed(4_000_000), sale({ soldPrice: 4_000_000 })];
    const v = valuationFromSales({ ...home, bedrooms: 1 }, sales, { asOf: ASOF })!;
    expect(v.count).toBe(4);
    expect(v.sameRooms).toBe(false); // nothing was left out
  });

  it('a home with 0 bedrooms keeps only 0 or unstated', () => {
    const sales = [zeroBed(3_000_000), zeroBed(3_000_000), sale({ soldPrice: 3_000_000 }), oneBed(4_000_000)];
    const v = valuationFromSales({ ...home, bedrooms: 0 }, sales, { asOf: ASOF })!;
    expect(v.count).toBe(3);
    expect(v.sameRooms).toBe(true);
  });

  it('falls back to every room count when too few match', () => {
    const sales = [oneBed(4_000_000), twoBed(5_000_000), twoBed(5_000_000)];
    const v = valuationFromSales({ ...home, bedrooms: 1 }, sales, { asOf: ASOF })!;
    expect(v.sameRooms).toBe(false);
    expect(v.count).toBe(3);
  });

  it('moves older sales to the latest index level', () => {
    const index = [{ quarter: '2025K4', price: 100_000 }, { quarter: '2026K3', price: 110_000 }];
    const sales = [1, 2, 3].map(() => sale({ soldOn: '2025-11-15', soldPrice: 4_000_000 }));
    const v = valuationFromSales(home, sales, { asOf: ASOF, index })!;
    expect(v.timeAdjusted).toBe(true);
    expect(v.perSqm.mid).toBe(110_000); // 100 000/m² × 1.10
    expect(v.mid).toBe(4_400_000);
  });

  it('leaves a sale older than the index series as sold', () => {
    const index = [{ quarter: '2025K4', price: 100_000 }, { quarter: '2026K3', price: 120_000 }];
    const sales = [1, 2, 3].map(() => sale({ soldOn: '2025-02-01', soldPrice: 4_000_000 }));
    expect(valuationFromSales(home, sales, { asOf: ASOF, index })!.perSqm.mid).toBe(100_000);
  });

  it('caps the index adjustment, and ignores an index that cannot say', () => {
    const wild = [{ quarter: '2025K1', price: 50_000 }, { quarter: '2026K3', price: 150_000 }];
    const sales = [1, 2, 3].map(() => sale({ soldOn: '2025-02-01', soldPrice: 4_000_000 }));
    expect(valuationFromSales(home, sales, { asOf: ASOF, index: wild })!.perSqm.mid).toBe(125_000);
    const thin = [{ quarter: '2026K3', price: 110_000 }];
    expect(valuationFromSales(home, sales, { asOf: ASOF, index: thin })!.timeAdjusted).toBe(false);
  });

  it('lets newer and closer-sized sales count more', () => {
    const sales = [
      sale({ soldOn: '2026-10-01', soldPrice: 4_000_000 }), // new, 100 000/m²
      sale({ soldOn: '2026-10-01', soldPrice: 4_000_000 }),
      sale({ soldOn: '2024-12-01', soldPrice: 6_000_000 }), // ~2 years old, 150 000/m²
    ];
    const v = valuationFromSales(home, sales, { asOf: ASOF })!;
    expect(v.perSqm.mid).toBe(100_000);
    expect(v.comps.find((c) => c.soldOn === '2024-12-01')!.weight).toBeLessThan(0.3);

    const sized = [
      sale({ bra: 40, soldPrice: 4_000_000 }),
      sale({ bra: 40, soldPrice: 4_000_000 }),
      sale({ bra: 49, soldPrice: 4_900_000 }), // at the ±25 % edge
    ];
    const w = valuationFromSales(home, sized, { asOf: ASOF })!.comps.find((c) => c.bra === 49)!.weight;
    expect(w).toBeCloseTo(0.55, 2);
  });
});

describe('bedroomsFromRooms', () => {
  it('counts the living room as a room', () => {
    expect(bedroomsFromRooms(2)).toBe(1);
    expect(bedroomsFromRooms(1)).toBe(0);
    expect(bedroomsFromRooms(undefined)).toBeNull();
    expect(bedroomsFromRooms(0)).toBeNull();
    expect(bedroomsFromRooms(2.5)).toBeNull();
  });
});

describe('valuationConfidence', () => {
  const many = (n: number, soldOn: string, spread = 0) =>
    Array.from({ length: n }, (_, i) => sale({ soldOn, soldPrice: 4_000_000 + (i % 2 ? spread : -spread) }));
  const conf = (sales: ComparableSale[]) => {
    const v = valuationFromSales(home, sales, { asOf: ASOF, listLimit: Number.MAX_SAFE_INTEGER })!;
    return valuationConfidence(v, ASOF);
  };

  it('is high with many recent, tight sales', () => {
    expect(conf(many(10, '2026-09-01', 50_000))).toMatchObject({ level: 'high', effectiveCount: 10 });
  });

  it('is low with few sales, old sales, or a wide range', () => {
    expect(conf(many(3, '2026-09-01')).level).toBe('low');
    expect(conf(many(10, '2025-06-01')).level).toBe('low'); // newest 17 months old
    expect(conf(many(10, '2026-09-01', 700_000)).level).toBe('low'); // range ~35 % wide
  });

  it('counts every comparable, not just the listed ones', () => {
    const sales = Array.from({ length: 14 }, () => sale({ soldOn: '2026-09-01' }));
    const v = valuationFromSales(home, sales, { asOf: ASOF })!; // default listLimit 10
    expect(v.comps).toHaveLength(10);
    expect(valuationConfidence(v, ASOF).effectiveCount).toBe(14);
  });

  it('measures the spread on price per m², not after fellesgjeld', () => {
    const sales = many(10, '2026-09-01', 50_000);
    const plain = valuationFromSales(home, sales, { asOf: ASOF })!;
    const indebted = valuationFromSales({ ...home, fellesgjeld: 3_500_000 }, sales, { asOf: ASOF })!;
    expect(valuationConfidence(indebted, ASOF).spreadPct).toBe(valuationConfidence(plain, ASOF).spreadPct);
    expect(valuationConfidence(indebted, ASOF).level).toBe('high');
  });

  it('is medium in between', () => {
    expect(conf(many(5, '2026-09-01', 50_000)).level).toBe('medium');
  });
});

describe('valuationHistory', () => {
  it('replays the estimate month by month, only with sales known by then', () => {
    const sales = [
      sale({ soldOn: '2026-01-10', soldPrice: 4_000_000 }),
      sale({ soldOn: '2026-02-10', soldPrice: 4_000_000 }),
      sale({ soldOn: '2026-03-10', soldPrice: 4_000_000 }),
      sale({ soldOn: '2026-09-10', soldPrice: 3_600_000 }),
    ];
    const h = valuationHistory(home, sales, { asOf: ASOF, months: 12 });
    expect(h[0].month).toBe('2026-03'); // first month with three sales
    expect(h[0]).toMatchObject({ mid: 4_000_000, count: 3 });
    expect(h[h.length - 1].month).toBe('2026-10');
    expect(h[h.length - 1].count).toBe(4);
    expect(h[h.length - 1].low).toBeLessThan(4_000_000); // the September sale pulls the range down
  });

  it('only uses index quarters known at each point', () => {
    const index = [{ quarter: '2026K1', price: 100_000 }, { quarter: '2026K3', price: 120_000 }];
    const sales = [1, 2, 3].map(() => sale({ soldOn: '2026-01-15', soldPrice: 4_000_000 }));
    const h = valuationHistory(home, sales, { asOf: ASOF, months: 10, index });
    expect(h.find((p) => p.month === '2026-03')!.mid).toBe(4_000_000); // K1 not yet ended: no adjustment
    expect(h.find((p) => p.month === '2026-09')!.mid).toBe(4_000_000); // K3 still running: only K1 known
    expect(h[h.length - 1].mid).toBe(4_800_000); // October: K3 has ended, ×1.2
  });
});
