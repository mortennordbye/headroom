/**
 * Quick-setup answers read back from a company model that was not built by the
 * quick setup (hand-made groups, the example model, or chat). The form then
 * shows the model the page uses, not industry defaults, and its "Gir" lines
 * describe that model.
 *
 * - FTE: all groups plus parental leave; non-billing = support groups that are
 *   not the bench; bench = bench groups.
 * - Rates, billable share and realization: FTE-weighted over delivery groups.
 * - Salary: low = high = the delivery groups' mean salary. The model holds no
 *   real spread, and a range made up to fit other numbers would look like one.
 * - Office: a per-company office line gives "rent"; trips come back from the
 *   social per-head line. Without them, the industry defaults stay.
 */

import { isBenchGroup, isOfficeLine, type CompanyGroup, type CompanyModel } from './companyCost';
import { QUICK_DEFAULTS, QUICK_KR_EVENTS, QUICK_KR_PER_TRIP, type QuickAnswers } from './companySetup';

const fin = (v: number) => (Number.isFinite(v) ? v : 0);
const sumBy = (gs: CompanyGroup[], f: (g: CompanyGroup) => number) => gs.reduce((s, g) => s + fin(f(g)), 0);
/** FTE-weighted mean, or the fallback when the groups have no FTE. */
const weighted = (gs: CompanyGroup[], f: (g: CompanyGroup) => number, fallback: number) => {
  const n = sumBy(gs, (g) => Math.max(0, g.count));
  return n > 0 ? sumBy(gs, (g) => Math.max(0, g.count) * f(g)) / n : fallback;
};
const round = (v: number, step = 1) => Math.round(v / step) * step;

export function answersFromModel(model: CompanyModel): QuickAnswers {
  const d = QUICK_DEFAULTS;
  const delivery = model.groups.filter((g) => g.kind === 'delivery');
  const bench = model.groups.filter((g) => g.kind === 'support' && isBenchGroup(g));
  const nonBilling = model.groups.filter((g) => g.kind === 'support' && !isBenchGroup(g));
  const self = delivery.find((g) => g.id === model.selfGroupId) ?? delivery[0];
  const leave = Math.max(0, fin(model.leave?.count ?? 0));

  const mean = round(weighted(delivery, (g) => g.avgGross, (d.salaryLow + d.salaryHigh) / 2), 1000);

  const office = model.costs.find((l) => l.per === 'company' && isOfficeLine(l));
  const social = model.costs.find((l) => l.id === 'social' && l.per === 'head');
  const trips = social ? Math.max(0, round((fin(social.amount) - QUICK_KR_EVENTS) / QUICK_KR_PER_TRIP)) : d.tripsPerYear;

  return {
    totalFte: sumBy(model.groups, (g) => Math.max(0, g.count)) + leave,
    nonBilling: sumBy(nonBilling, (g) => Math.max(0, g.count)),
    onBench: sumBy(bench, (g) => Math.max(0, g.count)),
    ...(model.leave ? { onLeave: leave, leaveFullPay: model.leave.fullPay } : {}),
    salaryLow: mean,
    salaryHigh: mean,
    rateAverage: round(weighted(delivery, (g) => g.hourlyRate, d.rateAverage)),
    rateYou: round(model.self?.hourlyRate ?? self?.hourlyRate ?? d.rateYou),
    ownBillablePct: round(model.self?.billablePct ?? self?.billablePct ?? d.ownBillablePct, 0.1),
    typicalBillablePct: round(weighted(delivery, (g) => g.billablePct, d.typicalBillablePct), 0.1),
    realizationPct: round(weighted(delivery, (g) => g.realizationPct, d.realizationPct), 0.1),
    bonusPct: model.bonus.poolPct,
    officeMode: office ? 'rent' : d.officeMode,
    annualRent: office ? fin(office.amount) : d.annualRent,
    tripsPerYear: Math.min(52, trips),
  };
}
