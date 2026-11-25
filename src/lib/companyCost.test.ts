import { describe, it, expect } from 'vitest';
import {
  calcCompany, companyHours, hourWaterfall, breakEvenUtilization, utilizationCurve, applyLevers,
  sanitizeCompanyModel, DEFAULT_COMPANY_MODEL, NEUTRAL_LEVERS,
  type CompanyModel, type CompanyContext, type CompanyResult,
} from './companyCost';
import {
  calcEmployerCost, calcBillingRate, calcBillableHours, DEFAULT_EMPLOYER_COST_CONFIG, DEFAULT_BILLING_CONFIG,
} from './employerCost';
import { weekdaysInYear, weekdayHolidays, corporateTaxPct } from './norwegianCalendar';

const ctx: CompanyContext = {
  year: 2026,
  hoursPerDay: 7.5,
  ownGross: 768_000,
  otpPct: 5,
  costConfig: DEFAULT_EMPLOYER_COST_CONFIG,
  holidayPayInSalary: true,
  otpCap: true,
};

const model = (patch: Partial<CompanyModel> = {}): CompanyModel => ({ ...structuredClone(DEFAULT_COMPANY_MODEL), ...patch });

/** Every number in a result, recursively. */
function numbers(v: unknown): number[] {
  if (typeof v === 'number') return [v];
  if (Array.isArray(v)) return v.flatMap(numbers);
  if (v && typeof v === 'object') return Object.values(v).flatMap(numbers);
  return [];
}
const allFinite = (r: CompanyResult) => numbers(r).every(Number.isFinite) && numbers(hourWaterfall(r)).every(Number.isFinite);

describe('norwegianCalendar', () => {
  it('2026 has 261 weekdays and 8 public holidays on weekdays', () => {
    expect(weekdaysInYear(2026)).toBe(261);
    expect(weekdayHolidays(2026)).toBe(8);
  });

  it('corporate tax is 22 % in 2026, and an unknown year uses the newest known rate', () => {
    expect(corporateTaxPct(2026)).toBe(22);
    expect(corporateTaxPct(2030)).toBe(22);
  });
});

describe('companyHours', () => {
  it('derives paid and available hours from the 2026 calendar', () => {
    const h = companyHours(model(), 2026, 7.5);
    expect(h.paid).toBe(1957.5);
    expect(h.publicHolidayHours + h.holidayHours).toBe(247.5); // (8 + 25) × 7.5
    // (1957.5 − 247.5) × (1 − 0.04 − 0.045)
    expect(h.available).toBeCloseTo(1710 * 0.915, 9);
  });
});

describe('calcCompany: example company', () => {
  const r = calcCompany(model(), ctx);

  it('counts heads and delivery FTE', () => {
    expect(r.heads).toBe(50);
    expect(r.deliveryFte).toBe(44);
  });

  it('your real cost is own cost plus your share, and break-even is real cost per billable hour', () => {
    expect(r.you.ownCost).toBeCloseTo(calcEmployerCost(768_000, 5, { ...DEFAULT_EMPLOYER_COST_CONFIG, overheadAnnual: 0 }, true, 2026, true).totalEmployerCost, 6);
    expect(r.you.realCost).toBeCloseTo(r.you.ownCost + r.you.share, 6);
    expect(r.you.billableHours).toBeCloseTo(1710 * 0.915 * 0.84, 6);
    expect(r.you.breakEvenRate).toBeCloseTo(r.you.realCost / r.you.billableHours, 6);
  });

  it('EBIT is revenue minus people cost, cost lines and bonus', () => {
    expect(r.ebit).toBeCloseTo(r.revenue - r.peopleCost - r.linesTotal - r.bonus, 4);
    expect(r.ebit).toBeGreaterThan(0);
  });

  it('bonus = result before bonus × pool % × (1 + holiday pay %) × (1 + AGA)', () => {
    expect(r.bonus).toBeCloseTo(r.preBonus * 0.15 * 1.12 * 1.141, 4);
    const noHoliday = calcCompany(model({ bonus: { poolPct: 15, includesHolidayPay: false } }), ctx);
    expect(noHoliday.bonus).toBeCloseTo(noHoliday.preBonus * 0.15 * 1.141, 4);
  });

  it('tax is 22 % of a positive EBIT', () => {
    expect(r.tax).toBeCloseTo(r.ebit * 0.22, 4);
  });
});

describe('test rules', () => {
  // Rule 1
  it('with no support groups, no cost lines and Enkel’s billable hours, the rate equals Enkel with 0 overhead', () => {
    const enkelHours = calcBillableHours(DEFAULT_BILLING_CONFIG);
    const cfg = { ...DEFAULT_EMPLOYER_COST_CONFIG, overheadAnnual: 0, overheadPct: 0 };
    const enkel = calcBillingRate(calcEmployerCost(768_000, 5, cfg, true, 2026, true).totalEmployerCost, DEFAULT_BILLING_CONFIG);
    const m = model({ groups: DEFAULT_COMPANY_MODEL.groups.filter((g) => g.kind === 'delivery'), costs: [] });
    const r = calcCompany(m, { ...ctx, selfBillableHoursOverride: enkelHours });
    expect(r.pool).toBe(0);
    expect(r.you.billableHours).toBe(enkelHours);
    expect(r.you.breakEvenRate).toBeCloseTo(enkel.breakEvenHourly, 9);
  });

  // Rule 2
  it('one more support person with cost C raises your overhead per hour by C ÷ delivery FTE ÷ your hours', () => {
    const before = calcCompany(model(), ctx);
    const extra = { id: 'x', name: 'Ny', kind: 'support' as const, count: 1, avgGross: 650_000, billablePct: 0, hourlyRate: 0, realizationPct: 100 };
    const after = calcCompany(model({ groups: [...DEFAULT_COMPANY_MODEL.groups, extra] }), ctx);
    const C = calcEmployerCost(650_000, 5, { ...DEFAULT_EMPLOYER_COST_CONFIG, overheadAnnual: 0 }, true, 2026, true).totalEmployerCost;
    const perHour = (r: CompanyResult) => r.you.share / r.you.billableHours;
    // The head-based cost lines also grow with one more head; take them out.
    const headLines = DEFAULT_COMPANY_MODEL.costs.filter((c) => c.per === 'head').reduce((s, c) => s + c.amount, 0);
    const pctLines = 650_000 * 0.7 / 100;
    expect(perHour(after) - perHour(before)).toBeCloseTo((C + headLines + pctLines) / 44 / before.you.billableHours, 6);
    // And with no cost lines, exactly C ÷ FTE ÷ hours.
    const b2 = calcCompany(model({ costs: [] }), ctx);
    const a2 = calcCompany(model({ costs: [], groups: [...DEFAULT_COMPANY_MODEL.groups, extra] }), ctx);
    expect(perHour(a2) - perHour(b2)).toBeCloseTo(C / 44 / b2.you.billableHours, 9);
  });

  // Rule 3
  it('at break-even utilization EBIT is about 0', () => {
    const be = breakEvenUtilization(model(), ctx);
    expect(be).not.toBeNull();
    const r = calcCompany(model(), ctx, { ...NEUTRAL_LEVERS, utilizationPp: be!.shiftPp });
    expect(Math.abs(r.ebit)).toBeLessThan(1);
    expect(be!.utilizationPct).toBeGreaterThan(40);
    expect(be!.utilizationPct).toBeLessThan(calcCompany(model(), ctx).meanUtilizationPct);
  });

  it('break-even utilization is null when the company loses money even at 100 %', () => {
    const m = model({ costs: [{ id: 'big', label: 'x', amount: 1e12, per: 'company' }] });
    expect(breakEvenUtilization(m, ctx)).toBeNull();
    expect(breakEvenUtilization(model({ groups: [] }), ctx)).toBeNull();
  });

  // Rule 4
  it('the overhead shared out equals the pool, per FTE and per billable hour', () => {
    const r = calcCompany(model(), ctx);
    expect(r.you.share * r.deliveryFte).toBeCloseTo(r.pool, 4);
    const deliveryHours = r.groups.filter((g) => g.kind === 'delivery').reduce((s, g) => s + g.billableHours * g.count, 0);
    expect(r.overheadPerBillableHour * deliveryHours).toBeCloseTo(r.pool, 4);
  });

  // Rule 5
  it('stays finite for count 0, 0 hours, your group at 0 %, no groups and a pool below 0', () => {
    const zeroCount = model({ groups: DEFAULT_COMPANY_MODEL.groups.map((g) => ({ ...g, count: 0 })) });
    const zeroGroupPct = model({ groups: DEFAULT_COMPANY_MODEL.groups.map((g) => (g.id === 'kons' ? { ...g, billablePct: 0 } : g)) });
    const noGroups = model({ groups: [], selfGroupId: null });
    const negativePool = model({
      costs: [],
      groups: DEFAULT_COMPANY_MODEL.groups.map((g) => (g.kind === 'support' ? { ...g, billablePct: 100, hourlyRate: 5000 } : g)),
    });
    const cases: Array<[CompanyModel, CompanyContext]> = [
      [zeroCount, ctx],
      [model(), { ...ctx, hoursPerDay: 0 }],
      [model({ hours: { sickPct: 60, internalPct: 60, holidayDays: 400 } }), ctx],
      [zeroGroupPct, ctx],
      [noGroups, ctx],
      [negativePool, ctx],
      [model(), { ...ctx, ownGross: Number.NaN }],
    ];
    for (const [m, c] of cases) {
      const r = calcCompany(m, c);
      expect(allFinite(r)).toBe(true);
      expect(utilizationCurve(m, c).every((p) => Number.isFinite(p.ebit) && Number.isFinite(p.baselineEbit))).toBe(true);
      const be = breakEvenUtilization(m, c);
      if (be) expect(Number.isFinite(be.utilizationPct)).toBe(true);
    }
    expect(calcCompany(negativePool, ctx).pool).toBeLessThan(0);
    expect(calcCompany(zeroGroupPct, ctx).you.breakEvenRate).toBe(0);
  });

  // Rule 6
  it('bonus is never below 0, and tax on a loss is 0', () => {
    const loss = calcCompany(model(), ctx, { ...NEUTRAL_LEVERS, utilizationPp: -40 });
    expect(loss.preBonus).toBeLessThan(0);
    expect(loss.bonus).toBe(0);
    expect(loss.tax).toBe(0);
    expect(loss.ebit).toBe(loss.preBonus);
  });

  // Rule 7
  it('Enkel output is unchanged (default salary, billing and cost settings)', () => {
    const cost = calcEmployerCost(768_000, 5, DEFAULT_EMPLOYER_COST_CONFIG, true, 2026, true);
    const billing = calcBillingRate(cost.totalEmployerCost, DEFAULT_BILLING_CONFIG);
    expect(Math.round(cost.totalEmployerCost)).toBe(1_030_998);
    expect(billing.billableHoursPerYear).toBe(1560);
    expect(Math.round(billing.breakEvenHourly)).toBe(661);
    expect(Math.round(billing.targetHourly)).toBe(944);
  });

  // Rule 8
  it('repairs a broken saved blob to a valid model', () => {
    expect(sanitizeCompanyModel(null)).toEqual(DEFAULT_COMPANY_MODEL);
    expect(sanitizeCompanyModel('x')).toEqual(DEFAULT_COMPANY_MODEL);
    const m = sanitizeCompanyModel({
      mode: 'weird',
      groups: [
        { id: 'a', name: 5, kind: 'other', count: -3, avgGross: 'x', billablePct: 150, hourlyRate: Number.NaN, realizationPct: -5 },
        { id: 'a', name: 'Dup', kind: 'support', count: 2, avgGross: 500_000, billablePct: 0, hourlyRate: 0, realizationPct: 90 },
        'junk',
      ],
      selfGroupId: 'missing',
      hours: { sickPct: Infinity, internalPct: -1 },
      costs: [{ label: 'L', amount: -10, per: 'nope' }, null],
      bonus: { poolPct: 500 },
      levers: { utilizationPp: 1e9, ratePct: 'x' },
    });
    expect(m.mode).toBe('simple');
    expect(m.groups).toHaveLength(2);
    expect(m.groups[0]).toEqual({ id: 'a', name: '', kind: 'delivery', count: 0, avgGross: 0, billablePct: 100, hourlyRate: 0, realizationPct: 0 });
    expect(m.groups[1].id).not.toBe('a');
    expect(m.selfGroupId).toBe('a');
    expect(m.hours).toEqual({ sickPct: 4, internalPct: 0, holidayDays: 25 });
    expect(m.costs).toEqual([{ id: 'cost-1', label: 'L', amount: 0, per: 'company' }]);
    expect(m.bonus).toEqual({ poolPct: 100, includesHolidayPay: true });
    expect(m.levers).toEqual({ utilizationPp: 100, ratePct: 0, salaryPct: 0, realizationPp: 0 });
    expect(allFinite(calcCompany(m, ctx))).toBe(true);
  });

  it('keeps a valid model as it is', () => {
    const m = model({ mode: 'advanced', levers: { utilizationPp: 3, ratePct: 5, salaryPct: -2, realizationPp: 1 } });
    expect(sanitizeCompanyModel(m)).toEqual(m);
    expect(sanitizeCompanyModel({ ...m, groups: [], selfGroupId: null }).groups).toEqual([]);
  });

  // Rule 9
  it('levers at 0 give the stored model', () => {
    const stored = calcCompany(model(), ctx);
    const neutral = calcCompany(model(), ctx, NEUTRAL_LEVERS);
    expect(neutral).toEqual(stored);
  });

  it('"Lagre som utgangspunkt" then levers at 0 gives the same results as before the save', () => {
    const levers = { utilizationPp: 4, ratePct: 6, salaryPct: 3, realizationPp: -2 };
    const m = model({ levers });
    const before = calcCompany(m, ctx);
    const saved = applyLevers(m);
    expect(saved.levers).toEqual(NEUTRAL_LEVERS);
    const after = calcCompany(saved, ctx);
    for (const k of ['revenue', 'peopleCost', 'linesTotal', 'pool', 'bonus', 'ebit', 'tax', 'meanUtilizationPct'] as const) {
      expect(after[k]).toBeCloseTo(before[k], 4);
    }
    expect(after.you.share).toBeCloseTo(before.you.share, 4);
    expect(after.you.billableHours).toBeCloseTo(before.you.billableHours, 6);
    // Your own salary comes from the salary page, so with the salary lever at 0
    // the own numbers match too.
    const noSalary = model({ levers: { ...levers, salaryPct: 0 } });
    expect(calcCompany(applyLevers(noSalary), ctx).you.breakEvenRate).toBeCloseTo(calcCompany(noSalary, ctx).you.breakEvenRate, 6);
  });
});

describe('levers', () => {
  it('each lever moves EBIT the expected way', () => {
    const base = calcCompany(model(), ctx).ebit;
    expect(calcCompany(model(), ctx, { ...NEUTRAL_LEVERS, utilizationPp: 5 }).ebit).toBeGreaterThan(base);
    expect(calcCompany(model(), ctx, { ...NEUTRAL_LEVERS, ratePct: 5 }).ebit).toBeGreaterThan(base);
    expect(calcCompany(model(), ctx, { ...NEUTRAL_LEVERS, salaryPct: 5 }).ebit).toBeLessThan(base);
    expect(calcCompany(model(), ctx, { ...NEUTRAL_LEVERS, realizationPp: 5 }).ebit).toBeGreaterThan(base);
  });

  it('the salary lever raises your own salary too', () => {
    const r = calcCompany(model(), ctx, { ...NEUTRAL_LEVERS, salaryPct: 10 });
    expect(r.you.gross).toBeCloseTo(768_000 * 1.1, 6);
  });

  it('the utilization lever moves delivery groups only and clamps at 0 and 100', () => {
    const r = calcCompany(model(), ctx, { ...NEUTRAL_LEVERS, utilizationPp: 30 });
    expect(r.groups.find((g) => g.id === 'kons')!.billablePct).toBe(100);
    expect(r.groups.find((g) => g.id === 'led')!.billablePct).toBe(10);
  });
});

describe('hourWaterfall', () => {
  it('adds up from list price to the result, and the costs equal the break-even rate', () => {
    const r = calcCompany(model(), ctx);
    const w = hourWaterfall(r);
    expect(w.listRate - w.realizationLoss).toBeCloseTo(w.billed, 9);
    expect(w.salary + w.onCosts + w.support + w.other).toBeCloseTo(r.you.breakEvenRate, 6);
    expect(w.billed - w.salary - w.onCosts - w.support - w.other).toBeCloseTo(w.result, 9);
  });
});

describe('utilizationCurve', () => {
  it('covers 40–100 %, rises with utilization and matches the baseline when levers are 0', () => {
    const pts = utilizationCurve(model(), ctx);
    expect(pts).toHaveLength(61);
    expect(pts[0].utilizationPct).toBe(40);
    expect(pts[60].utilizationPct).toBe(100);
    for (let i = 1; i < pts.length; i++) expect(pts[i].ebit).toBeGreaterThanOrEqual(pts[i - 1].ebit);
    expect(pts.every((p) => p.ebit === p.baselineEbit)).toBe(true);
    const moved = utilizationCurve(model({ levers: { ...NEUTRAL_LEVERS, ratePct: 10 } }), ctx);
    expect(moved[40].ebit).toBeGreaterThan(moved[40].baselineEbit);
  });
});
