import type { BalanceSnapshot } from '../context/FinanceContext';
import { calcMonthlyPayment } from './calculations';
import { currentMortgage } from './existingMortgage';

// Mortgage plan-vs-actual (HISTORY_PLAN §6.3). The plan curve is anchored at the
// earliest recorded mortgage balance using that month's rate/term; the actual
// curve is each recorded month's mortgage balance. All computed from snapshots so
// nothing is stored twice.

export interface PaydownPoint {
  monthKey: string;
  /** Recorded mortgage balance that month. */
  actual: number;
  /** Where the original amortization plan says the balance should be. */
  plan: number;
}

export interface PaydownVsPlan {
  points: PaydownPoint[];
  anchorMonth: string | null;
  /** plan − actual at the latest recorded month. >0 = ahead (balance lower than plan). */
  aheadBy: number;
  /** aheadBy expressed in months of scheduled payment (sign matches aheadBy). */
  monthsAhead: number;
  /** Anchor balance − latest actual balance: principal actually repaid to date. */
  principalPaid: number;
  /** Estimated interest paid along the actual path to date (trapezoidal over
   *  recorded months; approximate when months are missing). */
  interestPaid: number;
  /** The scheduled monthly payment of the anchored plan. */
  monthlyPayment: number;
}

const EMPTY: PaydownVsPlan = {
  points: [], anchorMonth: null, aheadBy: 0, monthsAhead: 0,
  principalPaid: 0, interestPaid: 0, monthlyPayment: 0,
};

const monthIndex = (key: string): number => {
  const [y, m] = key.split('-').map(Number);
  return y * 12 + (m - 1);
};

/** The month's mortgage as recorded, read like today's (`currentMortgage`):
 *  the whole loan, with the current loan's rate and term in the owner modes. A
 *  first buyer's Assets debt has neither, so its plan holds flat. */
function snapshotMortgage(snap: BalanceSnapshot, month: string) {
  return currentMortgage(snap.housingMode, snap.assets, snap.homeowner, snap.transition, month);
}
const mortgageBalance = (snap: BalanceSnapshot, month: string): number => snapshotMortgage(snap, month).fullBalance;

/** Plan balance after `k` monthly payments of `payment` at `monthlyRate`. */
function planBalanceAfter(principal: number, monthlyRate: number, payment: number, k: number): number {
  let b = principal;
  for (let i = 0; i < k; i++) {
    const interest = b * monthlyRate;
    b -= payment - interest;
    if (b <= 0) return 0;
  }
  return Math.max(0, b);
}

export function paydownVsPlan(snapshots: Record<string, BalanceSnapshot>): PaydownVsPlan {
  const months = Object.keys(snapshots).sort();
  const anchorMonth = months.find(m => mortgageBalance(snapshots[m], m) > 0) ?? null;
  if (!anchorMonth) return EMPTY;

  const anchor = snapshotMortgage(snapshots[anchorMonth], anchorMonth);
  const anchorBalance = anchor.fullBalance;
  const rate = anchor.ratePct;
  const term = anchor.paymentTermMonths / 12;
  const monthlyRate = rate / 100 / 12;
  const monthlyPayment = calcMonthlyPayment(anchorBalance, rate, term);
  const anchorIdx = monthIndex(anchorMonth);

  const points: PaydownPoint[] = months
    .filter(m => monthIndex(m) >= anchorIdx)
    .map(m => ({
      monthKey: m,
      actual: mortgageBalance(snapshots[m], m),
      plan: planBalanceAfter(anchorBalance, monthlyRate, monthlyPayment, monthIndex(m) - anchorIdx),
    }));

  // Trapezoidal interest estimate along the actual balances between recorded months.
  let interestPaid = 0;
  for (let i = 1; i < points.length; i++) {
    const gap = monthIndex(points[i].monthKey) - monthIndex(points[i - 1].monthKey);
    const avg = (points[i - 1].actual + points[i].actual) / 2;
    interestPaid += avg * monthlyRate * gap;
  }

  const latest = points[points.length - 1];
  const aheadBy = latest.plan - latest.actual;
  return {
    points,
    anchorMonth,
    aheadBy,
    monthsAhead: monthlyPayment > 0 ? aheadBy / monthlyPayment : 0,
    principalPaid: anchorBalance - latest.actual,
    interestPaid,
    monthlyPayment,
  };
}
