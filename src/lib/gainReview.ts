import type { Assets } from '../context/FinanceContext';

// A monthly automation into the investment portfolio moves only the balance: a
// contribution grows the cost basis, so `unrealizedGain` is deliberately left
// alone (FinanceContext, applyPostingBalances). What the gain actually did that
// month is market movement the app has no source for — nobody reports it — so
// the posting leaves a marker and the user is asked once, that month, to read
// the real figure off the broker.

export interface GainReview {
  /** Month (YYYY-MM) the contribution posted. */
  month: string;
  /** Total posted into the portfolio that month, for the prompt copy. */
  amount: number;
}

/** The outstanding review on `assets`, or null when there is nothing to ask. */
export function pendingGainReview(a: Assets): GainReview | null {
  if (!a.gainReviewMonth) return null;
  const amount = a.gainReviewAmount;
  return { month: a.gainReviewMonth, amount: Number.isFinite(amount) ? amount! : 0 };
}

/**
 * The marker patch for a portfolio contribution of `amount` in `month`.
 * Contributions within the same month accumulate, so two rules paying into the
 * portfolio surface as one prompt for their combined sum; a contribution in a
 * new month replaces an unanswered older marker (the newer total is the one the
 * user is reconciling against).
 */
export function markGainReview(a: Assets, month: string, amount: number): Pick<Assets, 'gainReviewMonth' | 'gainReviewAmount'> {
  const carried = a.gainReviewMonth === month && Number.isFinite(a.gainReviewAmount) ? a.gainReviewAmount! : 0;
  return { gainReviewMonth: month, gainReviewAmount: carried + (Number.isFinite(amount) ? amount : 0) };
}

/** What was paid in: portfolio value minus the unrealized part of it. */
export function costBasis(a: Assets): number {
  return (a.portfolio ?? 0) - (a.unrealizedGain ?? 0);
}
