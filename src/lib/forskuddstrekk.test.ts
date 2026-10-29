import { describe, it, expect } from 'vitest';
import {
  parseTableNumber, calcTabelltrekk, withholdingForMonth, withholdingByMonth, sanitizeTaxCard, trekkYear,
  type TrekkTable,
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
    const card = { kind: 'table' as const, table: '8130' };
    const full = calcTabelltrekk(table('8130'), 50000, 2026);
    expect(withholdingForMonth(card, 50000, 5, 2026)).toBe(full);
    expect(withholdingForMonth(card, 50000, 6, 2026)).toBe(0);
    expect(withholdingForMonth(card, 50000, 12, 2026)).toBe(Math.round(full / 2));
  });

  it('withholds every month on a 12-month table', () => {
    const card = { kind: 'table' as const, table: '7350' };
    const months = withholdingByMonth(card, () => 50000, 2026);
    expect(new Set(months).size).toBe(1);
    expect(months[0]).toBeGreaterThan(0);
  });

  it('a 10.5-month table withholds 10.5 months of the same trekk over the year', () => {
    const card = { kind: 'table' as const, table: '8000' };
    const full = calcTabelltrekk(table('8000'), 60000, 2026);
    const year = withholdingByMonth(card, () => 60000, 2026).reduce((s, v) => s + v, 0);
    expect(year).toBe(full * 10 + Math.round(full / 2));
  });

  it('applies prosenttrekk every month', () => {
    const card = { kind: 'percent' as const, pct: 33 };
    expect(withholdingForMonth(card, 50000, 6)).toBe(16500);
    expect(withholdingForMonth(card, 50000, 12)).toBe(16500);
  });

  it('returns 0 for an unknown table or unusable gross', () => {
    expect(withholdingForMonth({ kind: 'table', table: '1234' }, 50000, 1)).toBe(0);
    expect(withholdingForMonth({ kind: 'percent', pct: 30 }, NaN, 1)).toBe(0);
    expect(withholdingForMonth({ kind: 'percent', pct: NaN }, 50000, 1)).toBe(0);
  });
});

describe('sanitizeTaxCard', () => {
  it('keeps a valid table or percent card', () => {
    expect(sanitizeTaxCard({ kind: 'table', table: '8130' })).toEqual({ kind: 'table', table: '8130' });
    expect(sanitizeTaxCard({ kind: 'percent', pct: 0 })).toEqual({ kind: 'percent', pct: 0 });
  });

  it('drops anything malformed', () => {
    for (const v of [null, 42, 'x', {}, { kind: 'table', table: '8135' }, { kind: 'table', table: 8130 },
      { kind: 'percent', pct: '30' }, { kind: 'percent', pct: 101 }, { kind: 'percent', pct: -1 }, { kind: 'other' }]) {
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
