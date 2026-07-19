// Ny AFP (privat sektor) estimate for cohorts born 1963 or later. Pure +
// unit-tested. AFP livsvarig is a lifelong supplement on top of folketrygd, so it
// reuses folketrygd's 7.1G income cap and delingstall (levealdersjustering).
//
// Model:
//   - The lifelong AFP is 0.314% of the "pensjonsgrunnlag" — the sum of yearly
//     pensionable income (capped at 7.1G) through the year you turn 61.
//   - That base amount is then levealdersjustert by birth cohort and withdrawal
//     age. We apply the same delingstall mechanism folketrygd uses, anchored so a
//     1963 cohort withdrawing at 67 is the reference (factor 1.0): later cohorts
//     (higher delingstall) get less, later withdrawal (lower delingstall) gets more.
//
// Eligibility is NOT modelled from data (it depends on working in an AFP-bedrift
// and meeting the ansiennitet rules at 62); the user self-certifies with a toggle.
// AFP is pensjonsinntekt, so drawdown tax uses calcPensionIncomeTax like the rest.
//
// Simplifications (disclosed in-UI, deliberate): pensjonsgrunnlag is estimated
// from today's income held flat across a full career to 61; the levealdersjustering
// reuses folketrygd delingstall rather than NAV's separate AFP forholdstall table;
// the kompensasjonstillegg for cohorts born before 1963 is not modelled (this is
// the ny-AFP model for 1963+).

import { delingstall, folketrygdParamsFor, ACCRUAL_CAP_G } from './folketrygd';

export const AFP_RATE = 0.00314;      // 0.314% of pensjonsgrunnlag
export const AFP_ACCRUAL_END_AGE = 61; // income counts through the year you turn 61
export const AFP_DEFAULT_WORK_START_AGE = 22;
// Reference point at which the 0.314% base applies unadjusted: 1963 cohort at 67.
export const AFP_REFERENCE_DELINGSTALL = delingstall(1963, 67);

/**
 * Estimated pensjonsgrunnlag: yearly pensionable income (capped at 7.1G) summed
 * over a full career from `workStartAge` through age 61, with income held flat at
 * today's level. Coarse by nature — a real grunnlag reflects a varying salary
 * history — but it gives an honest ballpark.
 */
export function estimateAfpGrunnlag(params: {
  birthYear: number;
  annualIncome: number;
  year: number;
  workStartAge?: number;
}): number {
  const { birthYear, annualIncome, year, workStartAge = AFP_DEFAULT_WORK_START_AGE } = params;
  if (birthYear <= 1900) return 0;
  const P = folketrygdParamsFor(year);
  const capped = Math.min(Math.max(0, annualIncome), ACCRUAL_CAP_G * P.grunnbelop);
  const careerYears = Math.max(0, AFP_ACCRUAL_END_AGE - workStartAge);
  return Math.round(capped * careerYears);
}

/**
 * Lifelong annual AFP from a pensjonsgrunnlag, levealdersjustert for the cohort
 * and withdrawal age.
 */
export function annualAfp(params: {
  grunnlag: number;
  birthYear: number;
  retirementAge: number;
}): number {
  const { grunnlag, birthYear, retirementAge } = params;
  if (grunnlag <= 0) return 0;
  const factor = AFP_REFERENCE_DELINGSTALL / delingstall(birthYear, retirementAge);
  return Math.max(0, AFP_RATE * grunnlag * factor);
}
