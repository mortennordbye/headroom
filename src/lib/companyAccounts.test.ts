import { describe, it, expect } from 'vitest';
import { accountsMatch, accountsWarnings, compareWithAccounts, consultingRevenue, parseBrregResponse, sanitizeAccounts, withoutFit, type CompanyAccounts } from './companyAccounts';
import { sanitizeCompanyModel, DEFAULT_COMPANY_MODEL } from './companyCost';
import { calibrateBlocker } from './companyCalibrate';
import { buildModelFromAnswers, QUICK_DEFAULTS } from './companySetup';

const withGuess = buildModelFromAnswers(QUICK_DEFAULTS, structuredClone(DEFAULT_COMPANY_MODEL), { uncertain: ['salary'] });

// Made-up company and numbers.
const ORG = '999900003';
const acc = (patch: Partial<CompanyAccounts> = {}): CompanyAccounts => ({
  orgnr: ORG, name: 'Eksempel Konsulent AS', year: 2025, type: 'SELSKAP', currency: 'NOK',
  revenue: 80_000_000, operatingResult: 9_000_000, employees: 52, formCode: 'AS', naceCode: '62.020',
  hasParent: false, inGroup: false, fetchedAt: '2026-11-01T10:00:00.000Z', ...patch,
});
const routeBody = (patch: Record<string, unknown> = {}) => ({
  available: true, orgnr: ORG, stale: false, fetchedAt: '2026-11-01T10:00:00.000Z',
  entity: { name: 'Eksempel Konsulent AS', formCode: 'AS', naceCode: '62.020', employees: 52, hasParent: false, inGroup: false },
  accounts: { year: 2025, type: 'SELSKAP', currency: 'NOK', revenue: 80_000_000, operatingResult: 9_000_000 },
  ...patch,
});

describe('sanitizeAccounts', () => {
  it('keeps a valid record as it is', () => {
    expect(sanitizeAccounts(acc())).toEqual(acc());
  });

  it('drops a record with a bad org number, year or numbers', () => {
    expect(sanitizeAccounts(acc({ orgnr: '999900004' }))).toBeUndefined();
    expect(sanitizeAccounts({ ...acc(), year: 2025.5 })).toBeUndefined();
    expect(sanitizeAccounts({ ...acc(), revenue: 'lots' })).toBeUndefined();
    expect(sanitizeAccounts({ ...acc(), operatingResult: null })).toBeUndefined();
    expect(sanitizeAccounts('x')).toBeUndefined();
  });

  it('repairs the rest: unknown type, bad currency, negative employees, extra keys', () => {
    const out = sanitizeAccounts({ ...acc(), type: 'X', currency: 'kr', employees: -3, hasParent: 'yes', extra: 1 });
    expect(out).toMatchObject({ type: 'SELSKAP', currency: '', employees: null, hasParent: false });
    expect(out).not.toHaveProperty('extra');
  });

  it('a garbled currency is empty, warned about and refused by the fit', () => {
    for (const bad of ['kr', 'USDX', 'nok', 7, undefined]) {
      const out = sanitizeAccounts({ ...acc(), currency: bad })!;
      expect(out.currency).toBe('');
      expect(accountsWarnings(out)).toContain('currency');
      expect(calibrateBlocker(withGuess, out)).toBe('currency');
    }
  });

  it('is kept on the company model by its sanitizer, and dropped when not usable', () => {
    expect(sanitizeCompanyModel({ accounts: acc() }).accounts).toEqual(acc());
    expect(sanitizeCompanyModel({ accounts: { orgnr: '1' } }).accounts).toBeUndefined();
    expect(sanitizeCompanyModel({}).accounts).toBeUndefined();
  });
});

describe('parseBrregResponse', () => {
  it('reads accounts and entity into one record', () => {
    expect(parseBrregResponse(200, routeBody(), ORG)).toEqual({ kind: 'accounts', accounts: acc(), stale: false });
  });

  it('maps the other answers', () => {
    expect(parseBrregResponse(400, { error: 'x' }, ORG)).toEqual({ kind: 'invalid' });
    expect(parseBrregResponse(404, { error: 'x' }, ORG)).toEqual({ kind: 'notFound' });
    expect(parseBrregResponse(200, { available: false }, ORG)).toEqual({ kind: 'unavailable' });
    expect(parseBrregResponse(403, { error: 'demo' }, ORG)).toEqual({ kind: 'unavailable' });
    expect(parseBrregResponse(200, routeBody({ noAccounts: true, accounts: undefined, entity: { name: 'Enk', formCode: 'ENK' } }), ORG))
      .toEqual({ kind: 'noAccounts', name: 'Enk', formCode: 'ENK' });
  });

  it('never turns a bad body into numbers', () => {
    expect(parseBrregResponse(200, routeBody({ accounts: { year: 2025, revenue: '1', operatingResult: 1 } }), ORG)).toEqual({ kind: 'unavailable' });
    expect(parseBrregResponse(200, 'x', ORG)).toEqual({ kind: 'unavailable' });
  });
});

describe('accountsWarnings', () => {
  it('always warns about the year and resale; persons when employees are known', () => {
    expect(accountsWarnings(acc())).toEqual(['year', 'resale', 'persons']);
    expect(accountsWarnings(acc({ employees: null }))).toEqual(['year', 'resale']);
  });

  it('warns about group accounts, a holding or group entity, and another currency', () => {
    expect(accountsWarnings(acc({ type: 'KONSERN' }))).toContain('konsern');
    expect(accountsWarnings(acc({ naceCode: '64.200' }))).toContain('holding');
    expect(accountsWarnings(acc({ hasParent: true }))).toContain('holding');
    expect(accountsWarnings(acc({ inGroup: true }))).toContain('holding');
    expect(accountsWarnings(acc({ currency: 'USD' }))).toContain('currency');
  });
});

describe('consultingRevenue', () => {
  it('takes the resale share off the revenue', () => {
    expect(consultingRevenue(acc(), 0)).toBe(80_000_000);
    expect(consultingRevenue(acc(), 25)).toBe(60_000_000);
    expect(consultingRevenue(acc(), Number.NaN)).toBe(80_000_000);
  });
});

describe('the fit marker on the accounts', () => {
  const moves = [{ key: 'typicalBillablePct' as const, from: 85, to: 80.5 }, { key: 'salary' as const, from: 950_000, to: 990_000 }];

  it('keeps a valid fittedAt with its moves, and withoutFit drops both', () => {
    const fitted = acc({ fittedAt: '2026-11-20T10:00:00.000Z', fitMoves: moves });
    expect(sanitizeAccounts(fitted)).toEqual(fitted);
    expect(withoutFit(fitted)).toEqual(acc());
  });

  it('drops a bad fittedAt, and bad or repeated moves', () => {
    expect(sanitizeAccounts({ ...acc(), fittedAt: 'not a date', fitMoves: moves })).toEqual(acc());
    const bad = [...moves, moves[0], { key: 'rateAverage', from: 1, to: 2 }, { key: 'salary', from: 'x', to: 1 }];
    expect(sanitizeAccounts({ ...acc(), fittedAt: '2026-11-20T10:00:00.000Z', fitMoves: bad })!.fitMoves).toEqual(moves);
  });
});

describe('compareWithAccounts', () => {
  it('gives revenue, operating result and costs (revenue − result) with model − accounts', () => {
    const f = compareWithAccounts({ revenue: 83_700_000, ebit: -800_000 }, acc({ revenue: 77_400_000, operatingResult: 10_500_000 }));
    expect(f.revenue).toEqual({ model: 83_700_000, accounts: 77_400_000, diff: 6_300_000 });
    expect(f.operatingResult).toEqual({ model: -800_000, accounts: 10_500_000, diff: -11_300_000 });
    expect(f.costs).toEqual({ model: 84_500_000, accounts: 66_900_000, diff: 17_600_000 });
  });

  it('takes the resale share off the accounts\' revenue on both revenue and costs', () => {
    const f = compareWithAccounts({ revenue: 60_000_000, ebit: 5_000_000 }, acc({ revenue: 80_000_000, operatingResult: 9_000_000 }), 25);
    expect(f.revenue.accounts).toBe(60_000_000);
    expect(f.costs.accounts).toBe(51_000_000);
  });
});

describe('accountsMatch', () => {
  const a = acc({ revenue: 80_000_000, operatingResult: 9_000_000 });

  it('matches when both gaps are within 10 % of the accounts\' revenue', () => {
    expect(accountsMatch({ revenue: 80_000_000, ebit: 9_000_000 }, a)).toBe('match');
    expect(accountsMatch({ revenue: 88_000_000, ebit: 1_000_000 }, a)).toBe('match');
  });

  it('is a mismatch when the operating result or the revenue is more than 10 % of revenue apart', () => {
    expect(accountsMatch({ revenue: 80_000_000, ebit: 900_000 }, a)).toBe('mismatch');
    expect(accountsMatch({ revenue: 80_000_000, ebit: 17_500_000 }, a)).toBe('mismatch');
    expect(accountsMatch({ revenue: 88_500_000, ebit: 9_000_000 }, a)).toBe('mismatch');
  });

  it('compares with the revenue after resale', () => {
    expect(accountsMatch({ revenue: 60_000_000, ebit: 9_000_000 }, a)).toBe('mismatch');
    expect(accountsMatch({ revenue: 60_000_000, ebit: 9_000_000 }, a, 25)).toBe('match');
  });

  it('is unknown without accounts, in another currency, or with no revenue', () => {
    const m = { revenue: 80_000_000, ebit: 9_000_000 };
    expect(accountsMatch(m, undefined)).toBe('unknown');
    expect(accountsMatch(m, acc({ currency: 'SEK' }))).toBe('unknown');
    expect(accountsMatch(m, acc({ revenue: 0 }))).toBe('unknown');
    expect(accountsMatch({ revenue: Number.NaN, ebit: 0 }, a)).toBe('unknown');
  });
});
