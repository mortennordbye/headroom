/**
 * The company's public annual accounts from Brønnøysund (GET /api/brreg/:orgnr,
 * server/brreg.js), saved on the company model as `companyModel.accounts` so
 * Avansert can compare the model with them. Only the numbers the comparison
 * needs and the facts behind the warnings are kept.
 *
 * This module imports nothing from companyCost.ts at run time, so the sanitizer
 * there can use `sanitizeAccounts` without an import cycle.
 */

import { coerceNumber } from './sanitizePayload';
import { isValidOrgnr } from './validators';

export type AccountsType = 'SELSKAP' | 'KONSERN';

export interface CompanyAccounts {
  orgnr: string;
  name: string;
  /** The accounting year (the year the period ends). */
  year: number;
  /** SELSKAP: the company's own accounts; KONSERN: the group's. */
  type: AccountsType;
  /** ISO code; the model is in NOK. */
  currency: string;
  /** Sum of operating income (sum driftsinntekter), kr. */
  revenue: number;
  /** Operating result (driftsresultat), kr. */
  operatingResult: number;
  /** Persons registered as employees (not FTE), or null when not registered. */
  employees: number | null;
  /** Organisation form code, e.g. AS, ASA, ENK. */
  formCode: string;
  /** Main NACE code (næringskode 1), e.g. 62.020. */
  naceCode: string;
  /** Has a parent entity in the register (overordnet enhet). */
  hasParent: boolean;
  /** Registered as part of a group (konsern). */
  inGroup: boolean;
  /** ISO time the app fetched it. */
  fetchedAt: string;
}

/** What one lookup gave, for the card. */
export type BrregLookup =
  | { kind: 'accounts'; accounts: CompanyAccounts; stale: boolean }
  | { kind: 'noAccounts'; name: string; formCode: string }
  | { kind: 'notFound' }
  | { kind: 'invalid' }
  | { kind: 'unavailable' };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

/** The stored accounts repaired, or undefined when they are not usable. */
export function sanitizeAccounts(v: unknown): CompanyAccounts | undefined {
  if (!isObj(v)) return undefined;
  const orgnr = typeof v.orgnr === 'string' ? v.orgnr : '';
  const year = coerceNumber(v.year);
  const revenue = coerceNumber(v.revenue);
  const operatingResult = coerceNumber(v.operatingResult);
  if (!isValidOrgnr(orgnr) || year === undefined || !Number.isInteger(year) || year < 1900 || year > 2200
    || revenue === undefined || operatingResult === undefined) return undefined;
  const employees = coerceNumber(v.employees);
  const currency = str(v.currency, 3);
  return {
    orgnr,
    name: str(v.name, 200),
    year,
    type: v.type === 'KONSERN' ? 'KONSERN' : 'SELSKAP',
    currency: /^[A-Z]{3}$/.test(currency) ? currency : 'NOK',
    revenue,
    operatingResult,
    employees: employees !== undefined && employees >= 0 ? Math.round(employees) : null,
    formCode: str(v.formCode, 10),
    naceCode: str(v.naceCode, 10),
    hasParent: v.hasParent === true,
    inGroup: v.inGroup === true,
    fetchedAt: typeof v.fetchedAt === 'string' && !Number.isNaN(Date.parse(v.fetchedAt)) ? v.fetchedAt : new Date(0).toISOString(),
  };
}

/**
 * Read one answer of GET /api/brreg/:orgnr. A body that is not the expected
 * shape counts as "unavailable", never as numbers.
 */
export function parseBrregResponse(status: number, data: unknown, orgnr: string): BrregLookup {
  if (status === 400) return { kind: 'invalid' };
  if (status === 404) return { kind: 'notFound' };
  if (status !== 200 || !isObj(data) || data.available !== true || !isObj(data.entity)) return { kind: 'unavailable' };
  const e = data.entity;
  if (data.noAccounts === true) return { kind: 'noAccounts', name: str(e.name, 200), formCode: str(e.formCode, 10) };
  const a = isObj(data.accounts) ? data.accounts : null;
  if (!a || finite(a.revenue) === undefined || finite(a.operatingResult) === undefined) return { kind: 'unavailable' };
  const accounts = sanitizeAccounts({
    orgnr,
    name: e.name,
    year: a.year,
    type: a.type,
    currency: a.currency,
    revenue: a.revenue,
    operatingResult: a.operatingResult,
    employees: e.employees ?? null,
    formCode: e.formCode,
    naceCode: e.naceCode,
    hasParent: e.hasParent,
    inGroup: e.inGroup,
    fetchedAt: typeof data.fetchedAt === 'string' ? data.fetchedAt : new Date().toISOString(),
  });
  return accounts ? { kind: 'accounts', accounts, stale: data.stale === true } : { kind: 'unavailable' };
}

/**
 * The warnings the card shows under the comparison, in order:
 * - year: the accounts are for an earlier year than the model (always shown);
 * - konsern: these are the group's accounts, not one company's;
 * - holding: the entity looks like a holding company or part of a group
 *   (NACE 64.2, a parent entity, or registered in a group);
 * - resale: resold subcontractors inflate revenue (always shown);
 * - persons: the register counts persons, not FTE;
 * - currency: the accounts are not in NOK.
 */
export type AccountsWarning = 'year' | 'konsern' | 'holding' | 'resale' | 'persons' | 'currency';

export function accountsWarnings(a: CompanyAccounts): AccountsWarning[] {
  const out: AccountsWarning[] = ['year'];
  if (a.type === 'KONSERN') out.push('konsern');
  if (/^64\.2/.test(a.naceCode) || a.hasParent || a.inGroup) out.push('holding');
  out.push('resale');
  if (a.employees != null) out.push('persons');
  if (a.currency !== 'NOK') out.push('currency');
  return out;
}

/** The revenue the model can be compared with: the accounts' revenue less resold subcontractors. */
export function consultingRevenue(a: Pick<CompanyAccounts, 'revenue'>, resaleSharePct: number): number {
  const pct = Number.isFinite(resaleSharePct) ? Math.min(100, Math.max(0, resaleSharePct)) : 0;
  return a.revenue * (1 - pct / 100);
}
