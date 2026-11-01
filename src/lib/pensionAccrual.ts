// Pension contributions as automation rules.
//
// OTP and IPS both add to a balance every month, but neither passes through the
// budget: OTP is paid by the employer, and IPS is configured as a yearly figure
// on the Pension page. So they can't be modelled as destination-bearing fixed
// expenses like a savings transfer or a mortgage paydown. This module projects
// them onto the same `AutomationRule` shape instead, so the one runner in
// automation.ts posts them with the same double-apply guard, catch-up prompt and
// stacking behaviour as everything else.
//
// Only CONTRIBUTIONS are expressed here — never the assumed growth rates
// (`otpGrowthRate`/`ipsGrowthRate`). A contribution is a known amount; a return
// is a guess, and compounding a guess into a stored balance would launder it
// into recorded net worth (and then into `balanceSnapshots`, permanently).
// Growth stays where it belongs: in the projection on the Pension page.
import { addMonthsKey } from './date';
import type { AutomationRule } from './automation';
import { otpAnnualContribution, otpBonusShareToDate } from './pension';
import type { BonusEntry, ExportPayload, Pension } from '../context/FinanceContext';
import { activeJobBreakdown } from './salary';

type OtpBonus = Pick<BonusEntry, 'date' | 'amount' | 'type'>;

export const PENSION_OTP_RULE_ID = 'pension:otp';
export const PENSION_IPS_RULE_ID = 'pension:ips';

/** True for a rule id this module owns (routes stamping away from fixedExpenses). */
export function isPensionRuleId(id: string): boolean {
  return id === PENSION_OTP_RULE_ID || id === PENSION_IPS_RULE_ID;
}

export interface PensionAccrualInput {
  /** Per-target opt-in. Both default false — nothing posts until the user says so. */
  otpAutoPost: boolean;
  ipsAutoPost: boolean;
  otpEmployerPct: number;
  otpEmployeePct: number;
  /** kr/year, already clamped to the NAV deduction cap by the caller. */
  ipsAnnualContribution: number;
  otpLastPostedMonth?: string;
  ipsLastPostedMonth?: string;
  /** Gross annual fixed pay (salary + on-call) across active jobs. */
  pensionableIncome: number;
  /** The scheme counts bonuses in the OTP base (`Pension.otpIncludesBonuses`). */
  otpIncludesBonuses?: boolean;
  /** Bonus entries; their OTP share posts once the month they are dated is due. */
  bonuses?: readonly OtpBonus[];
  /** `Pension.otpBonusPostedByYear`: bonus share already in the balance, per year. */
  otpBonusPostedByYear?: Record<string, number>;
  currentMonth: string;
}

/** Display names for the catch-up prompt, passed in so this stays i18n-free. */
export interface PensionAccrualLabels {
  otp: string;
  ips: string;
}

/**
 * The enabled pension contributions as automation rules, newest state only.
 * A rule with a non-positive monthly amount is omitted rather than posted as a
 * no-op: a 0% OTP rate or an unset salary means there is nothing to record, and
 * an omitted rule leaves `lastPostedMonth` untouched so it resumes cleanly once
 * the salary or the percentage is filled in.
 *
 * `startMonth` is a fallback only — enabling a toggle stamps `lastPostedMonth`
 * to the current month, so the first post lands the month after. It resolves to
 * next month so an unstamped rule (imported data) can never back-post a jump.
 */
export function pensionAccrualRules(
  input: PensionAccrualInput,
  labels: PensionAccrualLabels,
): AutomationRule[] {
  const startMonth = addMonthsKey(input.currentMonth, 1);
  const rules: AutomationRule[] = [];

  // Fixed pay posts a twelfth of the yearly contribution every month, each due
  // month on its own year's 12G cap, so a catch-up across New Year is right.
  // Bonuses are settled against what was already posted for their year
  // (`otpBonusPostedByYear`): the newest due month carries whatever bonus share
  // is earned to date and not yet posted. A bonus entered after its month was
  // posted, or dated back, lands in the next posting; nothing posts twice; and
  // a bonus edited down or deleted is never clawed back, it only holds further
  // bonus posts until the share to date passes what was posted.
  const otpPct = input.otpEmployerPct + input.otpEmployeePct;
  const fixedMonthly = (m: string) => otpAnnualContribution(input.pensionableIncome, otpPct, Number(m.slice(0, 4))) / 12;
  const otpMonthly = fixedMonthly(input.currentMonth);
  const otpByMonth: Record<string, number> = {};
  const from = input.otpLastPostedMonth ? addMonthsKey(input.otpLastPostedMonth, 1) : startMonth;
  for (let m = from; m < input.currentMonth; m = addMonthsKey(m, 1)) {
    const amount = fixedMonthly(m);
    if (amount !== otpMonthly) otpByMonth[m] = amount;
  }
  // With the setting off nothing bonus-related posts, but the years stay
  // tracked (0 added), so turning the setting on in January still settles last
  // year's bonuses, a December one included.
  const due = otpBonusDue(input.pensionableIncome, input.bonuses ?? [], otpPct, input.currentMonth, input.otpBonusPostedByYear);
  const bonusByYear = input.otpIncludesBonuses === true
    ? due
    : Object.fromEntries(Object.keys(due).map(y => [y, 0]));
  const bonusDue = Object.values(bonusByYear).reduce((a, b) => a + b, 0);
  if (bonusDue > 0) otpByMonth[input.currentMonth] = otpMonthly + bonusDue;
  if (input.otpAutoPost && (otpMonthly > 0 || bonusDue > 0)) {
    rules.push({
      id: PENSION_OTP_RULE_ID,
      name: labels.otp,
      amount: otpMonthly,
      ...(Object.keys(otpByMonth).length ? { amountByMonth: otpByMonth } : {}),
      ...(Object.keys(bonusByYear).length ? { otpBonusByYear: bonusByYear } : {}),
      targetKind: 'pensionOtp',
      startMonth,
      lastPostedMonth: input.otpLastPostedMonth,
    });
  }

  const ipsMonthly = input.ipsAnnualContribution / 12;
  if (input.ipsAutoPost && ipsMonthly > 0) {
    rules.push({
      id: PENSION_IPS_RULE_ID,
      name: labels.ips,
      amount: ipsMonthly,
      targetKind: 'pensionIps',
      startMonth,
      lastPostedMonth: input.ipsLastPostedMonth,
    });
  }

  return rules;
}

const postedFor = (posted: Record<string, number> | undefined, year: number): number | undefined => {
  const v = posted?.[String(year)];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};

/**
 * Bonus share to post in `month`, per contribution year: this year's share to
 * date less what was posted for it (none recorded = nothing yet), and last
 * year's full share less what was posted for it, so a December bonus entered in
 * January still lands. Last year settles only when it has a record, so turning
 * the setting on never back-posts a year the rule never tracked. A year whose
 * posted figure is ahead (a bonus edited down) adds nothing. Years with nothing
 * due are kept with 0 so the stamp starts tracking them.
 */
export function otpBonusDue(
  fixedGross: number,
  bonuses: readonly OtpBonus[],
  totalPct: number,
  month: string,
  posted: Record<string, number> | undefined,
): Record<string, number> {
  const year = Number(month.slice(0, 4));
  const out: Record<string, number> = {
    [String(year)]: Math.max(0, otpBonusShareToDate(fixedGross, bonuses, totalPct, month) - (postedFor(posted, year) ?? 0)),
  };
  const prev = postedFor(posted, year - 1);
  if (prev !== undefined) {
    out[String(year - 1)] = Math.max(0, otpBonusShareToDate(fixedGross, bonuses, totalPct, `${year - 1}-12`) - prev);
  }
  return out;
}

/**
 * `otpBonusPostedByYear` when OTP auto-post is switched on in `month`: the bonus
 * share already earned this year and last year counts as already in the balance
 * the user entered, so only bonuses from here on post. Counted as if the scheme
 * includes bonuses, so turning that setting on later does not back-post them.
 */
export function otpBonusBaseline(
  fixedGross: number,
  bonuses: readonly OtpBonus[],
  totalPct: number,
  month: string,
): Record<string, number> {
  const year = Number(month.slice(0, 4));
  return {
    [String(year - 1)]: otpBonusShareToDate(fixedGross, bonuses, totalPct, `${year - 1}-12`),
    [String(year)]: otpBonusShareToDate(fixedGross, bonuses, totalPct, month),
  };
}

/**
 * The new `otpBonusPostedByYear` after an OTP posting in `month` that carried
 * `byYear`: each year's posted figure grows by what was posted, and only this
 * year and last year are kept (older years can no longer settle).
 */
export function addOtpBonusPosted(
  posted: Record<string, number> | undefined,
  byYear: Record<string, number>,
  month: string,
): Record<string, number> {
  const year = Number(month.slice(0, 4));
  const out: Record<string, number> = {};
  for (const y of [year - 1, year]) {
    const before = postedFor(posted, y);
    const add = byYear[String(y)];
    if (before === undefined && add === undefined) continue;
    out[String(y)] = (before ?? 0) + (add ?? 0);
  }
  return out;
}

/**
 * A loaded pension with auto-post on but never stamped (saved before switching
 * on stamped the month) would never post: an unstamped rule's start month is
 * always next month. Stamp it to `month` the way switching on does, with the
 * bonus baseline for OTP, so the first post lands next month and nothing
 * back-posts. Anything already stamped, or switched off, is returned as is.
 */
export function stampUnstampedAutoPost<P extends {
  otpAutoPost?: boolean; ipsAutoPost?: boolean; otpEmployerPct: number; otpEmployeePct: number;
  otpLastPostedMonth?: string; ipsLastPostedMonth?: string; otpBonusPostedByYear?: Record<string, number>;
}>(
  pension: P,
  fixedGross: number,
  bonuses: readonly OtpBonus[],
  month: string,
): P {
  const otp = pension.otpAutoPost === true && !pension.otpLastPostedMonth;
  const ips = pension.ipsAutoPost === true && !pension.ipsLastPostedMonth;
  if (!otp && !ips) return pension;
  return {
    ...pension,
    ...(otp ? {
      otpLastPostedMonth: month,
      otpBonusPostedByYear: otpBonusBaseline(fixedGross, bonuses, pension.otpEmployerPct + pension.otpEmployeePct, month),
    } : {}),
    ...(ips ? { ipsLastPostedMonth: month } : {}),
  };
}

/**
 * The pension after switching `target` auto-post on in `month`. A switch-on
 * re-stamps to `month` (and, for OTP, takes a fresh bonus baseline), as a fixed
 * expense does when it resumes: the months it was off are not caught up, since
 * the balance is the user's to keep right while it is off. A stamp already at
 * `month` is kept with its bonus record, so a quick off/on within the month
 * can't swallow a bonus added since the last posting.
 */
export function switchAutoPostOn<P extends Parameters<typeof stampUnstampedAutoPost>[0]>(
  pension: P,
  target: 'otp' | 'ips',
  fixedGross: number,
  bonuses: readonly OtpBonus[],
  month: string,
): P {
  if (target === 'otp') {
    const on = { ...pension, otpAutoPost: true };
    if (pension.otpLastPostedMonth === month) return on;
    return stampUnstampedAutoPost({ ...on, otpLastPostedMonth: undefined }, fixedGross, bonuses, month);
  }
  const on = { ...pension, ipsAutoPost: true };
  if (pension.ipsLastPostedMonth === month) return on;
  return stampUnstampedAutoPost({ ...on, ipsLastPostedMonth: undefined }, fixedGross, bonuses, month);
}

type LoadSlice = Pick<ExportPayload, 'pension' | 'salaries' | 'jobs' | 'bonuses'>;

/**
 * Load/import step: a `data.pension` with auto-post on but never stamped is
 * stamped to `month` (see `stampUnstampedAutoPost`). The bonus baseline reads
 * the pay and bonuses the app will hold after this load: `data`'s where it
 * carries them, else `current`'s (an import of only some sections overlays the
 * current state). Returns `data` itself when there is nothing to stamp.
 */
export function stampLoadedPension<D extends Partial<LoadSlice>>(
  data: D,
  current: Partial<LoadSlice> | undefined,
  defaults: Pension,
  month: string,
): D {
  if (!data.pension) return data;
  const merged = { ...defaults, ...data.pension };
  const salaries = data.salaries ?? current?.salaries ?? [];
  const jobs = data.jobs ?? current?.jobs ?? [];
  const bonuses = data.bonuses ?? current?.bonuses ?? [];
  const fixedGross = activeJobBreakdown(salaries, jobs, month).reduce((s, c) => s + c.gross, 0);
  const stamped = stampUnstampedAutoPost(merged, fixedGross, bonuses, month);
  if (stamped === merged) return data;
  const { otpLastPostedMonth, ipsLastPostedMonth, otpBonusPostedByYear } = stamped;
  return {
    ...data,
    pension: {
      ...data.pension,
      ...(otpLastPostedMonth !== merged.otpLastPostedMonth ? { otpLastPostedMonth, otpBonusPostedByYear } : {}),
      ...(ipsLastPostedMonth !== merged.ipsLastPostedMonth ? { ipsLastPostedMonth } : {}),
    },
  };
}
