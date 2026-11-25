import { describe, it, expect } from 'vitest';
import {
  buildModelFromAnswers, markQuickEdited, sanitizeQuick, sanitizeQuickAnswers, quickMeanSalary,
  QUICK_DEFAULTS, QUICK_KR_PER_DESK, QUICK_KR_PER_TRIP, QUICK_KR_EVENTS, type QuickAnswers,
} from './companySetup';
import {
  calcCompany, youEconomics, sanitizeCompanyModel, DEFAULT_COMPANY_MODEL, NEUTRAL_LEVERS,
  type CompanyContext, type CompanyModel,
} from './companyCost';
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
const base = (): CompanyModel => structuredClone(DEFAULT_COMPANY_MODEL);
const answers = (patch: Partial<QuickAnswers> = {}): QuickAnswers => ({ ...QUICK_DEFAULTS, ...patch });

describe('buildModelFromAnswers', () => {
  it('an average consultant at the average salary and rate gets fair salary = average salary', () => {
    const a = answers({ rateYou: QUICK_DEFAULTS.rateAverage, ownBillablePct: QUICK_DEFAULTS.typicalBillablePct });
    const m = buildModelFromAnswers(a, base());
    const c = { ...ctx, ownGross: quickMeanSalary(a) };
    const y = youEconomics(m, c, calcCompany(m, c));
    expect(y.fairGross).not.toBeNull();
    expect(Math.abs(y.fairGross! - quickMeanSalary(a))).toBeLessThan(1_000);
  });

  it('the bench is a support group at 0 % billable and the consultants\' salary', () => {
    const m = buildModelFromAnswers(answers({ onBench: 3 }), base());
    const bench = m.groups.find((g) => g.id === 'benk')!;
    expect(bench).toMatchObject({ kind: 'support', count: 3, billablePct: 0, avgGross: quickMeanSalary(QUICK_DEFAULTS) });
  });

  it('non-billing staff is a support group that bills nothing', () => {
    const m = buildModelFromAnswers(answers({ nonBilling: 7 }), base());
    expect(m.groups.find((g) => g.id === 'led')).toMatchObject({ kind: 'support', count: 7, billablePct: 0 });
  });

  it('the head count sums to the FTE answer', () => {
    for (const a of [answers(), answers({ totalFte: 12.5, nonBilling: 2, onBench: 0.5 }), answers({ totalFte: 3, nonBilling: 3, onBench: 0 })]) {
      const m = buildModelFromAnswers(a, base());
      expect(calcCompany(m, ctx).heads).toBeCloseTo(a.totalFte, 9);
      expect(m.groups.find((g) => g.kind === 'delivery')!.count).toBeCloseTo(a.totalFte - a.nonBilling - a.onBench, 9);
    }
  });

  it('the built model passes sanitizeCompanyModel unchanged', () => {
    const m = buildModelFromAnswers(answers({ officeMode: 'rent', annualRent: 2_000_000 }), base(), { uncertain: ['salary'], dontKnow: ['realizationPct'] });
    expect(sanitizeCompanyModel(m)).toEqual(m);
    expect(sanitizeCompanyModel(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });

  it('calcCompany on the built model equals the same groups entered by hand', () => {
    const m = buildModelFromAnswers(answers(), base());
    const byHand: CompanyModel = { ...base(), groups: m.groups, costs: m.costs, bonus: m.bonus, selfGroupId: 'kons' };
    expect(calcCompany(m, ctx).ebit).toBeCloseTo(calcCompany(byHand, ctx).ebit, 6);
  });

  it('salary mean is the midpoint; rates, shares and realization go to the delivery group and to you', () => {
    const a = answers({ salaryLow: 700_000, salaryHigh: 1_000_000, rateAverage: 1300, rateYou: 1600, ownBillablePct: 90, typicalBillablePct: 80, realizationPct: 92 });
    const m = buildModelFromAnswers(a, base());
    expect(m.groups[0]).toMatchObject({ kind: 'delivery', avgGross: 850_000, hourlyRate: 1300, billablePct: 80, realizationPct: 92 });
    expect(m.self).toEqual({ billablePct: 90, hourlyRate: 1600 });
    expect(m.selfGroupId).toBe('kons');
  });

  it('office is desks × the desk price or the yearly rent; trips make a per-head line', () => {
    const desks = buildModelFromAnswers(answers({ desks: 40, tripsPerYear: 3 }), base());
    expect(desks.costs.find((c) => c.id === 'office')).toMatchObject({ amount: 40 * QUICK_KR_PER_DESK, per: 'company' });
    expect(desks.costs.find((c) => c.id === 'social')).toMatchObject({ amount: 3 * QUICK_KR_PER_TRIP + QUICK_KR_EVENTS, per: 'head' });
    const rent = buildModelFromAnswers(answers({ officeMode: 'rent', annualRent: 2_500_000 }), base());
    expect(rent.costs.find((c) => c.id === 'office')?.amount).toBe(2_500_000);
  });

  it('keeps hours, mode and target margin; sets the bonus pool and levers to 0', () => {
    const b = { ...base(), mode: 'advanced' as const, hours: { sickPct: 6, internalPct: 3, holidayDays: 30 }, targetMarginPct: 12, levers: { ...NEUTRAL_LEVERS, ratePct: 5 } };
    const m = buildModelFromAnswers(answers({ bonusPct: 20 }), b);
    expect(m.hours).toEqual(b.hours);
    expect(m.mode).toBe('advanced');
    expect(m.targetMarginPct).toBe(12);
    expect(m.bonus).toEqual({ poolPct: 20, includesHolidayPay: true });
    expect(m.levers).toEqual(NEUTRAL_LEVERS);
  });

  it('stores the answers and the flags, with edited false', () => {
    const m = buildModelFromAnswers(answers(), { ...base(), quick: { answers: answers(), uncertain: [], dontKnow: [], edited: true } }, { uncertain: ['office'], dontKnow: ['salary'] });
    expect(m.quick).toEqual({ answers: answers(), uncertain: ['office'], dontKnow: ['salary'], edited: false });
  });

  it('stays finite for zero and broken answers', () => {
    const m = buildModelFromAnswers({ ...answers(), totalFte: 0, salaryLow: NaN, rateAverage: -5 }, base());
    const r = calcCompany(m, ctx);
    expect(Number.isFinite(r.ebit) && Number.isFinite(r.you.realCost)).toBe(true);
    expect(m.groups.every((g) => g.count >= 0)).toBe(true);
  });
});

describe('quick sanitizer', () => {
  it('coerces numbers, clamps ranges and keeps known keys only', () => {
    const a = sanitizeQuickAnswers({ totalFte: '20', nonBilling: 30, onBench: 5, ownBillablePct: 140, bonusPct: 90, officeMode: 'x', extra: 1, salaryLow: 900_000, salaryHigh: 800_000 });
    expect(a.totalFte).toBe(20);
    expect(a.nonBilling).toBe(20);
    expect(a.onBench).toBe(0);
    expect(a.ownBillablePct).toBe(100);
    expect(a.bonusPct).toBe(50);
    expect(a.officeMode).toBe('desks');
    expect(a.salaryHigh).toBe(900_000);
    expect(Object.keys(a).sort()).toEqual(Object.keys(QUICK_DEFAULTS).sort());
  });

  it('repairs flags: known keys, a key is never both unsure and unknown, edited is boolean', () => {
    expect(sanitizeQuick({ answers: {}, uncertain: ['salary', 'nope', 'office'], dontKnow: ['office', 7], edited: 'yes' }))
      .toEqual({ answers: QUICK_DEFAULTS, uncertain: ['salary'], dontKnow: ['office'], edited: false });
    expect(sanitizeQuick(null)).toBeUndefined();
    expect(sanitizeQuick([])).toBeUndefined();
  });

  it('the company sanitizer keeps a quick setup and drops a broken one', () => {
    expect(sanitizeCompanyModel({ ...base(), quick: 'x' }).quick).toBeUndefined();
    expect(sanitizeCompanyModel({ ...base(), quick: { answers: { totalFte: 9 } } }).quick?.answers.totalFte).toBe(9);
    expect(sanitizeCompanyModel(base())).toEqual(base());
  });

  it('markQuickEdited sets edited, and leaves a model without quick alone', () => {
    const m = buildModelFromAnswers(answers(), base());
    expect(markQuickEdited(m).quick?.edited).toBe(true);
    const plain = base();
    expect(markQuickEdited(plain)).toBe(plain);
  });
});
