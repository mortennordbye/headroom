import { describe, it, expect } from 'vitest';
import { accountsStatus, calibrateToAccounts, fitModelToAccounts, withMeanSalary, CALIBRATE_BOUNDS } from './companyCalibrate';
import type { CompanyAccounts } from './companyAccounts';
import { buildModelFromAnswers, clearAccountsFit, markQuickEdited, quickMeanSalary, QUICK_DEFAULTS, type QuickAnswers, type QuickGuessKey } from './companySetup';
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
  });

  it('withMeanSalary with a wide spread and a low target: low is 0 and the mean is the target', () => {
    const wide = { ...QUICK_DEFAULTS, salaryLow: 0, salaryHigh: 1_000_000 };
    const out = withMeanSalary(wide, CALIBRATE_BOUNDS.salary.min);
    expect(out).toMatchObject({ salaryLow: 0, salaryHigh: 600_000 });
    expect(quickMeanSalary(out)).toBe(CALIBRATE_BOUNDS.salary.min);
    // Monotone: a higher target never gives a lower mean.
    let prev = -1;
    for (let m = 0; m <= 1_200_000; m += 50_000) {
      const mean = quickMeanSalary(withMeanSalary(wide, m));
      expect(mean).toBe(m);
      expect(mean).toBeGreaterThan(prev);
      prev = mean;
    }
  });
});

describe('fitModelToAccounts', () => {
  // Made-up public accounts of a made-up company.
  const accountsOf = (m: CompanyModel, patch: Partial<CompanyAccounts> = {}): CompanyAccounts => ({
    orgnr: '999900003', name: 'Eksempel Konsulent AS', year: 2025, type: 'SELSKAP', currency: 'NOK',
    ...numbers(m), employees: 52, formCode: 'AS', naceCode: '62.020', hasParent: false, inGroup: false,
    fetchedAt: '2026-11-01T10:00:00.000Z', ...patch,
  });
  const NOW = '2026-11-25T12:00:00.000Z';
  const truth = model({ typicalBillablePct: 80, salaryLow: 850_000, salaryHigh: 1_150_000 });

  it('round trip: marks salary and the typical share as guesses, fits them and marks the accounts as fitted', () => {
    const acc = accountsOf(truth);
    const start = { ...model({ typicalBillablePct: 90, salaryLow: 700_000, salaryHigh: 1_000_000 }), accounts: acc };
    expect(accountsStatus(start, ctx)).toEqual({ match: 'mismatch', basis: 'guesses', fittedAt: null });
    const out = fitModelToAccounts(start, ctx, acc, { now: NOW });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.model.quick!.uncertain).toEqual(expect.arrayContaining(['salary', 'typicalBillablePct']));
    expect(out.model.quick!.answers.typicalBillablePct).toBeCloseTo(80, 0);
    expect(Math.abs(quickMeanSalary(out.model.quick!.answers) - 1_000_000)).toBeLessThan(2_000);
    expect(out.model.accounts).toEqual({ ...acc, fittedAt: NOW, fitMoves: out.moved });
    expect(out.moved.map((m) => m.key)).toEqual(['typicalBillablePct', 'salary']);
    expect(accountsStatus(out.model, ctx)).toEqual({ match: 'match', basis: 'accounts', fittedAt: NOW });
    expect(sanitizeCompanyModel(out.model)).toEqual(out.model);
  });

  it('keeps a "vet ikke" answer as it is before the fit', () => {
    const start = model({ typicalBillablePct: 90 }, ['rateAverage'], ['salary']);
    const out = fitModelToAccounts(start, ctx, accountsOf(truth), { now: NOW });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // calibrateToAccounts makes the fitted answers "usikker"; the other guesses stay.
    expect(out.model.quick!.uncertain).toEqual(expect.arrayContaining(['rateAverage', 'salary', 'typicalBillablePct']));
    expect(out.moved.map((m) => m.key)).toEqual(['typicalBillablePct', 'salary']);
  });

  it('returns a failure and no model when it cannot fit', () => {
    const start = model();
    expect(fitModelToAccounts({ ...start, quick: undefined }, ctx, accountsOf(truth))).toEqual({ ok: false, reason: 'noQuickSetup' });
    expect(fitModelToAccounts(start, ctx, accountsOf(truth, { currency: 'SEK' }))).toEqual({ ok: false, reason: 'currency' });
    const far = accountsOf(truth);
    expect(fitModelToAccounts(start, ctx, { ...far, revenue: far.revenue * 10 })).toMatchObject({ ok: false, reason: 'noSolution' });
  });

  it('refuses after a hand edit unless asked to replace it, then builds from the answers again', () => {
    const edited = markQuickEdited({ ...model({ typicalBillablePct: 90 }), groups: model().groups.map((g) => ({ ...g, count: g.count + 1 })) });
    expect(fitModelToAccounts(edited, ctx, accountsOf(truth))).toEqual({ ok: false, reason: 'handEdited' });
    const out = fitModelToAccounts(edited, ctx, accountsOf(truth), { replaceHandEdits: true, now: NOW });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.model.quick!.edited).toBe(false);
    expect(out.model.groups.map((g) => g.count)).toEqual(truth.groups.map((g) => g.count));
    expect(accountsStatus(out.model, ctx).basis).toBe('accounts');
  });

  it('drops the fit marker when the answers or the groups change after', () => {
    const out = fitModelToAccounts(model({ typicalBillablePct: 90 }), ctx, accountsOf(truth), { now: NOW });
    if (!out.ok) throw new Error('fit failed');
    expect(out.model.accounts?.fittedAt).toBe(NOW);
    // A hand edit of groups or costs.
    const handEdit = markQuickEdited({ ...out.model, groups: out.model.groups.map((g) => ({ ...g, count: g.count + 1 })) });
    expect(handEdit.accounts?.fittedAt).toBeUndefined();
    expect(handEdit.accounts?.fitMoves).toBeUndefined();
    expect(handEdit.accounts?.orgnr).toBe('999900003');
    // New quick answers.
    const rebuilt = buildModelFromAnswers({ ...out.model.quick!.answers, totalFte: 60 }, out.model);
    expect(rebuilt.accounts?.fittedAt).toBeUndefined();
    expect(accountsStatus(rebuilt, ctx).basis).toBe('guesses');
  });

  it('says guesses when the model was fitted but no longer matches', () => {
    const out = fitModelToAccounts(model({ typicalBillablePct: 90 }), ctx, accountsOf(truth), { now: NOW });
    if (!out.ok) throw new Error('fit failed');
    const moved = { ...out.model, hours: { ...out.model.hours, internalPct: 30 } };
    expect(accountsStatus(moved, ctx)).toEqual({ match: 'mismatch', basis: 'guesses', fittedAt: NOW });
  });

  it('an hours edit clears the fit (clearAccountsFit) without marking a hand edit', () => {
    const out = fitModelToAccounts(model({ typicalBillablePct: 90 }), ctx, accountsOf(truth), { now: NOW });
    if (!out.ok) throw new Error('fit failed');
    const hoursEdit = clearAccountsFit({ ...out.model, hours: { ...out.model.hours, holidayDays: 30 } });
    expect(hoursEdit.accounts?.fittedAt).toBeUndefined();
    expect(hoursEdit.accounts?.fitMoves).toBeUndefined();
    expect(hoursEdit.quick?.edited).toBe(false);
    expect(accountsStatus(hoursEdit, ctx)).toMatchObject({ basis: 'guesses', fittedAt: null });
    // No fit: the same object back.
    expect(clearAccountsFit(hoursEdit)).toBe(hoursEdit);
  });
});
