import type { CoOwner } from '../context/FinanceContext';
import { calcAmortizationSchedule } from './calculations';
import { effectiveRemainingMonths, paymentTermMonths, type TermFields } from './loanTerm';
import { reconcileMortgageSlices } from './mortgageSlices';
import { ownershipShares } from './ownership';

export type MortgageHousingMode = 'first_buyer' | 'homeowner' | 'transitioning';

/** The homeowner fields read here. Loose: imported blobs may lack any of them. */
export interface HomeownerLoanFields extends TermFields {
  currentMortgageBalance?: number;
  currentMortgageBalanceAsOf?: string;
  rente?: number;
}

/** The assets fields read here. */
export interface MortgageAssetFields {
  houseDebt?: number;
  coOwners?: CoOwner[];
}

/**
 * The mortgage on the current home, one answer for every page and the MCP.
 *
 * Projections amortise `balance` from today over `paymentTermMonths` at
 * `ratePct`: the term as of the balance date, so a balance entered months ago
 * is not rolled forward (and today's net worth stays as entered).
 * `remainingMonths` is the term left at the month asked about, for display only.
 */
export interface CurrentMortgage {
  /** The whole loan, as the bank shows it. */
  fullBalance: number;
  /** The user's share of it at the month asked about (ownershipShares). */
  balance: number;
  ratePct: number;
  /** Months to price and amortise the balance over. 0 holds it flat. */
  paymentTermMonths: number;
  /** Term left at the month asked about (display). */
  remainingMonths: number;
  /** Month 'YYYY-MM' the balance was written, or null. */
  balanceAsOf: string | null;
  /** True for the owner modes: a loan being paid down, whose interest is
   *  deductible. A first buyer's Assets debt is held flat and deducts nothing. */
  amortises: boolean;
}

const finiteOr0 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * The mortgage owed on the current home at `monthKey`.
 *  • homeowner / transitioning: the current loan, with the homeowner slice's
 *    rate and term. In transitioning the planned `loan` is the next purchase
 *    and only drives the purchase maths, so it is never read here.
 *  • first_buyer: whatever debt the Assets page holds, flat (no rate, no term).
 *    The Loan page's loan is a plan, not a debt.
 * The slices are reconciled first (mortgageSlices.ts), so a raw or old blob
 * gives the balance the app would show after loading it.
 */
export function currentMortgage(
  mode: MortgageHousingMode | undefined,
  assets: MortgageAssetFields | null | undefined,
  homeowner: HomeownerLoanFields | null | undefined,
  transition: { currentMortgageBalance?: number } | null | undefined,
  monthKey: string,
): CurrentMortgage {
  const housingMode = mode ?? 'first_buyer';
  const r = reconcileMortgageSlices({
    housingMode,
    assets: assets ?? undefined,
    homeowner: homeowner ?? undefined,
    transition: transition ?? undefined,
  }, monthKey);
  const h = r.homeowner;
  const raw = housingMode === 'homeowner' ? h?.currentMortgageBalance ?? r.assets?.houseDebt
    : housingMode === 'transitioning'
      ? r.transition?.currentMortgageBalance ?? h?.currentMortgageBalance ?? r.assets?.houseDebt
      : r.assets?.houseDebt;
  const fullBalance = Math.max(0, finiteOr0(raw));
  const balance = fullBalance * ownershipShares(assets, monthKey).debt;
  if (housingMode === 'first_buyer') {
    return { fullBalance, balance, ratePct: 0, paymentTermMonths: 0, remainingMonths: 0, balanceAsOf: null, amortises: false };
  }
  return {
    fullBalance,
    balance,
    ratePct: finiteOr0(h?.rente),
    paymentTermMonths: paymentTermMonths(h),
    remainingMonths: effectiveRemainingMonths(h, monthKey),
    balanceAsOf: h?.currentMortgageBalanceAsOf ?? null,
    amortises: true,
  };
}

/** Year-one interest on the user's share of the mortgage owed today: the
 *  rentefradrag base. 0 for a first buyer's flat Assets debt. */
export function annualMortgageInterest(m: CurrentMortgage): number {
  const years = m.paymentTermMonths / 12;
  if (!m.amortises || !(m.balance > 0) || !(m.ratePct > 0) || !(years > 0)) return 0;
  return calcAmortizationSchedule(m.balance, m.ratePct, years)[0]?.interestPaid ?? 0;
}
