import { describe, it, expect } from 'vitest';
import { answersFromModel } from './companyQuickFromModel';
import { buildModelFromAnswers, QUICK_DEFAULTS, type QuickAnswers } from './companySetup';
import { DEFAULT_COMPANY_MODEL, type CompanyModel } from './companyCost';

const base = (): CompanyModel => structuredClone(DEFAULT_COMPANY_MODEL);

describe('answersFromModel', () => {
  it('counts FTE, non-billing and bench from the groups, and adds leave', () => {
    const m = base();
    m.groups.push({ id: 'b', name: 'Benk', kind: 'support', count: 3, avgGross: 820_000, billablePct: 0, hourlyRate: 0, realizationPct: 93 });
    m.leave = { count: 2, fullPay: false };
    const a = answersFromModel(m);
    expect(a.totalFte).toBe(50 + 3 + 2);
    expect(a.nonBilling).toBe(6);
    expect(a.onBench).toBe(3);
    expect(a.onLeave).toBe(2);
    expect(a.leaveFullPay).toBe(false);
  });

  it('the salary is one number: the delivery groups\' mean, to the nearest 1 000', () => {
    const a = answersFromModel(base()); // 38 × 820 000 + 6 × 950 000
    expect(a.salaryLow).toBe(838_000);
    expect(a.salaryHigh).toBe(838_000);
  });

  it('rates, shares and realization are FTE-weighted over delivery; yours come from your group or self', () => {
    const m = base();
    const a = answersFromModel(m);
    expect(a.rateAverage).toBe(Math.round((38 * 1300 + 6 * 1450) / 44));
    expect(a.typicalBillablePct).toBeCloseTo((38 * 84 + 6 * 60) / 44, 1);
    expect(a.ownBillablePct).toBe(84);
    expect(a.rateYou).toBe(1300);
    expect(answersFromModel({ ...m, self: { billablePct: 70, hourlyRate: 1500 } })).toMatchObject({ ownBillablePct: 70, rateYou: 1500 });
  });

  it('office and trips come back from the cost lines; the bonus pool is kept', () => {
    const a = answersFromModel(base());
    expect(a.officeMode).toBe('rent');
    expect(a.annualRent).toBe(3_200_000);
    expect(a.tripsPerYear).toBe(1); // (20 000 − 5 000) / 15 000
    expect(a.bonusPct).toBe(15);
  });

  it('a model built from answers reads back the same counts and salaries', () => {
    const answers: QuickAnswers = { ...QUICK_DEFAULTS, totalFte: 52, nonBilling: 4, onBench: 3, salaryLow: 900_000, salaryHigh: 1_300_000 };
    const a = answersFromModel(buildModelFromAnswers(answers, base()));
    expect(a).toMatchObject({ totalFte: 52, nonBilling: 4, onBench: 3, salaryLow: 1_100_000, salaryHigh: 1_100_000 });
  });

  it('stays finite with no groups', () => {
    const a = answersFromModel({ ...base(), groups: [], costs: [] });
    expect(Object.values(a).filter((v) => typeof v === 'number').every(Number.isFinite)).toBe(true);
    expect(a.totalFte).toBe(0);
  });
});
