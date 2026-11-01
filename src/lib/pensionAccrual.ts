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
import { otpAnnualContribution, otpBonusShareToDate, otpCountedPay, otpSchemeFor, type OtpBaseScheme, type OtpPay } from './pension';
import type { BonusEntry, ExportPayload, OvertimeEntry, Pension } from '../context/FinanceContext';
import { activeJobBreakdown } from './salary';

type OtpBonus = Pick<BonusEntry, 'date' | 'amount' | 'type' | 'jobId'>;
type OtpOvertime = Pick<OvertimeEntry, 'date' | 'amount' | 'jobId'>;

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
  /** The scheme counts overtime in the OTP base (`Pension.otpIncludesOvertime`). */
  otpIncludesOvertime?: boolean;
  /** The scheme's job (`Pension.otpJobId`): only its bonuses and overtime count. */
  otpJobId?: string;
  /** Bonus entries; their OTP share posts once the month they are dated is due. */
  bonuses?: readonly OtpBonus[];
  /** Overtime entries, posted like bonuses. */
  overtime?: readonly OtpOvertime[];
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
  // Overtime the scheme counts settles the same way, in the same record. With
  // neither counted nothing extra posts, but the years stay tracked (0 added).
  // A change to which pay counts rebases the record (`changeOtpScheme`), so it
  // applies from the next unposted month on. The caller resolves the job link
  // (`otpSchemeFor`).
  const counted = otpCountedPay(input.bonuses ?? [], input.overtime ?? [], input);
  const bonusByYear = otpBonusDue(input.pensionableIncome, counted, otpPct, input.currentMonth, input.otpBonusPostedByYear);
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
  bonuses: readonly OtpPay[],
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
 * the user entered, so only bonuses from here on post. `bonuses` is the pay to
 * count (see `stampUnstampedAutoPost` for which).
 */
export function otpBonusBaseline(
  fixedGross: number,
  bonuses: readonly OtpPay[],
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
 *
 * The baseline is the share of the pay the scheme counts now (`pension`'s
 * settings, with the job link already resolved by the caller via
 * `otpSchemeFor`). A later change to those settings rebases the record through
 * `changeOtpScheme`, so nothing needs counting "as if" here.
 */
export function stampUnstampedAutoPost<P extends OtpBaseScheme & {
  otpAutoPost?: boolean; ipsAutoPost?: boolean; otpEmployerPct: number; otpEmployeePct: number;
  otpLastPostedMonth?: string; ipsLastPostedMonth?: string; otpBonusPostedByYear?: Record<string, number>;
}>(
  pension: P,
  fixedGross: number,
  bonuses: readonly OtpBonus[],
  month: string,
  overtime: readonly OtpOvertime[] = [],
): P {
  const otp = pension.otpAutoPost === true && !pension.otpLastPostedMonth;
  const ips = pension.ipsAutoPost === true && !pension.ipsLastPostedMonth;
  if (!otp && !ips) return pension;
  const baselinePay = otpCountedPay(bonuses, overtime, pension);
  return {
    ...pension,
    ...(otp ? {
      otpLastPostedMonth: month,
      otpBonusPostedByYear: otpBonusBaseline(fixedGross, baselinePay, pension.otpEmployerPct + pension.otpEmployeePct, month),
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
  overtime: readonly OtpOvertime[] = [],
): P {
  if (target === 'otp') {
    const on = { ...pension, otpAutoPost: true };
    if (pension.otpLastPostedMonth === month) return on;
    return stampUnstampedAutoPost({ ...on, otpLastPostedMonth: undefined }, fixedGross, bonuses, month, overtime);
  }
  const on = { ...pension, ipsAutoPost: true };
  if (pension.ipsLastPostedMonth === month) return on;
  return stampUnstampedAutoPost({ ...on, ipsLastPostedMonth: undefined }, fixedGross, bonuses, month, overtime);
}

/**
 * The pension after changing its OTP base settings (`patch`: bonuses, overtime,
 * the job link) in `month`. The change applies from the next unposted month on:
 * while OTP auto-post is on and stamped, `otpBonusPostedByYear` is rebased so pay
 * dated in a month already posted (up to `otpLastPostedMonth`) counts as settled
 * under the new settings, which neither back-posts pay the balance already holds
 * nor holds back pay dated after the stamp. A share the old settings still owed
 * for those months (a late entry not yet posted) stays owed. Each year's record
 * becomes the new settings' share of pay through the stamp less that owed share,
 * floored at 0. Bonuses and overtime share the 12G room above fixed pay as one
 * pool, so there is no per-kind split to keep. `jobs` resolves the job link
 * before and after (see `otpSchemeFor`). With auto-post off the settings just
 * change; switching it on takes a fresh baseline anyway.
 */
export function changeOtpScheme<P extends Parameters<typeof stampUnstampedAutoPost>[0]>(
  pension: P,
  patch: OtpBaseScheme,
  fixedGross: number,
  bonuses: readonly OtpBonus[],
  overtime: readonly OtpOvertime[],
  jobs: readonly { id: string }[],
  month: string,
): P {
  const next = { ...pension, ...patch };
  const stamp = pension.otpLastPostedMonth;
  if (pension.otpAutoPost !== true || !stamp) return next;
  const pct = pension.otpEmployerPct + pension.otpEmployeePct;
  const oldPay = otpCountedPay(bonuses, overtime, otpSchemeFor(pension, jobs));
  const newPay = otpCountedPay(bonuses, overtime, otpSchemeFor(next, jobs));
  const year = Number(month.slice(0, 4));
  const record: Record<string, number> = {};
  for (const y of [year - 1, year]) {
    const posted = postedFor(pension.otpBonusPostedByYear, y);
    if (y < year && posted === undefined) continue;   // last year untracked: nothing settles
    // Months of year y already posted: through the stamp, or none before it.
    const through = stamp < `${y}-01` ? undefined : (stamp < `${y}-12` ? stamp : `${y}-12`);
    const share = (pay: readonly OtpPay[]) => (through ? otpBonusShareToDate(fixedGross, pay, pct, through) : 0);
    const owedOld = Math.max(0, share(oldPay) - (posted ?? 0));
    record[String(y)] = Math.max(0, share(newPay) - owedOld);
  }
  return { ...next, otpBonusPostedByYear: record };
}

/**
 * The pension after the job `jobId` is removed: a scheme linked to that job
 * falls back to every job's pay, applied as a settings change (`changeOtpScheme`,
 * with `jobs` as they were before the removal). Any other pension is returned as is.
 */
export function pensionAfterJobRemoved<P extends Parameters<typeof stampUnstampedAutoPost>[0]>(
  pension: P,
  jobId: string,
  fixedGross: number,
  bonuses: readonly OtpBonus[],
  overtime: readonly OtpOvertime[],
  jobs: readonly { id: string }[],
  month: string,
): P {
  if (pension.otpJobId !== jobId) return pension;
  return changeOtpScheme(pension, { otpJobId: undefined }, fixedGross, bonuses, overtime, jobs, month);
}

type LoadSlice = Pick<ExportPayload, 'pension' | 'salaries' | 'jobs' | 'bonuses' | 'overtime'>;

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
  const overtime = data.overtime ?? current?.overtime ?? [];
  const fixedGross = activeJobBreakdown(salaries, jobs, month).reduce((s, c) => s + c.gross, 0);
  const resolved = otpSchemeFor(merged, jobs);
  const stamped = stampUnstampedAutoPost(resolved, fixedGross, bonuses, month, overtime);
  if (stamped === resolved) return data;
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
