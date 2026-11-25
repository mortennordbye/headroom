/**
 * Company model for the "Avansert" mode of the employer-cost page: your salary
 * inside a whole consultancy. What you really cost (your own cost plus your
 * share of the overhead), what one billable hour must pay for, and how the
 * company result moves with utilization, rates, salaries and realization.
 *
 * Fixed pay only. Every person's cost is `calcEmployerCost` with the flat
 * overhead of the simple mode switched off (the cost lines here replace it).
 *
 * Hours come from the calendar: paid = weekdays × hours per day. Available =
 * (paid − weekday public holidays − holiday days) × (1 − sick % − internal %).
 * Billable = available × the group's billable share ("fakturerbar andel" always
 * means a share of AVAILABLE hours).
 *
 * Overhead pool = support groups' cost − their billed revenue + all cost lines.
 * It is shared per delivery FTE (your share) and also shown per billable hour.
 * The pool is not clamped; it can be below 0.
 *
 * Bonus = max(0, result before bonus) × pool % × (1 + holiday pay %) × (1 + AGA).
 * Tax is an estimate: max(0, EBIT) × corporate tax % (EBIT is not the tax base).
 *
 * Every division is guarded, so empty groups, count 0, 0 hours or a negative
 * pool give finite numbers, never NaN or Infinity.
 */

import { calcEmployerCost, type EmployerCostConfig, type BillingRateConfig } from './employerCost';
import { weekdaysInYear, weekdayHolidays, corporateTaxPct } from './norwegianCalendar';
import { coerceNumber } from './sanitizePayload';

export type CompanyGroupKind = 'delivery' | 'support';

export interface CompanyGroup {
  id: string;
  name: string;
  kind: CompanyGroupKind;
  count: number;          // FTE, decimals allowed
  avgGross: number;       // fixed pay per FTE
  billablePct: number;    // share of AVAILABLE hours
  hourlyRate: number;     // list price
  realizationPct: number; // share of the list price the client really pays
}

export type CostLinePer = 'company' | 'head' | 'pctOfSalary';

export interface CompanyCostLine {
  id: string;
  label: string;
  amount: number;         // kr, kr per head, or % of total salary
  per: CostLinePer;
}

export interface CompanyLevers {
  utilizationPp: number;  // delivery groups' billable share, percentage points
  ratePct: number;        // all hourly rates, %
  salaryPct: number;      // the groups' salaries, % (yours comes from the salary page)
  realizationPp: number;  // all realization, percentage points
}

export interface CompanyModel {
  mode: 'simple' | 'advanced';
  groups: CompanyGroup[];
  selfGroupId: string | null; // your group (a delivery group); its count includes you
  hours: { sickPct: number; internalPct: number; holidayDays: number };
  costs: CompanyCostLine[];
  bonus: { poolPct: number; includesHolidayPay: boolean };
  levers: CompanyLevers;
}

/** Inputs from outside the model (salary page, cost and billing settings). */
export interface CompanyContext {
  year: number;
  hoursPerDay: number;
  /** Your gross salary (the salary page, or its override on this page). */
  ownGross: number;
  otpPct: number;
  /** Holiday pay and AGA. Its flat overhead fields are ignored here. */
  costConfig: EmployerCostConfig;
  holidayPayInSalary: boolean;
  otpCap: boolean;
  /** Your billable hours when set (> 0); otherwise your group's hours. */
  selfBillableHoursOverride?: number | null;
}

export const NEUTRAL_LEVERS: CompanyLevers = { utilizationPp: 0, ratePct: 0, salaryPct: 0, realizationPp: 0 };

/** Slider range of each lever; the sanitizer clamps stored levers to it. */
export const LEVER_RANGES: Record<keyof CompanyLevers, { min: number; max: number }> = {
  utilizationPp: { min: -25, max: 12 },
  ratePct: { min: -15, max: 15 },
  salaryPct: { min: -10, max: 15 },
  realizationPp: { min: -15, max: 7 },
};

/** Upper limit of the bonus pool, % of the result before bonus. */
export const BONUS_POOL_MAX_PCT = 50;

// Made-up example company (role groups only), as in the approved plan.
export const DEFAULT_COMPANY_MODEL: CompanyModel = {
  mode: 'simple',
  groups: [
    { id: 'kons', name: 'Konsulenter', kind: 'delivery', count: 38, avgGross: 820_000, billablePct: 84, hourlyRate: 1300, realizationPct: 93 },
    { id: 'tl', name: 'Teamledere', kind: 'delivery', count: 6, avgGross: 950_000, billablePct: 60, hourlyRate: 1450, realizationPct: 93 },
    { id: 'led', name: 'Ledelse', kind: 'support', count: 4, avgGross: 1_200_000, billablePct: 10, hourlyRate: 1600, realizationPct: 93 },
    { id: 'stab', name: 'Stab (HR, marked)', kind: 'support', count: 2, avgGross: 700_000, billablePct: 0, hourlyRate: 0, realizationPct: 93 },
  ],
  selfGroupId: 'kons',
  // 25 holiday days = 5 weeks of weekdays, the avtalefestet ferie that matches
  // the 12 % feriepenger default (FERIEPENGER_DEFAULT_PCT).
  hours: { sickPct: 4, internalPct: 4.5, holidayDays: 25 },
  costs: [
    { id: 'office', label: 'Kontor (leie, strøm, renhold)', amount: 3_200_000, per: 'company' },
    { id: 'it', label: 'IT, telefon, lisenser', amount: 25_000, per: 'head' },
    { id: 'insurance', label: 'Forsikring (yrkesskade, helse)', amount: 12_000, per: 'head' },
    { id: 'social', label: 'Turer og arrangementer', amount: 20_000, per: 'head' },
    { id: 'courses', label: 'Kurs og konferanser', amount: 15_000, per: 'head' },
    { id: 'services', label: 'Regnskap, revisjon, rekruttering, marked', amount: 1_500_000, per: 'company' },
    { id: 'otpAdmin', label: 'OTP-administrasjon og risikodekning', amount: 0.7, per: 'pctOfSalary' },
  ],
  bonus: { poolPct: 15, includesHolidayPay: true },
  levers: { ...NEUTRAL_LEVERS },
};

// ── Results ────────────────────────────────────────────────────────────────

export interface CompanyHours {
  weekdays: number;
  paid: number;            // weekdays × hours per day
  publicHolidayHours: number;
  holidayHours: number;    // holiday days (ferie) × hours per day
  sick: number;
  internal: number;
  available: number;
}

export interface GroupResult extends CompanyGroup {
  billableHours: number;   // per FTE
  costPerFte: number;
  revenuePerFte: number;
  cost: number;
  revenue: number;
}

export interface CostLineResult extends CompanyCostLine {
  total: number;           // kr per year
}

export interface CompanyResult {
  hours: CompanyHours;
  groups: GroupResult[];
  heads: number;
  deliveryFte: number;
  salaryTotal: number;
  lines: CostLineResult[];
  linesTotal: number;
  revenue: number;
  peopleCost: number;
  supportNet: number;      // support cost − support revenue
  pool: number;            // supportNet + linesTotal
  preBonus: number;
  bonus: number;
  ebit: number;
  tax: number;
  afterTax: number;
  marginPct: number;       // EBIT / revenue
  meanUtilizationPct: number; // FTE-weighted billable share of the delivery groups
  overheadPerBillableHour: number;
  you: {
    gross: number;
    ownCost: number;
    share: number;         // pool / delivery FTE
    realCost: number;
    billableHours: number;
    breakEvenRate: number; // realCost / billableHours
    listRate: number;
    realizationPct: number;
  };
  kpis: {
    revenuePerFte: number;
    grossMarginPerFte: number; // in your group (else the first delivery group)
    deliverySharePct: number;
  };
}

const fin = (v: number) => (Number.isFinite(v) ? v : 0);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, fin(v)));
const div = (a: number, b: number) => (b > 0 ? a / b : 0);
const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

/** Paid and available hours per FTE for the year. */
export function companyHours(model: CompanyModel, year: number, hoursPerDay: number): CompanyHours {
  const hpd = Math.max(0, fin(hoursPerDay));
  const weekdays = weekdaysInYear(year);
  const paid = weekdays * hpd;
  const publicHolidayHours = weekdayHolidays(year) * hpd;
  const holidayHours = Math.max(0, fin(model.hours.holidayDays)) * hpd;
  const afterFree = Math.max(0, paid - publicHolidayHours - holidayHours);
  const sick = afterFree * clamp(model.hours.sickPct, 0, 100) / 100;
  const internal = afterFree * clamp(model.hours.internalPct, 0, 100) / 100;
  const available = Math.max(0, afterFree - sick - internal);
  return { weekdays, paid, publicHolidayHours, holidayHours, sick, internal, available };
}

/** A person's yearly cost: salary, holiday pay, OTP, AGA. No flat overhead. */
function personCost(gross: number, ctx: CompanyContext): number {
  const cfg = { ...ctx.costConfig, overheadAnnual: 0, overheadPct: 0 };
  return fin(calcEmployerCost(gross, ctx.otpPct, cfg, ctx.holidayPayInSalary, ctx.year, ctx.otpCap).totalEmployerCost);
}

/** The groups with the levers applied (the "what if"), clamped to valid ranges. */
function leveredGroup(g: CompanyGroup, l: CompanyLevers): CompanyGroup {
  return {
    ...g,
    avgGross: Math.max(0, fin(g.avgGross) * (1 + fin(l.salaryPct) / 100)),
    hourlyRate: Math.max(0, fin(g.hourlyRate) * (1 + fin(l.ratePct) / 100)),
    realizationPct: clamp(fin(g.realizationPct) + fin(l.realizationPp), 0, 100),
    billablePct: g.kind === 'delivery'
      ? clamp(fin(g.billablePct) + fin(l.utilizationPp), 0, 100)
      : clamp(g.billablePct, 0, 100),
  };
}

/** The whole model with the given levers (default: the model's own levers). */
export function calcCompany(model: CompanyModel, ctx: CompanyContext, levers: CompanyLevers = model.levers): CompanyResult {
  const hours = companyHours(model, ctx.year, ctx.hoursPerDay);
  const A = hours.available;

  const groups: GroupResult[] = model.groups.map((raw) => {
    const g = leveredGroup(raw, levers);
    const count = Math.max(0, fin(g.count));
    const billableHours = A * g.billablePct / 100;
    const costPerFte = personCost(g.avgGross, ctx);
    const revenuePerFte = billableHours * g.hourlyRate * g.realizationPct / 100;
    return { ...g, count, billableHours, costPerFte, revenuePerFte, cost: costPerFte * count, revenue: revenuePerFte * count };
  });
  const delivery = groups.filter((g) => g.kind === 'delivery');
  const heads = sum(groups, (g) => g.count);
  const deliveryFte = sum(delivery, (g) => g.count);
  const salaryTotal = sum(groups, (g) => g.avgGross * g.count);

  const lines: CostLineResult[] = model.costs.map((c) => {
    const amount = fin(c.amount);
    const total = c.per === 'company' ? amount : c.per === 'head' ? amount * heads : salaryTotal * amount / 100;
    return { ...c, amount, total };
  });
  const linesTotal = sum(lines, (c) => c.total);

  const revenue = sum(groups, (g) => g.revenue);
  const peopleCost = sum(groups, (g) => g.cost);
  const supportNet = sum(groups.filter((g) => g.kind === 'support'), (g) => g.cost - g.revenue);
  const pool = supportNet + linesTotal;
  const preBonus = revenue - peopleCost - linesTotal;
  const holidayPct = model.bonus.includesHolidayPay ? Math.max(0, fin(ctx.costConfig.feriepengesatsPct)) : 0;
  const bonus = Math.max(0, preBonus) * clamp(model.bonus.poolPct, 0, BONUS_POOL_MAX_PCT) / 100
    * (1 + holidayPct / 100) * (1 + Math.max(0, fin(ctx.costConfig.payrollTaxPct)) / 100);
  const ebit = preBonus - bonus;
  const tax = Math.max(0, ebit) * corporateTaxPct(ctx.year) / 100;

  const self = groups.find((g) => g.id === model.selfGroupId);
  // Your salary always comes from the salary page; the salary lever moves the groups only.
  const gross = Math.max(0, fin(ctx.ownGross));
  const ownCost = personCost(gross, ctx);
  const share = div(pool, deliveryFte);
  const override = ctx.selfBillableHoursOverride;
  const youHours = override != null && override > 0 ? override : (self?.billableHours ?? 0);
  const realCost = ownCost + share;

  const deliveryHours = sum(delivery, (g) => g.billableHours * g.count);
  const marginGroup = self ?? delivery[0];

  return {
    hours, groups, heads, deliveryFte, salaryTotal, lines, linesTotal,
    revenue, peopleCost, supportNet, pool, preBonus, bonus, ebit, tax, afterTax: ebit - tax,
    marginPct: div(ebit, revenue) * 100,
    meanUtilizationPct: div(sum(delivery, (g) => g.billablePct * g.count), deliveryFte),
    overheadPerBillableHour: div(pool, deliveryHours),
    you: {
      gross, ownCost, share, realCost,
      billableHours: youHours,
      breakEvenRate: div(realCost, youHours),
      listRate: self?.hourlyRate ?? 0,
      realizationPct: self?.realizationPct ?? 0,
    },
    kpis: {
      revenuePerFte: div(revenue, heads),
      grossMarginPerFte: marginGroup ? marginGroup.revenuePerFte - marginGroup.costPerFte : 0,
      deliverySharePct: div(deliveryFte, heads) * 100,
    },
  };
}

/** One billable hour of yours, from list price to the result before bonus and tax. */
export interface HourWaterfall {
  listRate: number;
  realizationLoss: number;
  billed: number;
  salary: number;
  onCosts: number;       // holiday pay, OTP, AGA
  support: number;       // support staff, per delivery FTE
  other: number;         // cost lines, per delivery FTE
  result: number;        // billed − all costs
}

export function hourWaterfall(r: CompanyResult): HourWaterfall {
  const H = r.you.billableHours;
  const listRate = H > 0 ? r.you.listRate : 0;
  const billed = listRate * r.you.realizationPct / 100;
  const salary = div(r.you.gross, H);
  const onCosts = div(r.you.ownCost - r.you.gross, H);
  const support = div(div(r.supportNet, r.deliveryFte), H);
  const other = div(div(r.linesTotal, r.deliveryFte), H);
  return {
    listRate, realizationLoss: listRate - billed, billed, salary, onCosts, support, other,
    result: billed - salary - onCosts - support - other,
  };
}

/**
 * The delivery groups' mean billable share at which EBIT is 0, on top of the
 * current levers. Fixed pay makes the result before bonus rise with utilization,
 * and EBIT has its sign (bonus is a share of a positive result only), so a
 * bisection over the utilization shift finds it. Null when there is no delivery
 * group or the company loses money even at 100 %.
 */
export function breakEvenUtilization(
  model: CompanyModel,
  ctx: CompanyContext,
  levers: CompanyLevers = model.levers,
): { utilizationPct: number; shiftPp: number } | null {
  const at = (shift: number) => calcCompany(model, ctx, { ...levers, utilizationPp: shift });
  if (at(0).deliveryFte <= 0) return null;
  let lo = -100;
  let hi = 100;
  if (at(hi).preBonus < 0) return null;
  if (at(lo).preBonus >= 0) return { utilizationPct: at(lo).meanUtilizationPct, shiftPp: lo };
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid).preBonus < 0) lo = mid; else hi = mid;
  }
  return { utilizationPct: at(hi).meanUtilizationPct, shiftPp: hi };
}

export interface CurvePoint {
  utilizationPct: number;
  ebit: number;          // with the current levers
  baselineEbit: number;  // with the levers at 0 (the groups as saved)
}

/**
 * EBIT against the delivery groups' mean billable share, one point per whole %
 * target in [from, to]. Each point's x is the real mean that calcCompany gives
 * at that shift (groups clamp at 0 and 100 %), so the points, the "now" dot and
 * the break-even line use one measure. The utilization lever does not change
 * other levers' effect on the mean, so "now" and the baseline share each x.
 */
export function utilizationCurve(model: CompanyModel, ctx: CompanyContext, from = 50, to = 95): CurvePoint[] {
  const base = calcCompany(model, ctx, NEUTRAL_LEVERS).meanUtilizationPct;
  const points: CurvePoint[] = [];
  for (let u = from; u <= to; u++) {
    const shift = u - base;
    const now = calcCompany(model, ctx, { ...model.levers, utilizationPp: shift });
    points.push({
      utilizationPct: now.meanUtilizationPct,
      ebit: now.ebit,
      baselineEbit: calcCompany(model, ctx, { ...NEUTRAL_LEVERS, utilizationPp: shift }).ebit,
    });
  }
  return points;
}

/**
 * "Lagre som utgangspunkt": write the levers into the groups and set them to 0.
 * The levers only ever move the groups, so the results do not change.
 */
export function applyLevers(model: CompanyModel): CompanyModel {
  return {
    ...model,
    groups: model.groups.map((g) => leveredGroup(g, model.levers)),
    levers: { ...NEUTRAL_LEVERS },
  };
}

/**
 * Your group must be a delivery group: keep `selfGroupId` when it names one,
 * else move it to the first delivery group, or null when there is none.
 */
export function ensureDeliverySelf(model: CompanyModel): CompanyModel {
  const ok = model.groups.some((g) => g.id === model.selfGroupId && g.kind === 'delivery');
  if (ok) return model;
  return { ...model, selfGroupId: model.groups.find((g) => g.kind === 'delivery')?.id ?? null };
}

/**
 * What the salary/rate/margin calculator runs on. Enkel: the simple settings,
 * unchanged (the same objects). Avansert: your share of the overhead in place of
 * the flat overhead, and your billable hours from the model. A share below 0
 * cannot be a cost here (calcEmployerCost clamps overhead at 0), so it is
 * applied as 0 and `shareClamped` says so.
 */
export function calculatorInputs(
  advanced: boolean,
  costConfig: EmployerCostConfig,
  billingConfig: BillingRateConfig,
  company: CompanyResult,
): { costConfig: EmployerCostConfig; billing: BillingRateConfig; shareClamped: boolean } {
  if (!advanced) return { costConfig, billing: billingConfig, shareClamped: false };
  const H = company.you.billableHours;
  return {
    costConfig: { ...costConfig, overheadAnnual: Math.max(0, company.you.share), overheadPct: 0 },
    billing: { ...billingConfig, workHoursPerYear: 0, billableHoursOverride: H > 0 ? H : null },
    shareClamped: company.you.share < 0,
  };
}

// ── Sanitizer ──────────────────────────────────────────────────────────────

const num = (v: unknown, fallback: number, lo = -Infinity, hi = Infinity): number => {
  const n = coerceNumber(v);
  return n === undefined ? fallback : Math.min(hi, Math.max(lo, n));
};
const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Unique non-empty ids, so edit and remove always hit one row. */
function uniqueId(v: unknown, prefix: string, i: number, seen: Set<string>): string {
  let id = typeof v === 'string' && v.trim() !== '' ? v : `${prefix}-${i + 1}`;
  while (seen.has(id)) id = `${id}-${i + 1}`;
  seen.add(id);
  return id;
}

/**
 * Repair a stored or imported company model into a valid one. A non-object
 * gives the default model; a missing part gives that part's default; every
 * number is finite and in range.
 */
export function sanitizeCompanyModel(v: unknown): CompanyModel {
  if (!isObj(v)) return structuredClone(DEFAULT_COMPANY_MODEL);
  const d = DEFAULT_COMPANY_MODEL;

  const groupIds = new Set<string>();
  const groups: CompanyGroup[] = Array.isArray(v.groups)
    ? v.groups.filter(isObj).map((g, i) => ({
      id: uniqueId(g.id, 'group', i, groupIds),
      name: str(g.name, ''),
      kind: g.kind === 'support' ? 'support' : 'delivery',
      count: num(g.count, 0, 0, 100_000),
      avgGross: num(g.avgGross, 0, 0),
      billablePct: num(g.billablePct, 0, 0, 100),
      hourlyRate: num(g.hourlyRate, 0, 0),
      realizationPct: num(g.realizationPct, 100, 0, 100),
    }))
    : structuredClone(d.groups);

  const selfGroupId = typeof v.selfGroupId === 'string' && groups.some((g) => g.id === v.selfGroupId && g.kind === 'delivery')
    ? v.selfGroupId
    : (groups.find((g) => g.kind === 'delivery')?.id ?? null);

  const h = isObj(v.hours) ? v.hours : {};
  const hours = {
    sickPct: num(h.sickPct, d.hours.sickPct, 0, 100),
    internalPct: num(h.internalPct, d.hours.internalPct, 0, 100),
    holidayDays: num(h.holidayDays, d.hours.holidayDays, 0, 366),
  };

  const costIds = new Set<string>();
  const costs: CompanyCostLine[] = Array.isArray(v.costs)
    ? v.costs.filter(isObj).map((c, i) => ({
      id: uniqueId(c.id, 'cost', i, costIds),
      label: str(c.label, ''),
      amount: num(c.amount, 0, 0),
      per: c.per === 'head' || c.per === 'pctOfSalary' ? c.per : 'company',
    }))
    : structuredClone(d.costs);

  const b = isObj(v.bonus) ? v.bonus : {};
  const l = isObj(v.levers) ? v.levers : {};
  return {
    mode: v.mode === 'advanced' ? 'advanced' : 'simple',
    groups,
    selfGroupId,
    hours,
    costs,
    bonus: {
      poolPct: num(b.poolPct, d.bonus.poolPct, 0, BONUS_POOL_MAX_PCT),
      includesHolidayPay: typeof b.includesHolidayPay === 'boolean' ? b.includesHolidayPay : d.bonus.includesHolidayPay,
    },
    levers: {
      utilizationPp: num(l.utilizationPp, 0, LEVER_RANGES.utilizationPp.min, LEVER_RANGES.utilizationPp.max),
      ratePct: num(l.ratePct, 0, LEVER_RANGES.ratePct.min, LEVER_RANGES.ratePct.max),
      salaryPct: num(l.salaryPct, 0, LEVER_RANGES.salaryPct.min, LEVER_RANGES.salaryPct.max),
      realizationPp: num(l.realizationPp, 0, LEVER_RANGES.realizationPp.min, LEVER_RANGES.realizationPp.max),
    },
  };
}
