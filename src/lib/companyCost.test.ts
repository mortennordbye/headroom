import { describe, it, expect } from 'vitest';
import {
  calcCompany, companyHours, hourWaterfall, breakEvenUtilization, utilizationCurve, applyLevers,
  sanitizeCompanyModel, ensureDeliverySelf, calculatorInputs, youEconomics, isOfficeLine, isBenchGroup, DEFAULT_COMPANY_MODEL, NEUTRAL_LEVERS,
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

  it('Enkel: the calculator runs on the simple settings unchanged (same objects)', () => {
    const company = calcCompany(model(), ctx);
    const inputs = calculatorInputs(false, DEFAULT_EMPLOYER_COST_CONFIG, DEFAULT_BILLING_CONFIG, company);
    expect(inputs.costConfig).toBe(DEFAULT_EMPLOYER_COST_CONFIG);
    expect(inputs.billing).toBe(DEFAULT_BILLING_CONFIG);
    expect(inputs.shareClamped).toBe(false);
  });

  it('Avansert: the calculator gets your share as overhead and the model’s billable hours', () => {
    const company = calcCompany(model(), ctx);
    const inputs = calculatorInputs(true, DEFAULT_EMPLOYER_COST_CONFIG, DEFAULT_BILLING_CONFIG, company);
    expect(inputs.costConfig).toEqual({ ...DEFAULT_EMPLOYER_COST_CONFIG, overheadAnnual: company.you.share, overheadPct: 0 });
    expect(calcBillableHours(inputs.billing)).toBeCloseTo(company.you.billableHours, 9);
    const cost = calcEmployerCost(768_000, 5, inputs.costConfig, true, 2026, true).totalEmployerCost;
    expect(calcBillingRate(cost, inputs.billing).breakEvenHourly).toBeCloseTo(company.you.breakEvenRate, 6);
    // A share below 0 is applied as 0 and flagged; 0 hours stay 0 hours.
    const negative = { ...company, you: { ...company.you, share: -1000, billableHours: 0 } };
    const n = calculatorInputs(true, DEFAULT_EMPLOYER_COST_CONFIG, DEFAULT_BILLING_CONFIG, negative);
    expect(n.costConfig.overheadAnnual).toBe(0);
    expect(n.shareClamped).toBe(true);
    expect(calcBillableHours(n.billing)).toBe(0);
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
      levers: { utilizationPp: 1e9, ratePct: 'x', salaryPct: -40 },
    });
    expect(m.mode).toBe('simple');
    expect(m.groups).toHaveLength(2);
    expect(m.groups[0]).toEqual({ id: 'a', name: '', kind: 'delivery', count: 0, avgGross: 0, billablePct: 100, hourlyRate: 0, realizationPct: 0 });
    expect(m.groups[1].id).not.toBe('a');
    expect(m.selfGroupId).toBe('a');
    expect(m.hours).toEqual({ sickPct: 4, internalPct: 0, holidayDays: 25 });
    expect(m.costs).toEqual([{ id: 'cost-1', label: 'L', amount: 0, per: 'company' }]);
    expect(m.bonus).toEqual({ poolPct: 50, includesHolidayPay: true });
    // Clamped to the slider ranges.
    expect(m.levers).toEqual({ utilizationPp: 12, ratePct: 0, salaryPct: -10, realizationPp: 0 });
    expect(allFinite(calcCompany(m, ctx))).toBe(true);
  });

  it('coerces numeric strings, as the rest of the payload sanitizer does', () => {
    const m = sanitizeCompanyModel({
      groups: [{ id: 'a', name: 'A', kind: 'delivery', count: '38', avgGross: '820 000', billablePct: '84,5', hourlyRate: 1300, realizationPct: 93 }],
      bonus: { poolPct: '15' },
    });
    expect(m.groups[0]).toMatchObject({ count: 38, avgGross: 820_000, billablePct: 84.5 });
    expect(m.bonus.poolPct).toBe(15);
  });

  it('your group is always a delivery group (sanitizer and ensureDeliverySelf)', () => {
    const groups = [
      { id: 's', name: 'S', kind: 'support', count: 1, avgGross: 1, billablePct: 0, hourlyRate: 0, realizationPct: 100 },
      { id: 'd', name: 'D', kind: 'delivery', count: 1, avgGross: 1, billablePct: 80, hourlyRate: 1, realizationPct: 100 },
    ];
    expect(sanitizeCompanyModel({ groups, selfGroupId: 's' }).selfGroupId).toBe('d');
    expect(sanitizeCompanyModel({ groups: [groups[0]], selfGroupId: 's' }).selfGroupId).toBeNull();
    // A group that turns into support hands "you" to the first delivery group.
    const m = model();
    const turned = { ...m, groups: m.groups.map((g) => (g.id === 'kons' ? { ...g, kind: 'support' as const } : g)) };
    expect(ensureDeliverySelf(turned).selfGroupId).toBe('tl');
    expect(ensureDeliverySelf(m)).toBe(m);
    expect(ensureDeliverySelf({ ...m, groups: [] }).selfGroupId).toBeNull();
  });

  it('keeps a valid model as it is', () => {
    const m = model({ mode: 'advanced', levers: { utilizationPp: 3, ratePct: 5, salaryPct: -2, realizationPp: 1 } });
    expect(sanitizeCompanyModel(m)).toEqual(m);
    expect(sanitizeCompanyModel({ ...m, groups: [], selfGroupId: null }).groups).toEqual([]);
  });

  // Rule 9
  it('levers at 0 give the stored model: with stored levers, the result equals a hand calculation on the groups', () => {
    const levers = { utilizationPp: 4, ratePct: 6, salaryPct: 3, realizationPp: -2 };
    const r = calcCompany(model({ levers }), ctx);
    const A = companyHours(model(), 2026, 7.5).available;
    const cfg0 = { ...DEFAULT_EMPLOYER_COST_CONFIG, overheadAnnual: 0, overheadPct: 0 };
    let revenue = 0;
    let people = 0;
    for (const g of DEFAULT_COMPANY_MODEL.groups) {
      const billable = g.kind === 'delivery' ? g.billablePct + 4 : g.billablePct;
      revenue += A * billable / 100 * g.hourlyRate * 1.06 * (g.realizationPct - 2) / 100 * g.count;
      people += calcEmployerCost(g.avgGross * 1.03, 5, cfg0, true, 2026, true).totalEmployerCost * g.count;
    }
    expect(r.revenue).toBeCloseTo(revenue, 4);
    expect(r.peopleCost).toBeCloseTo(people, 4);
    // Your own salary is the salary page's, not moved by the salary lever.
    expect(r.you.gross).toBe(768_000);
    // And at levers 0 the stored groups are used as they are.
    expect(calcCompany(model(), ctx, NEUTRAL_LEVERS)).toEqual(calcCompany(model(), ctx));
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
    // With the salary lever at +3 %, your own numbers do not move either.
    expect(after.you.ownCost).toBeCloseTo(before.you.ownCost, 6);
    expect(after.you.realCost).toBeCloseTo(before.you.realCost, 4);
    expect(after.you.breakEvenRate).toBeCloseTo(before.you.breakEvenRate, 6);
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

  it('the salary lever moves the groups, not your own salary', () => {
    const r = calcCompany(model(), ctx, { ...NEUTRAL_LEVERS, salaryPct: 10 });
    expect(r.you.gross).toBe(768_000);
    expect(r.groups[0].avgGross).toBeCloseTo(820_000 * 1.1, 6);
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
  it('covers 50–95 %, rises with utilization and matches the baseline when levers are 0', () => {
    const pts = utilizationCurve(model(), ctx);
    expect(pts).toHaveLength(46);
    expect(pts[0].utilizationPct).toBeCloseTo(50, 9);
    expect(pts[45].utilizationPct).toBeCloseTo(95, 9);
    for (let i = 1; i < pts.length; i++) expect(pts[i].ebit).toBeGreaterThanOrEqual(pts[i - 1].ebit);
    expect(pts.every((p) => p.ebit === p.baselineEbit)).toBe(true);
    const moved = utilizationCurve(model({ levers: { ...NEUTRAL_LEVERS, ratePct: 10 } }), ctx);
    expect(moved[30].ebit).toBeGreaterThan(moved[30].baselineEbit);
  });

  it('uses the real mean utilization as x, so the break-even point lies on the curve', () => {
    // Team leads clamp at 0 % on the low end, so x is not the target there.
    const m = model({ groups: DEFAULT_COMPANY_MODEL.groups.map((g) => (g.id === 'tl' ? { ...g, billablePct: 5 } : g)) });
    const base = calcCompany(m, ctx, NEUTRAL_LEVERS).meanUtilizationPct;
    const pts = utilizationCurve(m, ctx);
    const first = calcCompany(m, ctx, { ...NEUTRAL_LEVERS, utilizationPp: 50 - base });
    expect(pts[0].utilizationPct).toBeCloseTo(first.meanUtilizationPct, 9);
    expect(pts[0].utilizationPct).not.toBeCloseTo(50, 1);
    // EBIT changes sign around the break-even x.
    const be = breakEvenUtilization(model(), ctx)!;
    const curve = utilizationCurve(model(), ctx);
    const below = curve.filter((p) => p.utilizationPct < be.utilizationPct - 1e-6);
    const above = curve.filter((p) => p.utilizationPct > be.utilizationPct + 1e-6);
    expect(below.every((p) => p.ebit < 0)).toBe(true);
    expect(above.every((p) => p.ebit > 0)).toBe(true);
  });
});

describe('youEconomics: what the company earns on you', () => {
  // One delivery group; the support groups (leadership, bench) bill nothing.
  const avgModel = (patch: Partial<CompanyModel> = {}): CompanyModel => model({
    groups: [
      { id: 'kons', name: 'Konsulenter', kind: 'delivery', count: 40, avgGross: 820_000, billablePct: 84, hourlyRate: 1300, realizationPct: 93 },
      { id: 'benk', name: 'Benk', kind: 'support', count: 2, avgGross: 820_000, billablePct: 0, hourlyRate: 1300, realizationPct: 93 },
      { id: 'led', name: 'Ledelse', kind: 'support', count: 4, avgGross: 1_200_000, billablePct: 0, hourlyRate: 0, realizationPct: 93 },
    ],
    selfGroupId: 'kons',
    ...patch,
  });
  const avgCtx: CompanyContext = { ...ctx, ownGross: 820_000 };
  const run = (m: CompanyModel, c: CompanyContext = avgCtx, gross?: number) => youEconomics(m, c, calcCompany(m, c), gross);

  it('an average consultant gets fair salary = the group average at the company pre-bonus margin', () => {
    const y = run(avgModel());
    expect(y.targetIsCompany).toBe(true);
    expect(y.keepPct).toBeCloseTo(y.companyPreBonusMarginPct, 6);
    expect(y.fairGross).not.toBeNull();
    expect(Math.abs(y.fairGross! - 820_000)).toBeLessThan(1);
  });

  it('the fair salary and the pool do not depend on your own gross', () => {
    const avg = calcCompany(avgModel(), avgCtx);
    for (const ownGross of [600_000, 1_100_000]) {
      const c2 = { ...avgCtx, ownGross };
      const r = calcCompany(avgModel(), c2);
      expect(r.pool).toBe(avg.pool);
      const y = youEconomics(avgModel(), c2, r);
      expect(y.gross).toBe(ownGross);
      expect(Math.abs(y.fairGross! - 820_000)).toBeLessThan(1);
    }
  });

  it('keep is revenue minus own cost and your share; keep % at fair salary is the target', () => {
    const m = avgModel({ targetMarginPct: 20 });
    const r = calcCompany(m, avgCtx);
    const y = youEconomics(m, avgCtx, r);
    expect(y.revenue).toBeCloseTo(r.you.billableHours * 1300 * 0.93, 6);
    expect(y.keep).toBeCloseTo(y.revenue - r.you.ownCost - r.you.share, 6);
    expect(y.targetIsCompany).toBe(false);
    expect(y.targetMarginPct).toBe(20);
    expect(run(m, avgCtx, y.fairGross!).keepPct).toBeCloseTo(20, 1);
  });

  it('keep is 0 at the ceiling, and the ceiling is above the fair salary', () => {
    const y = run(avgModel());
    expect(y.ceilingGross).not.toBeNull();
    expect(Math.abs(run(avgModel(), avgCtx, y.ceilingGross!).keep)).toBeLessThan(1);
    expect(y.ceilingGross!).toBeGreaterThan(y.fairGross!);
  });

  it('the one-year breakdown adds up to what you invoice, and kept = keep', () => {
    const cases: Array<[CompanyModel, number | undefined]> = [[avgModel(), undefined], [model(), undefined], [model(), 1_400_000]];
    for (const [m, g] of cases) {
      const y = run(m, avgCtx, g);
      expect(y.breakdown.reduce((s, p) => s + p.value, 0)).toBeCloseTo(y.revenue, 6);
      expect(y.breakdown.find((p) => p.kind === 'kept')!.value).toBeCloseTo(y.keep, 6);
    }
    const parts = run(avgModel()).breakdown;
    expect(parts.find((p) => p.key === 'group-benk')).toMatchObject({ kind: 'bench', label: 'Benk' });
    expect(parts.find((p) => p.key === 'group-led')).toMatchObject({ kind: 'support', label: 'Ledelse' });
    expect(parts.find((p) => p.kind === 'office')!.value).toBeGreaterThan(0);
  });

  it('lønnsandel: yours is gross / revenue, the company one is delivery salaries / delivery revenue', () => {
    const m = avgModel();
    const r = calcCompany(m, avgCtx);
    const y = youEconomics(m, avgCtx, r);
    expect(y.salarySharePct).toBeCloseTo(820_000 / y.revenue * 100, 6);
    const kons = r.groups.find((g) => g.id === 'kons')!;
    expect(y.companySalarySharePct).toBeCloseTo(820_000 / kons.revenuePerFte * 100, 6);
    // An average consultant has the company's lønnsandel.
    expect(y.salarySharePct).toBeCloseTo(y.companySalarySharePct, 6);
  });

  it('+100 000 kr costs about 1.23 × the raise, and the bonus pool falls by pool % × holiday pay × AGA of it', () => {
    const y = run(model(), ctx);
    expect(y.raise.amount).toBe(100_000);
    expect(y.raise.cost / 100_000).toBeGreaterThan(1.22);
    expect(y.raise.cost / 100_000).toBeLessThan(1.24);
    expect(y.raise.bonusDrop).toBeCloseTo(y.raise.cost * 0.15 * 1.12 * 1.141, 6);
  });

  it('no bonus drop when the company makes no profit before bonus', () => {
    const m = model({ groups: model().groups.map((g) => ({ ...g, hourlyRate: 100 })) });
    expect(run(m, ctx).raise.bonusDrop).toBe(0);
  });

  it('the bonus drop is capped at the bonus when the result before bonus is small', () => {
    const r0 = calcCompany(model(), ctx);
    // An extra company cost that leaves 1 000 kr before bonus.
    const m = model({ costs: [...model().costs, { id: 'x', label: 'Extra', amount: r0.preBonus - 1000, per: 'company' }] });
    const r = calcCompany(m, ctx);
    expect(r.preBonus).toBeCloseTo(1000, 3);
    const y = youEconomics(m, ctx, r);
    expect(y.raise.cost * 0.15 * 1.12 * 1.141).toBeGreaterThan(r.bonus);
    expect(y.raise.bonusDrop).toBeCloseTo(r.bonus, 9);
    expect(y.raise.bonusDrop).toBeGreaterThan(0);
  });

  it('a company margin before bonus at or below 0 gives a default target of 0, so fair salary = ceiling', () => {
    const m = model({ groups: model().groups.map((g) => (g.kind === 'delivery' ? { ...g, hourlyRate: 900 } : g)) });
    const r = calcCompany(m, ctx);
    expect(r.preBonus).toBeLessThan(0);
    const y = youEconomics(m, ctx, r);
    expect(y.targetClamped).toBe(true);
    expect(y.targetMarginPct).toBe(0);
    expect(y.fairGross).not.toBeNull();
    expect(y.fairGross).toBeCloseTo(y.ceilingGross!, 3);
    // A positive margin is not clamped, and the fair salary stays below the ceiling.
    const ok = run(model(), ctx);
    expect(ok.targetClamped).toBe(false);
    expect(ok.fairGross!).toBeLessThan(ok.ceilingGross!);
  });

  it('office lines match by id or a leading word only', () => {
    const line = (id: string, label: string) => isOfficeLine({ id, label });
    expect(line('office', 'Anything')).toBe(true);
    expect(line('x', 'Kontor (leie, strøm)')).toBe(true);
    expect(line('x', 'Husleie')).toBe(true);
    expect(line('x', 'Rent and power')).toBe(true);
    expect(line('x', 'Rentekostnader')).toBe(false);
    expect(line('x', 'current costs')).toBe(false);
    expect(line('x', 'IT og kontorrekvisita')).toBe(false);
    expect(isBenchGroup({ id: 'benk', name: 'Uten oppdrag' })).toBe(true);
    expect(isBenchGroup({ id: 'b2', name: 'Bench' })).toBe(true);
    expect(isBenchGroup({ id: 'led', name: 'Ledelse' })).toBe(false);
  });

  it('stays finite for empty groups, 0 hours and no self group', () => {
    const cases: Array<[CompanyModel, CompanyContext]> = [
      [model({ groups: [], selfGroupId: null }), ctx],
      [model(), { ...ctx, hoursPerDay: 0 }],
      [model({ selfGroupId: null }), ctx],
      [model({ groups: model().groups.filter((g) => g.kind === 'support') }), ctx],
    ];
    for (const [m, c] of cases) {
      const y = run(m, c);
      expect(numbers(y).every(Number.isFinite)).toBe(true);
      expect(y.fairGross).toBeNull();
      expect(y.ceilingGross).toBeNull();
      expect(y.breakdown.reduce((s, p) => s + p.value, 0)).toBeCloseTo(y.revenue, 6);
    }
  });

  it('no ceiling when even 0 kr salary leaves a loss', () => {
    const m = model({ groups: model().groups.map((g) => (g.kind === 'delivery' ? { ...g, hourlyRate: 50 } : g)) });
    expect(run(m, ctx).ceilingGross).toBeNull();
  });

  it('the sanitizer keeps targetMarginPct as null or 0-60', () => {
    expect(sanitizeCompanyModel({}).targetMarginPct).toBeNull();
    expect(sanitizeCompanyModel({ targetMarginPct: null }).targetMarginPct).toBeNull();
    expect(sanitizeCompanyModel({ targetMarginPct: 12.5 }).targetMarginPct).toBe(12.5);
    expect(sanitizeCompanyModel({ targetMarginPct: '15' }).targetMarginPct).toBe(15);
    expect(sanitizeCompanyModel({ targetMarginPct: 99 }).targetMarginPct).toBe(60);
    expect(sanitizeCompanyModel({ targetMarginPct: -5 }).targetMarginPct).toBe(0);
    expect(sanitizeCompanyModel({ targetMarginPct: 'x' }).targetMarginPct).toBeNull();
  });
});

describe('your own billable share and rate (model.self)', () => {
  it('you can bill more and at another rate than your group; the group does not change', () => {
    const plain = model();
    const own = model({ self: { billablePct: 95, hourlyRate: 1500 } });
    const a = calcCompany(plain, ctx);
    const b = calcCompany(own, ctx);
    expect(b.you.billableHours).toBeCloseTo(b.hours.available * 0.95, 6);
    expect(b.you.listRate).toBe(1500);
    expect(b.ebit).toBeCloseTo(a.ebit, 6);
    expect(youEconomics(own, ctx, b).revenue).toBeCloseTo(b.hours.available * 0.95 * 1500 * 0.93, 6);
  });

  it('the levers move your own share and rate as they move your group', () => {
    const own = model({ self: { billablePct: 90, hourlyRate: 1500 }, levers: { ...NEUTRAL_LEVERS, utilizationPp: 5, ratePct: 10 } });
    const r = calcCompany(own, ctx);
    expect(r.you.billableHours).toBeCloseTo(r.hours.available * 0.95, 6);
    expect(r.you.listRate).toBeCloseTo(1650, 6);
  });

  it('"Lagre som utgangspunkt" writes the levers into your own share and rate too, so your numbers stay the same', () => {
    const m = model({ self: { billablePct: 97, hourlyRate: 1500 }, levers: { utilizationPp: 6, ratePct: 8, salaryPct: 0, realizationPp: -3 } });
    const before = calcCompany(m, ctx);
    const saved = applyLevers(m);
    expect(saved.self).toEqual({ billablePct: 100, hourlyRate: 1620 });
    const after = calcCompany(saved, ctx);
    const yb = youEconomics(m, ctx, before);
    const ya = youEconomics(saved, ctx, after);
    expect(after.you.billableHours).toBeCloseTo(before.you.billableHours, 6);
    expect(after.you.listRate).toBeCloseTo(before.you.listRate, 6);
    expect(ya.keep).toBeCloseTo(yb.keep, 4);
    expect(ya.fairGross!).toBeCloseTo(yb.fairGross!, 2);
    expect(applyLevers(model({ self: { hourlyRate: 1000 }, levers: { ...NEUTRAL_LEVERS, ratePct: 10 } })).self).toEqual({ hourlyRate: 1100 });
  });

  it('a set billable-hours override still wins', () => {
    const r = calcCompany(model({ self: { billablePct: 50 } }), { ...ctx, selfBillableHoursOverride: 1200 });
    expect(r.you.billableHours).toBe(1200);
  });

  it('the sanitizer keeps known self fields, clamps them and drops an empty self', () => {
    expect(sanitizeCompanyModel({ ...model(), self: { billablePct: '120', hourlyRate: -3 } }).self).toEqual({ billablePct: 100, hourlyRate: 0 });
    expect(sanitizeCompanyModel({ ...model(), self: { foo: 1 } })).not.toHaveProperty('self');
    expect(sanitizeCompanyModel({ ...model(), self: { billablePct: 'x' } })).not.toHaveProperty('self');
  });
});
