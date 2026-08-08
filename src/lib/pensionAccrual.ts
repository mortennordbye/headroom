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
  /** Gross annual pensionable income across active jobs. */
  pensionableIncome: number;
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

  const otpMonthly = input.pensionableIncome * (input.otpEmployerPct + input.otpEmployeePct) / 100 / 12;
  if (input.otpAutoPost && otpMonthly > 0) {
    rules.push({
      id: PENSION_OTP_RULE_ID,
      name: labels.otp,
      amount: otpMonthly,
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
