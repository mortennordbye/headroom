import { calcAmortizationSchedule } from './calculations';
import { paymentTermMonths, type TermFields } from './loanTerm';

export type MortgageHousingMode = 'first_buyer' | 'homeowner' | 'transitioning';

/** The homeowner fields read here. Loose: imported blobs may lack any of them. */
export interface HomeownerLoanFields extends TermFields {
  currentMortgageBalance?: number;
  rente?: number;
}

export interface ExistingMortgage {
  /** The user's share of the balance owed today. */
  balance: number;
  ratePct: number;
  /** Years to price the payment over (the term as of the balance's month). */
  termYears: number;
}

const NONE: ExistingMortgage = { balance: 0, ratePct: 0, termYears: 0 };
const finiteOr0 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * The mortgage the user actually owes today, as their share of it.
 *  • first_buyer: none. The Loan page's loan is a plan, not a debt.
 *  • homeowner: the current mortgage.
 *  • transitioning: the current home's mortgage, still owed until the sale.
 *    The transition slice holds its balance (mirrored with the homeowner one);
 *    the homeowner slice holds the rate and term of that same loan.
 */
export function existingMortgage(
  mode: MortgageHousingMode | undefined,
  homeowner: HomeownerLoanFields | null | undefined,
  transition: { currentMortgageBalance?: number } | null | undefined,
  debtShare: number,
): ExistingMortgage {
  if (mode !== 'homeowner' && mode !== 'transitioning') return NONE;
  const full = mode === 'transitioning'
    ? finiteOr0(transition?.currentMortgageBalance ?? homeowner?.currentMortgageBalance)
    : finiteOr0(homeowner?.currentMortgageBalance);
  const share = Number.isFinite(debtShare) ? Math.max(0, debtShare) : 0;
  return {
    balance: Math.max(0, full) * share,
    ratePct: finiteOr0(homeowner?.rente),
    termYears: paymentTermMonths(homeowner) / 12,
  };
}

/** Year-one interest on the mortgage owed today: the rentefradrag base. */
export function annualMortgageInterest(m: ExistingMortgage): number {
  if (!(m.balance > 0) || !(m.ratePct > 0) || !(m.termYears > 0)) return 0;
  return calcAmortizationSchedule(m.balance, m.ratePct, m.termYears)[0]?.interestPaid ?? 0;
}
