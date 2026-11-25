/**
 * "Hurtigoppsett" for the company model: a few plain answers about the company
 * become role groups, cost lines and your own billable share. The groups and
 * cost lines stay the source of truth for the maths (companyCost.ts); the
 * answers are kept in `companyModel.quick` so the form can show them again.
 *
 * Groups built here:
 * - delivery: everyone in an assignment = total − non-billing − bench, at the
 *   mean salary, the typical billable share and the average rate;
 * - bench: a support group at 0 % billable and the consultants' salary, so its
 *   cost goes into the shared pool;
 * - leadership, HR, marketing: a support group at 0 % billable.
 * The mean salary is the midpoint of the low–high answer.
 *
 * This module imports only types from companyCost.ts, so the sanitizer there
 * can use `sanitizeQuick` without an import cycle at run time.
 */

import type { CompanyModel, CompanyGroup, CompanyCostLine } from './companyCost';
import { coerceNumber } from './sanitizePayload';
import { withoutFit } from './companyAccounts';

export type OfficeMode = 'desks' | 'rent';

export interface QuickAnswers {
  totalFte: number;          // årsverk in the company
  nonBilling: number;        // leadership, HR, marketing (FTE)
  onBench: number;           // consultants without a client now
  salaryLow: number;         // consultants' salary, low end
  salaryHigh: number;        // consultants' salary, high end
  rateAverage: number;       // average list rate, kr/h
  rateYou: number;           // your list rate, kr/h
  ownBillablePct: number;    // your billable share of available hours
  typicalBillablePct: number; // a typical consultant's billable share
  realizationPct: number;
  bonusPct: number;          // bonus pool, % of the result before bonus
  officeMode: OfficeMode;
  /** Missing: one desk per FTE. */
  desks?: number;
  annualRent: number;        // kr per year
  tripsPerYear: number;
  /**
   * Share of revenue that is resold subcontractors (videresalg), %. Missing: 0.
   * Not part of the model; it only lowers the accounts' revenue before the
   * comparison and the fit (companyAccounts.ts, companyCalibrate.ts).
   */
  resaleSharePct?: number;
}

/** Highest resale share the setup takes, %. */
export const QUICK_RESALE_MAX_PCT = 90;

/** The answers that can be a guess ("usikker") or unknown ("vet ikke"). */
export const QUICK_GUESS_KEYS = ['salary', 'rateAverage', 'ownBillablePct', 'typicalBillablePct', 'realizationPct', 'office'] as const;
export type QuickGuessKey = typeof QUICK_GUESS_KEYS[number];

export interface CompanyQuick {
  answers: QuickAnswers;
  uncertain: QuickGuessKey[];
  dontKnow: QuickGuessKey[];
  /** True after a hand edit of groups or cost lines: rebuilding then replaces those edits. */
  edited: boolean;
}

/** Typical values for a Norwegian IT consultancy; "vet ikke" uses them. */
export const QUICK_DEFAULTS: QuickAnswers = {
  totalFte: 50,
  nonBilling: 6,
  onBench: 2,
  salaryLow: 800_000,
  salaryHigh: 1_100_000,
  rateAverage: 1450,
  rateYou: 1450,
  ownBillablePct: 85,
  typicalBillablePct: 85,
  realizationPct: 95,
  bonusPct: 15,
  officeMode: 'desks',
  annualRent: 3_600_000,
  tripsPerYear: 2,
};

/** Office cost per desk per year (rent, power, cleaning), an industry estimate. */
export const QUICK_KR_PER_DESK = 72_000;
/** Social cost per head: one trip, and other events per year. */
export const QUICK_KR_PER_TRIP = 15_000;
export const QUICK_KR_EVENTS = 5_000;
/** Other per-head costs that the setup does not ask about. */
export const QUICK_KR_IT = 25_000;
export const QUICK_KR_INSURANCE = 12_000;
export const QUICK_KR_COURSES = 15_000;
export const QUICK_KR_SERVICES = 30_000;
export const QUICK_OTP_ADMIN_PCT = 0.7;

/** Group and cost-line names. The default is Norwegian, as DEFAULT_COMPANY_MODEL. */
export interface QuickLabels {
  delivery: string;
  bench: string;
  support: string;
  office: string;
  it: string;
  insurance: string;
  social: string;
  courses: string;
  services: string;
  otpAdmin: string;
}

export const QUICK_LABELS_NB: QuickLabels = {
  delivery: 'Konsulenter',
  bench: 'Benk',
  support: 'Ledelse, HR, marked',
  office: 'Kontor (leie, strøm, renhold)',
  it: 'IT, telefon, lisenser',
  insurance: 'Forsikring (yrkesskade, helse)',
  social: 'Turer og arrangementer',
  courses: 'Kurs og konferanser',
  services: 'Regnskap, revisjon, rekruttering, marked',
  otpAdmin: 'OTP-administrasjon og risikodekning',
};

const fin = (v: number) => (Number.isFinite(v) ? v : 0);

/** The mean consultant salary used in the model: the midpoint of low and high. */
export function quickMeanSalary(a: QuickAnswers): number {
  return (Math.max(0, fin(a.salaryLow)) + Math.max(0, fin(a.salaryHigh))) / 2;
}

/** FTE in an assignment: total − non-billing − bench, never below 0. */
export function quickDeliveryFte(a: QuickAnswers): number {
  return Math.max(0, fin(a.totalFte) - Math.max(0, fin(a.nonBilling)) - Math.max(0, fin(a.onBench)));
}

/** The office cost per year: desks (default one per FTE) × the desk price, or the yearly rent. */
export function quickOfficeCost(a: QuickAnswers): number {
  return a.officeMode === 'rent' ? Math.max(0, fin(a.annualRent)) : Math.max(0, fin(a.desks ?? a.totalFte)) * QUICK_KR_PER_DESK;
}

/**
 * The company model from the answers. Groups, cost lines, the bonus pool and
 * your own billable share and rate come from the answers; hours, the bonus
 * holiday-pay setting, the mode and the target margin are kept from `base`.
 * Levers go to 0, because they would move the new groups. A fit to the
 * accounts (accounts.fittedAt) is dropped, because the answers it fitted are gone.
 */
export function buildModelFromAnswers(
  answers: QuickAnswers,
  base: CompanyModel,
  opts: { uncertain?: readonly QuickGuessKey[]; dontKnow?: readonly QuickGuessKey[]; labels?: QuickLabels } = {},
): CompanyModel {
  const a = sanitizeQuickAnswers(answers);
  const L = opts.labels ?? QUICK_LABELS_NB;
  const mean = quickMeanSalary(a);
  const highMid = (mean + a.salaryHigh) / 2;

  const groups: CompanyGroup[] = [
    { id: 'kons', name: L.delivery, kind: 'delivery', count: quickDeliveryFte(a), avgGross: mean, billablePct: a.typicalBillablePct, hourlyRate: a.rateAverage, realizationPct: a.realizationPct },
    { id: 'benk', name: L.bench, kind: 'support', count: a.onBench, avgGross: mean, billablePct: 0, hourlyRate: a.rateAverage, realizationPct: a.realizationPct },
    { id: 'led', name: L.support, kind: 'support', count: a.nonBilling, avgGross: highMid, billablePct: 0, hourlyRate: 0, realizationPct: a.realizationPct },
  ];
  const costs: CompanyCostLine[] = [
    { id: 'office', label: L.office, amount: quickOfficeCost(a), per: 'company' },
    { id: 'it', label: L.it, amount: QUICK_KR_IT, per: 'head' },
    { id: 'insurance', label: L.insurance, amount: QUICK_KR_INSURANCE, per: 'head' },
    { id: 'social', label: L.social, amount: a.tripsPerYear * QUICK_KR_PER_TRIP + QUICK_KR_EVENTS, per: 'head' },
    { id: 'courses', label: L.courses, amount: QUICK_KR_COURSES, per: 'head' },
    { id: 'services', label: L.services, amount: QUICK_KR_SERVICES, per: 'head' },
    { id: 'otpAdmin', label: L.otpAdmin, amount: QUICK_OTP_ADMIN_PCT, per: 'pctOfSalary' },
  ];
  const known = (keys: readonly QuickGuessKey[] | undefined) => QUICK_GUESS_KEYS.filter((k) => keys?.includes(k));

  return {
    ...base,
    groups,
    selfGroupId: 'kons',
    costs,
    bonus: { ...base.bonus, poolPct: a.bonusPct },
    levers: { utilizationPp: 0, ratePct: 0, salaryPct: 0, realizationPp: 0 },
    self: { billablePct: a.ownBillablePct, hourlyRate: a.rateYou },
    quick: { answers: a, uncertain: known(opts.uncertain), dontKnow: known(opts.dontKnow), edited: false },
    ...(base.accounts ? { accounts: withoutFit(base.accounts) } : {}),
  };
}

/**
 * Drop a fit to the accounts (fittedAt, fitMoves), for a change the fit did not
 * see, such as hours or the bonus holiday-pay setting. Leaves quick.edited alone.
 */
export function clearAccountsFit(m: CompanyModel): CompanyModel {
  return m.accounts?.fittedAt ? { ...m, accounts: withoutFit(m.accounts) } : m;
}

/**
 * Mark the quick setup as hand-edited and drop a fit to the accounts, which no
 * longer describes the groups (no change when there is no quick setup).
 */
export function markQuickEdited(m: CompanyModel): CompanyModel {
  if (!m.quick || (m.quick.edited && !m.accounts?.fittedAt)) return m;
  return clearAccountsFit({ ...m, quick: { ...m.quick, edited: true } });
}

// ── Sanitizer ──────────────────────────────────────────────────────────────

const num = (v: unknown, fallback: number, lo: number, hi: number): number => {
  const n = coerceNumber(v);
  return n === undefined ? fallback : Math.min(hi, Math.max(lo, n));
};
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Known keys only, each finite and in range; a missing or bad value gets its default. */
export function sanitizeQuickAnswers(v: unknown): QuickAnswers {
  const a = isObj(v) ? v : {};
  const d = QUICK_DEFAULTS;
  const totalFte = num(a.totalFte, d.totalFte, 0, 100_000);
  const nonBilling = num(a.nonBilling, d.nonBilling, 0, totalFte);
  const salaryLow = num(a.salaryLow, d.salaryLow, 0, 100_000_000);
  return {
    totalFte,
    nonBilling,
    onBench: num(a.onBench, d.onBench, 0, Math.max(0, totalFte - nonBilling)),
    salaryLow,
    salaryHigh: num(a.salaryHigh, Math.max(salaryLow, d.salaryHigh), salaryLow, 100_000_000),
    rateAverage: num(a.rateAverage, d.rateAverage, 0, 100_000),
    rateYou: num(a.rateYou, d.rateYou, 0, 100_000),
    ownBillablePct: num(a.ownBillablePct, d.ownBillablePct, 0, 100),
    typicalBillablePct: num(a.typicalBillablePct, d.typicalBillablePct, 0, 100),
    realizationPct: num(a.realizationPct, d.realizationPct, 0, 100),
    bonusPct: num(a.bonusPct, d.bonusPct, 0, 50),
    officeMode: a.officeMode === 'rent' ? 'rent' : 'desks',
    annualRent: num(a.annualRent, d.annualRent, 0, 1_000_000_000),
    tripsPerYear: num(a.tripsPerYear, d.tripsPerYear, 0, 52),
    // Kept only when it was given, so a missing desk count follows the FTE answer.
    ...(coerceNumber(a.desks) !== undefined ? { desks: num(a.desks, 0, 0, 100_000) } : {}),
    // Kept only when it was given, so older saves keep their shape.
    ...(coerceNumber(a.resaleSharePct) !== undefined ? { resaleSharePct: num(a.resaleSharePct, 0, 0, QUICK_RESALE_MAX_PCT) } : {}),
  };
}

/** The stored quick setup repaired, or undefined when there is none. */
export function sanitizeQuick(v: unknown): CompanyQuick | undefined {
  if (!isObj(v)) return undefined;
  const keys = (x: unknown): QuickGuessKey[] =>
    Array.isArray(x) ? QUICK_GUESS_KEYS.filter((k) => x.includes(k)) : [];
  const dontKnow = keys(v.dontKnow);
  return {
    answers: sanitizeQuickAnswers(v.answers),
    // One key is either a guess or unknown, never both.
    uncertain: keys(v.uncertain).filter((k) => !dontKnow.includes(k)),
    dontKnow,
    edited: v.edited === true,
  };
}
