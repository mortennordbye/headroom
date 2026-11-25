/**
 * "Tilpass modellen" on the accounts card: move the quick setup's guesses so
 * the model gives the revenue and operating result in the public accounts.
 *
 * Only answers marked as a guess ("usikker" or "vet ikke") move, and only two:
 * - the typical billable share, so the model's revenue equals the accounts'
 *   revenue less resold subcontractors (quick answer resaleSharePct);
 * - the consultants' mean salary (low and high move together), so the model's
 *   EBIT equals the operating result.
 * Revenue does not depend on salary, so one pass in that order fits both.
 * Each fit is a bisection inside fixed bounds on the same calcCompany as the
 * page (levers at 0). A target outside the bounds has no solution, and
 * nothing moves.
 *
 * Two unknowns fitted to two numbers always match when there is a solution, so
 * the result is an estimate from the accounts, not a proof of the guesses.
 */

import { calcCompany, NEUTRAL_LEVERS, type CompanyContext, type CompanyModel } from './companyCost';
import { buildModelFromAnswers, quickMeanSalary, type QuickAnswers, type QuickGuessKey } from './companySetup';
import { consultingRevenue, type CompanyAccounts } from './companyAccounts';

/** The answers the fit may move. */
export type CalibrateKey = Extract<QuickGuessKey, 'typicalBillablePct' | 'salary'>;

/** Search bounds: typical billable share (%), consultants' mean salary (kr per year). */
export const CALIBRATE_BOUNDS: Record<CalibrateKey, { min: number; max: number }> = {
  typicalBillablePct: { min: 20, max: 100 },
  salary: { min: 300_000, max: 3_000_000 },
};

export interface CalibrateMove {
  key: CalibrateKey;
  /** Typical billable share in %, or the mean salary in kr. */
  from: number;
  to: number;
}

export type CalibrateFailure = 'noQuickSetup' | 'handEdited' | 'currency' | 'nothingToMove' | 'noSolution';

export type CalibrateResult =
  | {
    ok: true;
    model: CompanyModel;
    moved: CalibrateMove[];
    /** The targets: revenue after resale, and the operating result. */
    target: { revenue: number; operatingResult: number };
    /** The calibrated model's revenue and EBIT (levers at 0). */
    fit: { revenue: number; ebit: number };
    /** Which target a moved answer was fitted to. */
    matched: { revenue: boolean; operatingResult: boolean };
  }
  | { ok: false; reason: CalibrateFailure; key?: CalibrateKey };

/** A root of f in [lo, hi] by bisection, or null when f has the same sign at both ends. */
function bisect(f: (x: number) => number, lo: number, hi: number, iterations = 60): number | null {
  let a = lo;
  let fa = f(lo);
  const fb = f(hi);
  if (!Number.isFinite(fa) || !Number.isFinite(fb)) return null;
  if (fa === 0) return lo;
  if (fb === 0) return hi;
  if ((fa < 0) === (fb < 0)) return null;
  let b = hi;
  for (let i = 0; i < iterations; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if ((fm < 0) === (fa < 0)) { a = m; fa = fm; } else b = m;
  }
  return (a + b) / 2;
}

/**
 * The answers with the consultants' mean salary set to `mean`. The low–high
 * spread is kept, but its half is never more than the mean, so low is never
 * below 0 and the mean is always `mean` (the fit stays monotone).
 */
export function withMeanSalary(a: QuickAnswers, mean: number): QuickAnswers {
  const m = Math.max(0, mean);
  const half = Math.min(Math.max(0, a.salaryHigh - a.salaryLow) / 2, m);
  return { ...a, salaryLow: m - half, salaryHigh: m + half };
}

/**
 * Why the fit cannot run before it starts (no quick setup, hand edits, another
 * currency, no guess it may move), or null when it can. "No solution" is only
 * known after the search.
 */
export function calibrateBlocker(model: CompanyModel, accounts: { currency?: string }): Exclude<CalibrateFailure, 'noSolution'> | null {
  const q = model.quick;
  if (!q) return 'noQuickSetup';
  if (q.edited) return 'handEdited';
  if (accounts.currency != null && accounts.currency !== 'NOK') return 'currency';
  const guess = new Set<QuickGuessKey>([...q.uncertain, ...q.dontKnow]);
  return guess.has('typicalBillablePct') || guess.has('salary') ? null : 'nothingToMove';
}

export function calibrateToAccounts(
  model: CompanyModel,
  ctx: CompanyContext,
  accounts: Pick<CompanyAccounts, 'revenue' | 'operatingResult'> & { currency?: string },
): CalibrateResult {
  const blocked = calibrateBlocker(model, accounts);
  const q = model.quick;
  if (blocked || !q) return { ok: false, reason: blocked ?? 'noQuickSetup' };
  const guess = new Set<QuickGuessKey>([...q.uncertain, ...q.dontKnow]);
  const moveBillable = guess.has('typicalBillablePct');
  const moveSalary = guess.has('salary');

  const moving: CalibrateKey[] = [...(moveBillable ? ['typicalBillablePct' as const] : []), ...(moveSalary ? ['salary' as const] : [])];
  // A fitted answer is no longer the industry value: it stays a guess ("usikker"), so it can be fitted again.
  const dontKnow = q.dontKnow.filter((k) => !moving.includes(k as CalibrateKey));
  const uncertain = [...new Set([...q.uncertain, ...moving])];
  const build = (a: QuickAnswers): CompanyModel => {
    const built = buildModelFromAnswers(a, model, { uncertain, dontKnow });
    // Keep the names the model has (they may be in another language); the ids are the builder's.
    const name = new Map(model.groups.map((g) => [g.id, g.name]));
    const label = new Map(model.costs.map((c) => [c.id, c.label]));
    return {
      ...built,
      levers: model.levers,
      groups: built.groups.map((g) => ({ ...g, name: name.get(g.id) ?? g.name })),
      costs: built.costs.map((c) => ({ ...c, label: label.get(c.id) ?? c.label })),
    };
  };
  const run = (a: QuickAnswers) => calcCompany(build(a), ctx, NEUTRAL_LEVERS);

  const target = {
    revenue: consultingRevenue(accounts, q.answers.resaleSharePct ?? 0),
    operatingResult: accounts.operatingResult,
  };
  let a: QuickAnswers = { ...q.answers };
  const moved: CalibrateMove[] = [];

  if (moveBillable) {
    const { min, max } = CALIBRATE_BOUNDS.typicalBillablePct;
    const x = bisect((b) => run({ ...a, typicalBillablePct: b }).revenue - target.revenue, min, max);
    if (x == null) return { ok: false, reason: 'noSolution', key: 'typicalBillablePct' };
    const to = Math.round(x * 10) / 10;
    moved.push({ key: 'typicalBillablePct', from: a.typicalBillablePct, to });
    a = { ...a, typicalBillablePct: to };
  }
  if (moveSalary) {
    const { min, max } = CALIBRATE_BOUNDS.salary;
    const x = bisect((m) => run(withMeanSalary(a, m)).ebit - target.operatingResult, min, max);
    if (x == null) return { ok: false, reason: 'noSolution', key: 'salary' };
    const from = quickMeanSalary(a);
    a = withMeanSalary(a, Math.round(x / 1000) * 1000);
    moved.push({ key: 'salary', from, to: quickMeanSalary(a) });
  }

  const next = build(a);
  const r = calcCompany(next, ctx, NEUTRAL_LEVERS);
  return {
    ok: true,
    model: next,
    moved,
    target,
    fit: { revenue: r.revenue, ebit: r.ebit },
    matched: { revenue: moveBillable, operatingResult: moveSalary },
  };
}
