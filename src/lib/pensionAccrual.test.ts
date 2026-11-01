import { describe, it, expect } from 'vitest';
import {
  pensionAccrualRules, isPensionRuleId, otpBonusBaseline, otpBonusDue, addOtpBonusPosted, switchAutoPostOn, changeOtpScheme, pensionAfterJobRemoved,
  stampUnstampedAutoPost, stampLoadedPension, type PensionAccrualInput,
} from './pensionAccrual';
import { computeAutomationPostings, type AutomationState } from './automation';
import { addMonthsKey } from './date';
import type { Pension } from '../context/FinanceContext';

const LABELS = { otp: 'OTP', ips: 'IPS' };

const input = (over: Partial<PensionAccrualInput> = {}): PensionAccrualInput => ({
  otpAutoPost: true,
  ipsAutoPost: true,
  otpEmployerPct: 5,
  otpEmployeePct: 2,
  ipsAnnualContribution: 15_000,
  pensionableIncome: 600_000,
  currentMonth: '2026-07',
  ...over,
});

describe('pensionAccrualRules', () => {
  it('derives the OTP monthly amount from income × (employer + employee) %', () => {
    const [otp] = pensionAccrualRules(input({ ipsAutoPost: false }), LABELS);
    // 600 000 × 7% = 42 000/yr → 3 500/mo
    expect(otp.amount).toBe(3500);
    expect(otp.targetKind).toBe('pensionOtp');
    expect(otp.id).toBe('pension:otp');
  });

  it('caps the OTP base at 12G', () => {
    const [otp] = pensionAccrualRules(
      input({ ipsAutoPost: false, pensionableIncome: 2_000_000, otpEmployerPct: 5, otpEmployeePct: 0 }),
      LABELS,
    );
    // 12 × 136 549 × 5% = 81 929.4/yr
    expect(otp.amount).toBeCloseTo(81_929.4 / 12, 6);
  });

  it('derives the IPS monthly amount from the yearly contribution', () => {
    const [ips] = pensionAccrualRules(input({ otpAutoPost: false }), LABELS);
    expect(ips.amount).toBe(1250);            // 15 000 / 12
    expect(ips.targetKind).toBe('pensionIps');
  });

  it('emits both rules when both are enabled', () => {
    expect(pensionAccrualRules(input(), LABELS).map(r => r.id))
      .toEqual(['pension:otp', 'pension:ips']);
  });

  it('emits nothing when both toggles are off', () => {
    expect(pensionAccrualRules(input({ otpAutoPost: false, ipsAutoPost: false }), LABELS)).toEqual([]);
  });

  it('omits OTP when there is no salary yet, rather than posting a zero', () => {
    const rules = pensionAccrualRules(input({ pensionableIncome: 0 }), LABELS);
    expect(rules.map(r => r.id)).toEqual(['pension:ips']);
  });

  it('omits OTP when both percentages are zero', () => {
    const rules = pensionAccrualRules(input({ otpEmployerPct: 0, otpEmployeePct: 0 }), LABELS);
    expect(rules.map(r => r.id)).toEqual(['pension:ips']);
  });

  it('omits IPS when the yearly contribution is zero', () => {
    const rules = pensionAccrualRules(input({ ipsAnnualContribution: 0 }), LABELS);
    expect(rules.map(r => r.id)).toEqual(['pension:otp']);
  });

  it('carries the stored lastPostedMonth through as the double-apply guard', () => {
    const [otp] = pensionAccrualRules(input({ ipsAutoPost: false, otpLastPostedMonth: '2026-05' }), LABELS);
    expect(otp.lastPostedMonth).toBe('2026-05');
  });

  it('falls back to NEXT month when never posted, so it can never back-post a jump', () => {
    const [otp] = pensionAccrualRules(input({ ipsAutoPost: false }), LABELS);
    expect(otp.lastPostedMonth).toBeUndefined();
    expect(otp.startMonth).toBe('2026-08');
  });

  it('labels the rules for the catch-up prompt', () => {
    const rules = pensionAccrualRules(input(), LABELS);
    expect(rules.map(r => r.name)).toEqual(['OTP', 'IPS']);
  });
});

describe('pensionAccrualRules — OTP bonuses', () => {
  type Bonus = { date: string; amount: number; type: 'annual' | 'signing' | 'holiday_pay' };
  const STATE: AutomationState = {
    savings: {}, scalars: { bufferAccount: 0, portfolio: 0, bsu: 0, pensionOtp: 0, pensionIps: 0 },
    mortgage: 0, mortgageRate: 0, debts: {}, housingMode: 'homeowner',
  };
  const base = { ipsAutoPost: false, otpEmployerPct: 5, otpEmployeePct: 0, pensionableIncome: 600_000 };

  /**
   * Run the app's monthly loop: on the first load of each month, build the rule
   * from what the user has entered by then, post it, and stamp it the way
   * FinanceContext does. Returns what each month moved and the final record.
   */
  function simulate(opts: {
    from: string; to: string; lastPosted: string; posted?: Record<string, number>;
    bonusesAt: (month: string) => Bonus[]; includeAt?: (month: string) => boolean; income?: number;
  }) {
    let lastPosted = opts.lastPosted;
    let posted = opts.posted;
    const moved: Record<string, number> = {};
    for (let m = opts.from; m <= opts.to; m = addMonthsKey(m, 1)) {
      const [rule] = pensionAccrualRules(input({
        ...base, pensionableIncome: opts.income ?? base.pensionableIncome,
        otpIncludesBonuses: opts.includeAt ? opts.includeAt(m) : true,
        bonuses: opts.bonusesAt(m), otpBonusPostedByYear: posted,
        otpLastPostedMonth: lastPosted, currentMonth: m,
      }), LABELS);
      const [p] = computeAutomationPostings([rule], STATE, m);
      moved[m] = p.newBalance;
      if (rule.otpBonusByYear) posted = addOtpBonusPosted(posted, rule.otpBonusByYear, m);
      lastPosted = m;
    }
    const total = Object.values(moved).reduce((a, b) => a + b, 0);
    return { moved, posted, total };
  }
  const MARCH_BONUS: Bonus = { date: '2026-03-25', amount: 100_000, type: 'annual' };

  it('pins the monthly amount with the setting on: fixed twelfth, plus the bonus share once due', () => {
    const [rule] = pensionAccrualRules(input({
      ...base, otpIncludesBonuses: true, bonuses: [MARCH_BONUS],
      otpBonusPostedByYear: { '2026': 0 }, otpLastPostedMonth: '2026-02', currentMonth: '2026-03',
    }), LABELS);
    expect(rule.amount).toBe(2_500);                          // 600 000 × 5% / 12
    expect(rule.amountByMonth).toEqual({ '2026-03': 2_500 + 5_000 });
    expect(rule.otpBonusByYear).toEqual({ '2026': 5_000 });
  });

  it('a bonus entered after its month was posted lands in the next month, and the year sums to the full figure', () => {
    // March posts on its first load, before the bonus is entered later in March.
    const run = simulate({
      from: '2026-01', to: '2026-12', lastPosted: '2025-12', posted: { '2026': 0 },
      bonusesAt: m => (m >= '2026-04' ? [MARCH_BONUS] : []),
    });
    expect(run.moved['2026-03']).toBe(2_500);
    expect(run.moved['2026-04']).toBe(2_500 + 5_000);
    expect(run.moved['2026-05']).toBe(2_500);
    expect(run.total).toBe(35_000);                            // what the Pension page shows
    expect(run.posted).toEqual({ '2026': 5_000 });
  });

  it('a back-dated bonus catches up in the next posting, once', () => {
    const jan: Bonus = { date: '2026-01-15', amount: 40_000, type: 'annual' };
    const run = simulate({
      from: '2026-01', to: '2026-12', lastPosted: '2025-12', posted: { '2026': 0 },
      bonusesAt: m => (m >= '2026-07' ? [jan] : []),
    });
    expect(run.moved['2026-07']).toBe(2_500 + 2_000);
    expect(run.total).toBe(30_000 + 2_000);
  });

  it('turning the setting on mid-year posts the year\'s bonus share so far in the next month', () => {
    const run = simulate({
      from: '2026-01', to: '2026-12', lastPosted: '2025-12',
      bonusesAt: () => [MARCH_BONUS], includeAt: m => m >= '2026-07',
    });
    expect(run.moved['2026-06']).toBe(2_500);
    expect(run.moved['2026-07']).toBe(2_500 + 5_000);
    expect(run.total).toBe(35_000);
  });

  it('posts no bonus with the setting off, and none for a bonus dated after the month', () => {
    const off = pensionAccrualRules(input({ ...base, bonuses: [MARCH_BONUS], otpLastPostedMonth: '2026-03', currentMonth: '2026-04' }), LABELS)[0];
    expect(off.amountByMonth).toBeUndefined();
    expect(off.otpBonusByYear).toEqual({ '2026': 0 }); // tracked, nothing posted
    const early = pensionAccrualRules(input({
      ...base, otpIncludesBonuses: true, bonuses: [MARCH_BONUS], otpLastPostedMonth: '2026-01', currentMonth: '2026-02',
    }), LABELS)[0];
    expect(early.amountByMonth).toBeUndefined();
  });

  it('a truthy non-boolean setting counts as off', () => {
    const rule = pensionAccrualRules(input({
      ...base, otpIncludesBonuses: 'yes' as unknown as boolean, bonuses: [MARCH_BONUS],
      otpLastPostedMonth: '2026-03', currentMonth: '2026-04',
    }), LABELS)[0];
    expect(rule.otpBonusByYear).toEqual({ '2026': 0 });
    expect(rule.amountByMonth).toBeUndefined();
  });

  it('with the setting off it keeps tracking the year, so switching on in January settles December', () => {
    const dec: Bonus = { date: '2025-12-20', amount: 100_000, type: 'annual' };
    // Running since mid-2025 with the setting off; the December bonus is entered
    // in January, and the setting is switched on in January after January posted.
    const run = simulate({
      from: '2025-07', to: '2026-03', lastPosted: '2025-06',
      bonusesAt: m => (m >= '2026-01' ? [dec] : []), includeAt: m => m >= '2026-02',
    });
    expect(run.moved['2026-01']).toBe(2_500);
    expect(run.moved['2026-02']).toBe(2_500 + 5_000);
    expect(run.moved['2026-03']).toBe(2_500);
    expect(run.posted).toEqual({ '2025': 5_000, '2026': 0 });
  });

  it('keeps the 12G cap through a multi-month catch-up', () => {
    // 2026 cap 1 638 588: fixed 1 600 000 leaves 38 588 of room for bonuses.
    const run = simulate({
      income: 1_600_000, from: '2026-04', to: '2026-12', lastPosted: '2026-01', posted: { '2026': 0 },
      bonusesAt: () => [MARCH_BONUS, { date: '2026-09-01', amount: 50_000, type: 'annual' }],
    });
    // April catches up Feb–Apr: three fixed twelfths plus the capped bonus share.
    expect(run.moved['2026-04']).toBe(Math.round(3 * 80_000 / 12 + 38_588 * 0.05));
    expect(run.moved['2026-09']).toBe(Math.round(80_000 / 12));
    expect(run.posted?.['2026']).toBeCloseTo(38_588 * 0.05, 6);
  });

  it('never claws back a bonus edited down, and posts again only past what was posted', () => {
    const due = (amount: number) => otpBonusDue(600_000, amount ? [{ ...MARCH_BONUS, amount }] : [], 5, '2026-06', { '2026': 5_000 });
    expect(due(0)).toEqual({ '2026': 0 });
    expect(due(60_000)).toEqual({ '2026': 0 });
    expect(due(150_000)).toEqual({ '2026': 2_500 });
  });

  it('settles a December bonus entered in January, but only for a year it tracked', () => {
    const dec: Bonus = { date: '2025-12-20', amount: 100_000, type: 'annual' };
    expect(otpBonusDue(600_000, [dec], 5, '2026-02', { '2025': 0, '2026': 0 })).toEqual({ '2025': 5_000, '2026': 0 });
    expect(otpBonusDue(600_000, [dec], 5, '2026-02', { '2026': 0 })).toEqual({ '2026': 0 });
  });

  it('counts bonuses earned before auto-post was switched on as already in the balance', () => {
    const baseline = otpBonusBaseline(600_000, [MARCH_BONUS, { date: '2025-06-01', amount: 20_000, type: 'annual' }], 5, '2026-05');
    expect(baseline).toEqual({ '2025': 1_000, '2026': 5_000 });
    const run = simulate({
      from: '2026-06', to: '2026-12', lastPosted: '2026-05', posted: baseline, bonusesAt: () => [MARCH_BONUS],
    });
    expect(run.total).toBe(7 * 2_500);
  });

  it('keeps only this year and last year in the record', () => {
    expect(addOtpBonusPosted({ '2024': 9, '2025': 1_000, '2026': 500 }, { '2026': 200 }, '2026-04'))
      .toEqual({ '2025': 1_000, '2026': 700 });
  });

  it('prices each month of a catch-up across New Year on its own year', () => {
    const rule = pensionAccrualRules(input({ ...base, pensionableIncome: 2_000_000,
      otpLastPostedMonth: '2025-11', currentMonth: '2026-01' }), LABELS)[0];
    expect(rule.amount).toBeCloseTo(12 * 136_549 * 0.05 / 12, 6);
    expect(rule.amountByMonth).toEqual({ '2025-12': 12 * 130_160 * 0.05 / 12 });
  });
});

describe('isPensionRuleId', () => {
  it('recognises the two synthesized ids and nothing else', () => {
    expect(isPensionRuleId('pension:otp')).toBe(true);
    expect(isPensionRuleId('pension:ips')).toBe(true);
    expect(isPensionRuleId('some-expense-id')).toBe(false);
  });
});

describe('switching auto-post on', () => {
  const pension = {
    otpAutoPost: false, ipsAutoPost: false, otpEmployerPct: 5, otpEmployeePct: 0, otpIncludesBonuses: true,
    otpLastPostedMonth: '2026-02', ipsLastPostedMonth: '2026-02', otpBonusPostedByYear: { '2026': 0 },
  };
  const bonuses = [{ date: '2026-03-25', amount: 100_000, type: 'annual' as const }];

  it('re-stamps to this month with a fresh bonus baseline, so the months it was off are not caught up', () => {
    const otp = switchAutoPostOn(pension, 'otp', 600_000, bonuses, '2026-07');
    expect(otp.otpAutoPost).toBe(true);
    expect(otp.otpLastPostedMonth).toBe('2026-07');
    expect(otp.otpBonusPostedByYear).toEqual({ '2025': 0, '2026': 5_000 });
    const [rule] = pensionAccrualRules(input({
      ...otp, ipsAutoPost: false, pensionableIncome: 600_000, otpIncludesBonuses: true, bonuses, currentMonth: '2026-08',
    }), LABELS);
    expect(rule.amountByMonth).toBeUndefined();
    expect(rule.amount).toBe(2_500);
    expect(rule.lastPostedMonth).toBe('2026-07');
  });

  it('keeps a stamp already at this month and its bonus record, so a quick off/on swallows nothing', () => {
    const posted = { ...pension, otpLastPostedMonth: '2026-07', otpBonusPostedByYear: { '2026': 0 } };
    const otp = switchAutoPostOn({ ...posted, otpAutoPost: false }, 'otp', 600_000, bonuses, '2026-07');
    expect(otp.otpAutoPost).toBe(true);
    expect(otp.otpLastPostedMonth).toBe('2026-07');
    expect(otp.otpBonusPostedByYear).toEqual({ '2026': 0 });
    // The March bonus entered since July posted still lands in August.
    const [rule] = pensionAccrualRules(input({
      ...otp, ipsAutoPost: false, pensionableIncome: 600_000, otpIncludesBonuses: true, bonuses, currentMonth: '2026-08',
    }), LABELS);
    expect(rule.amountByMonth).toEqual({ '2026-08': 2_500 + 5_000 });
    const ips = switchAutoPostOn({ ...pension, ipsLastPostedMonth: '2026-07' }, 'ips', 600_000, bonuses, '2026-07');
    expect(ips.ipsLastPostedMonth).toBe('2026-07');
  });

  it('re-stamps IPS and leaves OTP alone', () => {
    const ips = switchAutoPostOn(pension, 'ips', 600_000, bonuses, '2026-07');
    expect(ips.ipsLastPostedMonth).toBe('2026-07');
    expect(ips.otpLastPostedMonth).toBe('2026-02');
    expect(ips.otpBonusPostedByYear).toEqual({ '2026': 0 });
  });

  it('a loaded pension already stamped, or switched off, is returned unchanged', () => {
    expect(stampUnstampedAutoPost(pension, 600_000, bonuses, '2026-07')).toBe(pension);
    const on = { ...pension, otpAutoPost: true, ipsAutoPost: true };
    expect(stampUnstampedAutoPost(on, 600_000, bonuses, '2026-07')).toBe(on);
  });
});

describe('pensionAccrualRules — OTP overtime and the scheme\'s job', () => {
  const base = { ipsAutoPost: false, otpEmployerPct: 5, otpEmployeePct: 0, pensionableIncome: 600_000 };
  const overtime = [{ date: '2026-03-10', amount: 20_000, jobId: 'a' }];
  const bonuses = [{ date: '2026-03-25', amount: 100_000, type: 'annual' as const, jobId: 'b' }];
  const due = { otpBonusPostedByYear: { '2026': 0 }, otpLastPostedMonth: '2026-02', currentMonth: '2026-03' };

  it('posts the overtime share in its month when the scheme counts overtime', () => {
    const [rule] = pensionAccrualRules(input({ ...base, ...due, otpIncludesOvertime: true, overtime }), LABELS);
    expect(rule.amountByMonth).toEqual({ '2026-03': 2_500 + 1_000 });   // 20 000 × 5%
    expect(rule.otpBonusByYear).toEqual({ '2026': 1_000 });
  });

  it('posts nothing for overtime with the setting off, but keeps the year tracked', () => {
    const [rule] = pensionAccrualRules(input({ ...base, ...due, overtime }), LABELS);
    expect(rule.amountByMonth).toBeUndefined();
    expect(rule.otpBonusByYear).toEqual({ '2026': 0 });
  });

  it('with a job linked, posts only that job\'s bonuses and overtime', () => {
    const scheme = { otpIncludesBonuses: true, otpIncludesOvertime: true };
    const all = pensionAccrualRules(input({ ...base, ...due, ...scheme, overtime, bonuses }), LABELS)[0];
    expect(all.otpBonusByYear).toEqual({ '2026': 6_000 });
    const onlyA = pensionAccrualRules(input({ ...base, ...due, ...scheme, otpJobId: 'a', overtime, bonuses }), LABELS)[0];
    expect(onlyA.otpBonusByYear).toEqual({ '2026': 1_000 });
  });
});

describe('switching auto-post on — overtime', () => {
  const pension: Parameters<typeof switchAutoPostOn>[0] = { otpAutoPost: false, ipsAutoPost: false, otpEmployerPct: 5, otpEmployeePct: 0 };
  const bonuses = [{ date: '2026-03-25', amount: 100_000, type: 'annual' as const }];
  const earlyOvertime = { date: '2026-04-10', amount: 20_000 };
  const lateOvertime = { date: '2026-09-10', amount: 40_000 };

  it('counts overtime earned before switching on as in the balance when the scheme counts it', () => {
    const otp = switchAutoPostOn({ ...pension, otpIncludesOvertime: true, otpIncludesBonuses: true }, 'otp', 600_000, bonuses, '2026-07', [earlyOvertime]);
    expect(otp.otpBonusPostedByYear).toEqual({ '2025': 0, '2026': 6_000 });
  });

  it('an overtime-only scheme leaves bonuses out of the baseline, so they do not hold back overtime posts', () => {
    const otp = switchAutoPostOn({ ...pension, otpIncludesOvertime: true }, 'otp', 600_000, bonuses, '2026-07', [earlyOvertime]);
    expect(otp.otpBonusPostedByYear).toEqual({ '2025': 0, '2026': 1_000 });
    const [rule] = pensionAccrualRules(input({
      ...otp, ipsAutoPost: false, pensionableIncome: 600_000, otpIncludesOvertime: true,
      bonuses, overtime: [earlyOvertime, lateOvertime], currentMonth: '2026-09', otpLastPostedMonth: '2026-08',
    }), LABELS);
    expect(rule.otpBonusByYear).toEqual({ '2025': 0, '2026': 2_000 }); // 40 000 × 5%
  });

  it('the baseline counts only what the scheme counts', () => {
    expect(switchAutoPostOn(pension, 'otp', 600_000, bonuses, '2026-07', [earlyOvertime]).otpBonusPostedByYear)
      .toEqual({ '2025': 0, '2026': 0 });
    expect(switchAutoPostOn({ ...pension, otpIncludesBonuses: true }, 'otp', 600_000, bonuses, '2026-07', [earlyOvertime]).otpBonusPostedByYear)
      .toEqual({ '2025': 0, '2026': 5_000 });
  });

  it('a loaded pension takes its baseline from the loaded overtime', () => {
    const defaults: Pension = {
      otpBalance: 0, otpEmployerPct: 5, otpEmployeePct: 0, otpGrowthRate: 5, otpIncludesBonuses: false, otpIncludesOvertime: false,
      ipsBalance: 0, ipsAnnualContribution: 0, ipsGrowthRate: 7, birthYear: 0, retirementAge: 67, folketrygdBeholdning: 0,
      folketrygdSingle: true, pensionPayoutYears: 10, afpEligible: false, otpAutoPost: false, ipsAutoPost: false,
    };
    const data = {
      pension: { ...defaults, otpAutoPost: true, otpIncludesOvertime: true },
      salaries: [{ id: 's', jobId: 'a', effectiveDate: '2026-01', grossAnnual: 600_000, changeType: 'initial' as const }],
      jobs: [{ id: 'a', startDate: '2026-01', endDate: null, employer: 'E', role: 'R', contractedHoursPerWeek: 37.5 }],
      overtime: [{ id: 'o', date: '2026-04-10', hours: 10, amount: 20_000 }],
    };
    const out = stampLoadedPension(data, undefined, defaults, '2026-07');
    expect(out.pension?.otpBonusPostedByYear).toEqual({ '2025': 0, '2026': 1_000 });
  });
});

describe('changing the OTP base settings while auto-post runs', () => {
  type P = Parameters<typeof changeOtpScheme>[0];
  const start: P = { otpAutoPost: false, ipsAutoPost: false, otpEmployerPct: 5, otpEmployeePct: 0 };
  const JOBS = [{ id: 'a' }, { id: 'b' }];
  /** The OTP rule's extra (bonus and overtime) share for `month`, per year. */
  const extra = (p: P, bonuses: Parameters<typeof changeOtpScheme>[3], overtime: Parameters<typeof changeOtpScheme>[4], month: string) =>
    pensionAccrualRules(input({
      ...p, otpAutoPost: true, ipsAutoPost: false, pensionableIncome: 600_000, bonuses, overtime, currentMonth: month,
    }), LABELS)[0].otpBonusByYear;

  it('turning overtime on does not back-post overtime from months already posted', () => {
    const overtime = [{ date: '2025-10-10', amount: 40_000 }, { date: '2026-03-10', amount: 20_000 }];
    const on = switchAutoPostOn(start, 'otp', 600_000, [], '2026-05', overtime);
    expect(on.otpBonusPostedByYear).toEqual({ '2025': 0, '2026': 0 });
    const changed = changeOtpScheme(on, { otpIncludesOvertime: true }, 600_000, [], overtime, JOBS, '2026-06');
    expect(extra(changed, [], overtime, '2026-06')).toEqual({ '2025': 0, '2026': 0 });
    // Overtime dated after the stamp still posts in full.
    const later = [...overtime, { date: '2026-06-10', amount: 20_000 }];
    expect(extra(changed, [], later, '2026-06')).toEqual({ '2025': 0, '2026': 1_000 });
  });

  it('turning bonuses on after an overtime-only start does not back-post earlier bonuses', () => {
    const bonuses = [{ date: '2026-03-25', amount: 100_000, type: 'annual' as const }];
    const overtime = [{ date: '2026-04-10', amount: 20_000 }];
    const on = switchAutoPostOn({ ...start, otpIncludesOvertime: true }, 'otp', 600_000, bonuses, '2026-05', overtime);
    const changed = changeOtpScheme(on, { otpIncludesBonuses: true }, 600_000, bonuses, overtime, JOBS, '2026-06');
    expect(extra(changed, bonuses, overtime, '2026-06')).toEqual({ '2025': 0, '2026': 0 });
    const later = [...bonuses, { date: '2026-08-25', amount: 40_000, type: 'annual' as const }];
    expect(extra(changed, later, overtime, '2026-08')).toEqual({ '2025': 0, '2026': 2_000 });
  });

  it('changing the job link does not back-post the other job\'s earlier pay', () => {
    const bonuses = [{ date: '2026-03-25', amount: 100_000, type: 'annual' as const, jobId: 'b' }];
    const on = switchAutoPostOn({ ...start, otpIncludesBonuses: true, otpJobId: 'a' }, 'otp', 600_000, bonuses, '2026-05');
    expect(on.otpBonusPostedByYear).toEqual({ '2025': 0, '2026': 0 });
    const cleared = changeOtpScheme(on, { otpJobId: undefined }, 600_000, bonuses, [], JOBS, '2026-06');
    expect(cleared.otpJobId).toBeUndefined();
    expect(extra(cleared, bonuses, [], '2026-06')).toEqual({ '2025': 0, '2026': 0 });
  });

  it('keeps a share the old settings still owed (a late entry) owed', () => {
    // Bonuses on, stamped May with nothing posted; an April bonus entered late is owed 5 000.
    const posted: P = {
      ...start, otpAutoPost: true, otpIncludesBonuses: true, otpLastPostedMonth: '2026-05', otpBonusPostedByYear: { '2026': 0 },
    };
    const bonuses = [{ date: '2026-04-25', amount: 100_000, type: 'annual' as const }];
    const changed = changeOtpScheme(posted, { otpIncludesOvertime: true }, 600_000, bonuses, [], JOBS, '2026-06');
    expect(extra(changed, bonuses, [], '2026-06')).toEqual({ '2026': 5_000 });
  });

  it('leaves the record alone while auto-post is off', () => {
    const off: P = { ...start, otpBonusPostedByYear: { '2026': 7 }, otpLastPostedMonth: '2026-05' };
    const changed = changeOtpScheme(off, { otpIncludesOvertime: true }, 600_000, [], [], JOBS, '2026-06');
    expect(changed.otpIncludesOvertime).toBe(true);
    expect(changed.otpBonusPostedByYear).toEqual({ '2026': 7 });
  });

  it('removing the linked job clears the link from the next unposted month on', () => {
    const bonuses = [{ date: '2026-03-25', amount: 100_000, type: 'annual' as const, jobId: 'b' }];
    const on = switchAutoPostOn({ ...start, otpIncludesBonuses: true, otpJobId: 'a' }, 'otp', 600_000, bonuses, '2026-05');
    const removed = pensionAfterJobRemoved(on, 'a', 600_000, bonuses, [], JOBS, '2026-06');
    expect(removed.otpJobId).toBeUndefined();
    expect(extra(removed, bonuses, [], '2026-06')).toEqual({ '2025': 0, '2026': 0 });
    expect(pensionAfterJobRemoved(on, 'b', 600_000, bonuses, [], JOBS, '2026-06')).toBe(on);
  });
});
