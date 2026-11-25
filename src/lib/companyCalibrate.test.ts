import { describe, it, expect } from 'vitest';
import { calibrateToAccounts, withMeanSalary, CALIBRATE_BOUNDS } from './companyCalibrate';
import { buildModelFromAnswers, markQuickEdited, quickMeanSalary, QUICK_DEFAULTS, type QuickAnswers, type QuickGuessKey } from './companySetup';
import { calcCompany, sanitizeCompanyModel, DEFAULT_COMPANY_MODEL, NEUTRAL_LEVERS, type CompanyContext, type CompanyModel } from './companyCost';
import { DEFAULT_EMPLOYER_COST_CONFIG } from './employerCost';

const ctx: CompanyContext = {
  year: 2026,
  hoursPerDay: 7.5,
  ownGross: 950_000,
  otpPct: 5,
  costConfig: DEFAULT_EMPLOYER_COST_CONFIG,
  holidayPayInSalary: true,
  otpCap: true,
};
const model = (patch: Partial<QuickAnswers> = {}, uncertain: QuickGuessKey[] = [], dontKnow: QuickGuessKey[] = []): CompanyModel =>
  buildModelFromAnswers({ ...QUICK_DEFAULTS, ...patch }, structuredClone(DEFAULT_COMPANY_MODEL), { uncertain, dontKnow });
const numbers = (m: CompanyModel) => {
  const r = calcCompany(m, ctx, NEUTRAL_LEVERS);
  return { revenue: r.revenue, operatingResult: r.ebit };
};

describe('calibrateToAccounts', () => {
  it('round trip: perturbed guesses fit back to the accounts of the true model', () => {
    const truth = model({ typicalBillablePct: 82, salaryLow: 850_000, salaryHigh: 1_130_000 });
    const accounts = numbers(truth);
    const guessed = model({ typicalBillablePct: 90, salaryLow: 750_000, salaryHigh: 1_030_000 }, ['salary'], ['typicalBillablePct']);
    const out = calibrateToAccounts(guessed, ctx, accounts);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.model.quick!.answers.typicalBillablePct).toBeCloseTo(82, 0);
    expect(Math.abs(quickMeanSalary(out.model.quick!.answers) - 990_000)).toBeLessThan(2_000);
    // The spread is kept.
    expect(out.model.quick!.answers.salaryHigh - out.model.quick!.answers.salaryLow).toBeCloseTo(280_000, 0);
    // The model meets the accounts within rounding (0.1 pp share, 1 000 kr salary).
    const fit = numbers(out.model);
    expect(Math.abs(fit.revenue / accounts.revenue - 1)).toBeLessThan(0.002);
    expect(Math.abs(fit.operatingResult - accounts.operatingResult)).toBeLessThan(0.01 * accounts.revenue);
    expect(out.fit).toEqual({ revenue: fit.revenue, ebit: fit.operatingResult });
    expect(out.moved.map((m) => m.key)).toEqual(['typicalBillablePct', 'salary']);
    expect(out.moved[0]).toMatchObject({ from: 90 });
    expect(out.moved[1]).toMatchObject({ from: 890_000 });
    expect(out.matched).toEqual({ revenue: true, operatingResult: true });
    // A fitted "vet ikke" answer becomes "usikker"; the rest is a valid stored model.
    expect(out.model.quick).toMatchObject({ uncertain: expect.arrayContaining(['salary', 'typicalBillablePct']), dontKnow: [], edited: false });
    expect(sanitizeCompanyModel(out.model)).toEqual(out.model);
  });

  it('moves only the answers marked as a guess', () => {
    const truth = model({ typicalBillablePct: 80 });
    const guessed = model({ typicalBillablePct: 88, salaryLow: 700_000 }, ['typicalBillablePct']);
    const out = calibrateToAccounts(guessed, ctx, numbers(truth));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.moved.map((m) => m.key)).toEqual(['typicalBillablePct']);
    expect(out.model.quick!.answers.salaryLow).toBe(700_000);
    expect(out.matched).toEqual({ revenue: true, operatingResult: false });
    for (const k of ['rateAverage', 'realizationPct', 'totalFte', 'bonusPct'] as const) {
      expect(out.model.quick!.answers[k]).toBe(guessed.quick!.answers[k]);
    }
  });

  it('takes the resale share off the accounts\' revenue first', () => {
    const truth = model({ typicalBillablePct: 80 });
    const { revenue, operatingResult } = numbers(truth);
    const guessed = model({ typicalBillablePct: 88, resaleSharePct: 20 }, ['typicalBillablePct']);
    const out = calibrateToAccounts(guessed, ctx, { revenue: revenue / 0.8, operatingResult });
    expect(out.ok && out.model.quick!.answers.typicalBillablePct).toBeCloseTo(80, 0);
    expect(out.ok && out.target.revenue).toBeCloseTo(revenue, 0);
  });

  it('keeps the levers and the names the model has', () => {
    const m = model({}, ['salary']);
    const named = { ...m, levers: { ...NEUTRAL_LEVERS, ratePct: 5 }, groups: m.groups.map((g) => ({ ...g, name: `${g.name} (en)` })) };
    const out = calibrateToAccounts(named, ctx, numbers(m));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.model.levers.ratePct).toBe(5);
    expect(out.model.groups.map((g) => g.name)).toEqual(named.groups.map((g) => g.name));
  });

  it('no solution: a target outside the bounds moves nothing', () => {
    const guessed = model({}, ['salary', 'typicalBillablePct']);
    const { revenue } = numbers(guessed);
    const far = calibrateToAccounts(guessed, ctx, { revenue: revenue * 5, operatingResult: 0 });
    expect(far).toEqual({ ok: false, reason: 'noSolution', key: 'typicalBillablePct' });
    const loss = calibrateToAccounts(guessed, ctx, { revenue, operatingResult: revenue * 2 });
    expect(loss).toEqual({ ok: false, reason: 'noSolution', key: 'salary' });
  });

  it('nothing to move: no guesses, or guesses the fit does not use', () => {
    expect(calibrateToAccounts(model(), ctx, { revenue: 1, operatingResult: 1 })).toEqual({ ok: false, reason: 'nothingToMove' });
    expect(calibrateToAccounts(model({}, ['rateAverage'], ['office']), ctx, { revenue: 1, operatingResult: 1 }))
      .toEqual({ ok: false, reason: 'nothingToMove' });
  });

  it('refuses without a quick setup, after a hand edit, and for accounts in another currency', () => {
    const plain = structuredClone(DEFAULT_COMPANY_MODEL);
    expect(calibrateToAccounts(plain, ctx, { revenue: 1, operatingResult: 1 })).toEqual({ ok: false, reason: 'noQuickSetup' });
    expect(calibrateToAccounts(markQuickEdited(model({}, ['salary'])), ctx, { revenue: 1, operatingResult: 1 }))
      .toEqual({ ok: false, reason: 'handEdited' });
    expect(calibrateToAccounts(model({}, ['salary']), ctx, { revenue: 1, operatingResult: 1, currency: 'USD' }))
      .toEqual({ ok: false, reason: 'currency' });
  });

  it('withMeanSalary keeps the spread and never goes below 0', () => {
    expect(withMeanSalary({ ...QUICK_DEFAULTS, salaryLow: 800_000, salaryHigh: 1_000_000 }, 1_200_000))
      .toMatchObject({ salaryLow: 1_100_000, salaryHigh: 1_300_000 });
    expect(withMeanSalary({ ...QUICK_DEFAULTS, salaryLow: 0, salaryHigh: 1_000_000 }, CALIBRATE_BOUNDS.salary.min))
      .toMatchObject({ salaryLow: 0, salaryHigh: 1_000_000 });
  });
});
