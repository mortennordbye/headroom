import { describe, it, expect } from 'vitest';
import {
  parseTableNumber, calcTabelltrekk, withholdingForMonth, withholdingByMonth, sanitizeTaxCard, trekkYear, cardNetForMonth,
  type TrekkTable, type PayPeriod,
} from './forskuddstrekk';

const table = (n: string): TrekkTable => {
  const t = parseTableNumber(n);
  if (!t) throw new Error(`unknown table ${n}`);
  return t;
};

// Rows copied from Skatteetaten's "trekktabeller i tekstformat" 2026 file
// (monthly period, lønn): [table, trekkgrunnlag, trekk]. The full file
// (186 197 monthly rows) was checked once by hand with zero mismatches; these
// keep a sample of every table family in CI.
const GOLDEN_2026: Array<[string, number, number]> = [
  ['8000', 15000, 1320], ['8000', 45000, 12244], ['8000', 70000, 23086], ['8000', 150000, 65880],
  ['8130', 15000, 1320], ['8130', 45000, 9521], ['8130', 70000, 20362], ['8130', 150000, 63156],
  ['8400', 15000, 1320], ['8400', 45000, 4969], ['8400', 70000, 14705], ['8400', 150000, 57499],
  ['9050', 15000, 2243], ['9050', 45000, 13292], ['9050', 70000, 24133], ['9050', 150000, 66928],
  ['7300', 15000, 1307], ['7300', 45000, 11233], ['7300', 70000, 21901], ['7300', 150000, 64229],
  ['7350', 15000, 1144], ['7350', 45000, 9829], ['7350', 70000, 19163], ['7350', 150000, 56201],
  ['7700', 15000, 768], ['7700', 45000, 8703], ['7700', 70000, 17412], ['7700', 150000, 52450],
  ['6300', 15000, 1307], ['6300', 45000, 9434], ['6300', 70000, 19102], ['6300', 150000, 58230],
  ['0101', 15000, 1143], ['0101', 45000, 8036], ['0101', 70000, 17370], ['0101', 150000, 54408],
  ['7500', 45000, 6405], ['7500', 70000, 13840], ['7500', 150000, 44797],
];

describe('calcTabelltrekk', () => {
  it.each(GOLDEN_2026)('table %s at %i matches Skatteetaten (%i)', (n, grunnlag, trekk) => {
    expect(calcTabelltrekk(table(n), grunnlag, 2026)).toBe(trekk);
  });

  it('uses the same trekk for every grunnlag in a 100-kr band', () => {
    const t = table('8130');
    expect(calcTabelltrekk(t, 45000, 2026)).toBe(calcTabelltrekk(t, 45099, 2026));
  });

  it('never withholds more than the grunnlag', () => {
    for (const n of ['8000', '9400', '7150']) {
      for (let g = 0; g <= 200000; g += 700) expect(calcTabelltrekk(table(n), g, 2026)).toBeLessThanOrEqual(g);
    }
  });

  it('withholds less on a table with a larger deduction', () => {
    expect(calcTabelltrekk(table('8200'), 50000, 2026)).toBeLessThan(calcTabelltrekk(table('8100'), 50000, 2026));
  });

  it('returns 0 for zero, negative and non-finite grunnlag', () => {
    const t = table('8000');
    expect(calcTabelltrekk(t, 0)).toBe(0);
    expect(calcTabelltrekk(t, -5000)).toBe(0);
    expect(calcTabelltrekk(t, NaN)).toBe(0);
  });
});

// Same file, 14-day (period 2) and weekly (period 3) rows: [table, period, grunnlag, trekk].
const GOLDEN_PERIODS_2026: Array<[string, PayPeriod, number, number]> = [
  ['8130', '14d', 30000, 8156], ['8130', '14d', 60000, 23838], ['7350', '14d', 30000, 7846], ['0101', '14d', 30000, 7018],
  ['8130', 'week', 15000, 4077], ['8130', 'week', 30000, 11918], ['7350', 'week', 15000, 3922], ['6300', 'week', 15000, 3840],
];

describe('calcTabelltrekk on other pay periods', () => {
  it.each(GOLDEN_PERIODS_2026)('table %s per %s at %i matches Skatteetaten (%i)', (n, period, grunnlag, trekk) => {
    expect(calcTabelltrekk(table(n), grunnlag, 2026, period)).toBe(trekk);
  });
});

describe('parseTableNumber', () => {
  it('maps ordinary tables to their deduction or addition', () => {
    expect(table('8130').tableFradrag).toBe(130000);
    expect(table('9050').tableFradrag).toBe(-50000);
    expect(table(' 8000 ').tableFradrag).toBe(0);
  });

  it('rejects numbers Skatteetaten does not publish', () => {
    for (const s of ['8135', '8410', '9000', '7100', '123', 'abcd', '']) expect(parseTableNumber(s)).toBeNull();
  });
});

describe('withholdingForMonth', () => {
  it('skips June and halves December on a 10.5-month table', () => {
    const card = { kind: 'table' as const, table: '8130', year: 2026 };
    const full = calcTabelltrekk(table('8130'), 50000, 2026);
    expect(withholdingForMonth(card, 50000, 5, 0, 2026)).toBe(full);
    expect(withholdingForMonth(card, 50000, 6, 0, 2026)).toBe(0);
    expect(withholdingForMonth(card, 50000, 12, 0, 2026)).toBe(Math.round(full / 2));
  });

  it('withholds every month on a 12-month table', () => {
    const card = { kind: 'table' as const, table: '7350', year: 2026 };
    const months = withholdingByMonth(card, () => 50000, undefined, 2026);
    expect(new Set(months).size).toBe(1);
    expect(months[0]).toBeGreaterThan(0);
  });

  it('a 10.5-month table withholds 10.5 months of the same trekk over the year', () => {
    const card = { kind: 'table' as const, table: '8000', year: 2026 };
    const full = calcTabelltrekk(table('8000'), 60000, 2026);
    const year = withholdingByMonth(card, () => 60000, undefined, 2026).reduce((s, v) => s + v, 0);
    expect(year).toBe(full * 10 + Math.round(full / 2));
  });

  it('withholds the table\'s trekk-payout count over a year on 14-day and weekly pay', () => {
    // 26 payouts → 23 carry trekk (2 free in June, 2 at half in December); 52 → 46.
    for (const [period, perYear, trekkPayouts] of [['14d', 26, 23], ['week', 52, 46]] as const) {
      const card = { kind: 'table' as const, table: '8000', period, year: 2026 };
      const perPayout = calcTabelltrekk(table('8000'), (60000 * 12) / perYear, 2026, period);
      const months = withholdingByMonth(card, () => 60000, undefined, 2026);
      expect(months[5]).toBe(0);
      expect(months.reduce((s, v) => s + v, 0)).toBeCloseTo(perPayout * trekkPayouts, -1);
    }
  });

  it('runs a bonus through the table on top of one payout, June included', () => {
    const card = { kind: 'table' as const, table: '8130', year: 2026 };
    const t = table('8130');
    const gain = calcTabelltrekk(t, 50000 + 30000, 2026) - calcTabelltrekk(t, 50000, 2026);
    expect(withholdingForMonth(card, 50000, 3, 30000, 2026)).toBe(calcTabelltrekk(t, 50000, 2026) + gain);
    expect(withholdingForMonth(card, 50000, 6, 30000, 2026)).toBe(gain);
    expect(gain).toBeGreaterThan(30000 * 0.3);
  });

  it('applies prosenttrekk to a bonus too', () => {
    expect(withholdingForMonth({ kind: 'percent', pct: 30, year: 2026 }, 50000, 4, 10000)).toBe(18000);
  });

  it('applies prosenttrekk every month', () => {
    const card = { kind: 'percent' as const, pct: 33, year: 2026 };
    expect(withholdingForMonth(card, 50000, 6)).toBe(16500);
    expect(withholdingForMonth(card, 50000, 12)).toBe(16500);
  });

  it('returns 0 for an unknown table or unusable gross', () => {
    expect(withholdingForMonth({ kind: 'table', table: '1234', year: 2026 }, 50000, 1)).toBe(0);
    expect(withholdingForMonth({ kind: 'percent', pct: 30, year: 2026 }, NaN, 1)).toBe(0);
    expect(withholdingForMonth({ kind: 'percent', pct: NaN, year: 2026 }, 50000, 1)).toBe(0);
  });
});

describe('sanitizeTaxCard', () => {
  it('keeps a valid table or percent card', () => {
    expect(sanitizeTaxCard({ kind: 'table', table: '8130', year: 2026 })).toEqual({ kind: 'table', table: '8130', year: 2026 });
    expect(sanitizeTaxCard({ kind: 'percent', pct: 0, year: 2026 })).toEqual({ kind: 'percent', pct: 0, year: 2026 });
    expect(sanitizeTaxCard({ kind: 'table', table: '8130', period: '14d', year: 2026 }))
      .toEqual({ kind: 'table', table: '8130', period: '14d', year: 2026 });
  });

  it('drops anything malformed', () => {
    const y = { year: 2026 };
    for (const v of [null, 42, 'x', {}, { kind: 'table', table: '8135', ...y }, { kind: 'table', table: 8130, ...y },
      { kind: 'table', table: '8130', period: 'daily', ...y }, { kind: 'percent', pct: '30', ...y },
      { kind: 'percent', pct: 101, ...y }, { kind: 'percent', pct: -1, ...y }, { kind: 'other', ...y },
      { kind: 'table', table: '8130' }, { kind: 'table', table: '8130', year: 2026.5 }, { kind: 'percent', pct: 30, year: '2026' }]) {
      expect(sanitizeTaxCard(v)).toBeNull();
    }
  });
});

describe('trekkYear', () => {
  it('falls back to the latest published table year', () => {
    expect(trekkYear(2026)).toBe(2026);
    expect(trekkYear(2031)).toBe(2026);
  });
});

describe('cardNetForMonth', () => {
  const card = { kind: 'table' as const, table: '8130', year: 2026 };
  const yearly = (c: typeof card, monthlyGross: number) =>
    withholdingByMonth(c, () => monthlyGross, undefined, 2026).reduce((s, v) => s + v, 0);

  it('is flat: the card\'s yearly trekk spread over 12 months, the same in June and October', () => {
    const flat = Math.round(60000 - yearly(card, 60000) / 12);
    expect(cardNetForMonth(card, 'no', '2026-06', 720000, 0, 0)).toBe(flat);
    expect(cardNetForMonth(card, 'no', '2026-10', 720000, 0, 0)).toBe(flat);
    expect(cardNetForMonth(card, 'no', '2026-12', 720000, 0, 0)).toBe(flat);
  });

  it('nets one-off pay at the card\'s trekk on it, and takes IPS off', () => {
    const gain = withholdingForMonth(card, 60000, 3, 10000, 2026) - withholdingForMonth(card, 60000, 3, 0, 2026);
    expect(cardNetForMonth(card, 'no', '2026-03', 720000, 10000, 12000))
      .toBe(Math.round(60000 - yearly(card, 60000) / 12 + 10000 - gain - 1000));
  });

  it('caps the IPS deduction like the annual model', () => {
    expect(cardNetForMonth(card, 'no', '2026-03', 720000, 0, 15000)).toBe(cardNetForMonth(card, 'no', '2026-03', 720000, 0, 40000));
  });

  it('applies only in the card\'s own year and region', () => {
    expect(cardNetForMonth(null, 'no', '2026-03', 720000, 0, 0)).toBeNull();
    expect(cardNetForMonth(card, 'generic', '2026-03', 720000, 0, 0)).toBeNull();
    expect(cardNetForMonth(card, 'no', '2027-03', 720000, 0, 0)).toBeNull();
    expect(cardNetForMonth(card, 'no', '2025-03', 720000, 0, 0)).toBeNull();
  });

  it('ignores a malformed card instead of throwing', () => {
    for (const bad of [{ kind: 'table', table: 8130, year: 2026 }, { kind: 'table', table: '8130', period: 'x', year: 2026 },
      { kind: 'percent', pct: '30', year: 2026 }]) {
      expect(cardNetForMonth(bad, 'no', '2026-03', 720000, 0, 0)).toBeNull();
    }
  });

  it('keeps NaN out of the result', () => {
    expect(cardNetForMonth(card, 'no', '2026-03', NaN, NaN, NaN)).toBe(0);
  });
});
