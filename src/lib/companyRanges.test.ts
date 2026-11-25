import { describe, it, expect } from 'vitest';
import { companyRanges, shiftAnswer, GUESS_SWINGS, DONT_KNOW_FACTOR, type CompanyRanges, type Range } from './companyRanges';
import { buildModelFromAnswers, sanitizeQuick, QUICK_DEFAULTS, QUICK_GUESS_KEYS, type QuickGuessKey } from './companySetup';
import { calcCompany, youEconomics, sanitizeCompanyModel, DEFAULT_COMPANY_MODEL, type CompanyContext, type CompanyModel } from './companyCost';
import { DEFAULT_EMPLOYER_COST_CONFIG } from './employerCost';

const ctx: CompanyContext = {
  year: 2026,
  hoursPerDay: 7.5,
  ownGross: 880_000,
  otpPct: 5,
  costConfig: DEFAULT_EMPLOYER_COST_CONFIG,
  holidayPayInSalary: true,
  otpCap: true,
};
const model = (uncertain: QuickGuessKey[] = [], dontKnow: QuickGuessKey[] = []): CompanyModel =>
  buildModelFromAnswers({ ...QUICK_DEFAULTS, ownBillablePct: 88, rateYou: 1500 }, structuredClone(DEFAULT_COMPANY_MODEL), { uncertain, dontKnow });
const ranges = (m: CompanyModel) => companyRanges(m, ctx)!;
const OUT = ['keep', 'keepPct', 'fairGross', 'ceilingGross', 'companyPreBonusMarginPct'] as const;

/** The fair salary of the model with one answer at its low and high end. */
function fairEnds(key: QuickGuessKey, factor = 1) {
  const m = model();
  const at = (dir: -1 | 1) => {
    const mm = buildModelFromAnswers(shiftAnswer(m.quick!.answers, key, dir, factor), m);
    return youEconomics(mm, ctx, calcCompany(mm, ctx)).fairGross!;
  };
  return [at(-1), at(1)];
}

describe('companyRanges', () => {
  it('is null without a quick setup', () => {
    expect(companyRanges(structuredClone(DEFAULT_COMPANY_MODEL), ctx)).toBeNull();
  });

  it('no guesses: low = mid = high, and no drivers', () => {
    const r = ranges(model());
    expect(r.guesses).toBe(0);
    expect(r.drivers).toEqual([]);
    for (const o of OUT) {
      expect(r[o].mid).not.toBeNull();
      expect(r[o].low).toBe(r[o].mid);
      expect(r[o].high).toBe(r[o].mid);
    }
  });

  it('mid is what youEconomics gives for the stored model', () => {
    const m = model(['salary']);
    const y = youEconomics(m, ctx, calcCompany(m, ctx));
    const r = ranges(m);
    expect(r.keep.mid).toBe(y.keep);
    expect(r.fairGross.mid).toBe(y.fairGross);
  });

  it('one guess: the range is that single swing', () => {
    const r = ranges(model(['rateAverage']));
    const [lo, hi] = fairEnds('rateAverage');
    const mid = r.fairGross.mid!;
    expect(r.fairGross.low).toBeCloseTo(Math.min(mid, lo, hi), 3);
    expect(r.fairGross.high).toBeCloseTo(Math.max(mid, lo, hi), 3);
    expect(r.drivers).toHaveLength(1);
    expect(r.drivers[0].key).toBe('rateAverage');
    expect(r.drivers[0].width).toBeCloseTo(Math.abs(hi - lo), 3);
  });

  it('two guesses: down and up swings combine by root-sum-square', () => {
    const one = (k: QuickGuessKey) => ranges(model([k])).fairGross;
    const a = one('salary');
    const b = one('typicalBillablePct');
    const both = ranges(model(['salary', 'typicalBillablePct'])).fairGross;
    const mid = both.mid!;
    const rss = (x: number, y: number) => Math.sqrt(x * x + y * y);
    expect(mid - both.low!).toBeCloseTo(rss(a.mid! - a.low!, b.mid! - b.low!), 3);
    expect(both.high! - mid).toBeCloseTo(rss(a.high! - a.mid!, b.high! - b.mid!), 3);
  });

  it('"vet ikke" uses the wider swing', () => {
    const r = ranges(model([], ['realizationPct']));
    const [lo, hi] = fairEnds('realizationPct', DONT_KNOW_FACTOR);
    expect(r.fairGross.high! - r.fairGross.low!).toBeCloseTo(Math.abs(hi - lo), 3);
    expect(r.drivers[0].dontKnow).toBe(true);
  });

  it('is monotone: more or wider guesses never narrow a range, and each range holds the mid', () => {
    const width = (x: Range) => x.high! - x.low!;
    let prev: CompanyRanges = ranges(model());
    const keys: QuickGuessKey[] = [];
    for (const k of QUICK_GUESS_KEYS) {
      keys.push(k);
      const next = ranges(model([...keys]));
      const wide = ranges(model(keys.slice(0, -1), [k]));
      for (const o of OUT) {
        expect(width(next[o])).toBeGreaterThanOrEqual(width(prev[o]) - 1e-6);
        expect(width(wide[o])).toBeGreaterThanOrEqual(width(next[o]) - 1e-6);
        expect(next[o].low!).toBeLessThanOrEqual(next[o].mid!);
        expect(next[o].high!).toBeGreaterThanOrEqual(next[o].mid!);
      }
      prev = next;
    }
  });

  it('higher billable share raises the fair salary; a higher salary guess lowers the company margin', () => {
    const [lo, hi] = fairEnds('ownBillablePct');
    expect(hi).toBeGreaterThan(lo);
    const r = ranges(model(['salary']));
    expect(r.companyPreBonusMarginPct.low!).toBeLessThan(r.companyPreBonusMarginPct.mid!);
  });

  it('ranks the drivers by their swing on the fair salary', () => {
    const r = ranges(model([...QUICK_GUESS_KEYS]));
    expect(r.drivers.map((d) => d.key).sort()).toEqual([...QUICK_GUESS_KEYS].sort());
    for (let i = 1; i < r.drivers.length; i++) expect(r.drivers[i - 1].width).toBeGreaterThanOrEqual(r.drivers[i].width);
    for (const d of r.drivers) {
      expect(d.down).toBeLessThanOrEqual(0);
      expect(d.up).toBeGreaterThanOrEqual(0);
    }
  });

  it('stays finite (or null) on an empty or zero setup', () => {
    const empty = sanitizeCompanyModel({ quick: { answers: {}, uncertain: [...QUICK_GUESS_KEYS] } });
    const zero = sanitizeCompanyModel({
      ...model(),
      quick: sanitizeQuick({
        answers: { totalFte: 0, nonBilling: 0, onBench: 0, salaryLow: 0, salaryHigh: 0, rateAverage: 0, rateYou: 0, ownBillablePct: 0, typicalBillablePct: 0, realizationPct: 0 },
        dontKnow: [...QUICK_GUESS_KEYS],
      }),
    });
    for (const m of [empty, zero]) {
      for (const c of [ctx, { ...ctx, ownGross: 0 }]) {
        const r = companyRanges(m, c)!;
        for (const o of OUT) {
          for (const v of [r[o].low, r[o].mid, r[o].high]) if (v != null) expect(Number.isFinite(v)).toBe(true);
          if (r[o].mid == null) expect(r[o].low).toBeNull();
        }
        for (const d of r.drivers) expect(Number.isFinite(d.width)).toBe(true);
      }
    }
  });

  it('a salary range never goes below 0', () => {
    const r = ranges(model([...QUICK_GUESS_KEYS], []));
    expect(r.fairGross.low!).toBeGreaterThanOrEqual(0);
    expect(r.ceilingGross.low!).toBeGreaterThanOrEqual(0);
  });

  it('shiftAnswer moves each answer by its swing', () => {
    const a = { ...QUICK_DEFAULTS };
    expect(shiftAnswer(a, 'salary', 1).salaryHigh).toBeCloseTo(a.salaryHigh * (1 + GUESS_SWINGS.salary.size));
    expect(shiftAnswer(a, 'ownBillablePct', -1, 2).ownBillablePct).toBe(a.ownBillablePct - 2 * GUESS_SWINGS.ownBillablePct.size);
    expect(shiftAnswer(a, 'office', 1).desks).toBeCloseTo(a.totalFte * (1 + GUESS_SWINGS.office.size));
    expect(shiftAnswer({ ...a, officeMode: 'rent' }, 'office', -1).annualRent).toBeCloseTo(a.annualRent * (1 - GUESS_SWINGS.office.size));
  });
});
