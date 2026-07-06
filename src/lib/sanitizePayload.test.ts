import { describe, it, expect } from 'vitest';
import { coerceNumber, sanitizePayload } from './sanitizePayload';

const SCHEMAS = {
  assets: { portfolio: 0, taxRate: 0, houseValue: 0 },
  loan: { laanebelop: 0, rente: 0, gyldigTil: '' }, // gyldigTil is a string field — must be left alone
};

describe('coerceNumber', () => {
  it('keeps finite numbers, rejects NaN/Infinity', () => {
    expect(coerceNumber(5000)).toBe(5000);
    expect(coerceNumber(0)).toBe(0);
    expect(coerceNumber(NaN)).toBeUndefined();
    expect(coerceNumber(Infinity)).toBeUndefined();
  });
  it('parses numeric strings incl. locale comma/space', () => {
    expect(coerceNumber('5000')).toBe(5000);
    expect(coerceNumber('1 234,50')).toBe(1234.5);
    expect(coerceNumber('  42 ')).toBe(42);
  });
  it('rejects empty/garbage strings and other types', () => {
    expect(coerceNumber('')).toBeUndefined();
    expect(coerceNumber('abc')).toBeUndefined();
    expect(coerceNumber(null)).toBeUndefined();
    expect(coerceNumber(undefined)).toBeUndefined();
    expect(coerceNumber({})).toBeUndefined();
  });
});

describe('sanitizePayload', () => {
  it('coerces a stringified top-level number (the backlog NaN case)', () => {
    const out = sanitizePayload({ income: '55000' } as Record<string, unknown>, SCHEMAS);
    expect(out.income).toBe(55000);
  });

  it('coerces a stringified nested numeric field but leaves string fields alone', () => {
    const out = sanitizePayload(
      { assets: { portfolio: '5000', taxRate: 22 }, loan: { laanebelop: '2000000', gyldigTil: '2026-12-31' } } as Record<string, unknown>,
      SCHEMAS,
    );
    expect((out.assets as Record<string, unknown>).portfolio).toBe(5000);
    expect((out.assets as Record<string, unknown>).taxRate).toBe(22);
    expect((out.loan as Record<string, unknown>).laanebelop).toBe(2000000);
    expect((out.loan as Record<string, unknown>).gyldigTil).toBe('2026-12-31'); // untouched
  });

  it('drops an unparseable numeric field so the merge can restore the default', () => {
    const out = sanitizePayload({ assets: { portfolio: 'oops', houseValue: 1000 } } as Record<string, unknown>, SCHEMAS);
    expect('portfolio' in (out.assets as object)).toBe(false); // dropped → default fills it
    expect((out.assets as Record<string, unknown>).houseValue).toBe(1000);
  });

  it('sanitizes number records, dropping bad entries', () => {
    const out = sanitizePayload(
      { monthlyIncomes: { '2026-01': '50000', '2026-02': 'x', '2026-03': 48000 } } as Record<string, unknown>,
      SCHEMAS,
    );
    expect(out.monthlyIncomes).toEqual({ '2026-01': 50000, '2026-03': 48000 });
  });

  it('leaves unrelated fields and clean data untouched', () => {
    const clean = { income: 50000, lang: 'nb', region: 'no', fixedExpenses: [{ id: 'a', amount: 100 }] };
    expect(sanitizePayload({ ...clean } as Record<string, unknown>, SCHEMAS)).toEqual(clean);
  });

  it('passes through null / non-object input (first-run guard is the caller\'s job)', () => {
    expect(sanitizePayload(null as unknown as Record<string, unknown>, SCHEMAS)).toBeNull();
  });
});
