import { describe, it, expect } from 'vitest';
import { accountsWarnings, consultingRevenue, parseBrregResponse, sanitizeAccounts, type CompanyAccounts } from './companyAccounts';
import { sanitizeCompanyModel } from './companyCost';

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
    expect(out).toMatchObject({ type: 'SELSKAP', currency: 'NOK', employees: null, hasParent: false });
    expect(out).not.toHaveProperty('extra');
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
