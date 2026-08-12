import { describe, it, expect } from 'vitest';
import { pendingGainReview, markGainReview, costBasis } from './gainReview';
import type { Assets } from '../context/FinanceContext';

const assets = (over: Partial<Assets> = {}): Assets => ({
  portfolio: 0, unrealizedGain: 0, taxRate: 37.84, bsu: 0, bsuAnnualContribution: 0,
  savings: 0, savingsAccounts: [], houseValue: 0, houseDebt: 0,
  crypto: 0, cryptoUnrealizedGain: 0, cryptoTaxRate: 22, bufferAccount: 0,
  ...over,
});

describe('pendingGainReview', () => {
  it('is null with no marker', () => {
    expect(pendingGainReview(assets())).toBeNull();
  });

  it('returns the marked month and amount', () => {
    const a = assets({ gainReviewMonth: '2026-08', gainReviewAmount: 5000 });
    expect(pendingGainReview(a)).toEqual({ month: '2026-08', amount: 5000 });
  });

  it('survives a marker written without an amount', () => {
    const a = assets({ gainReviewMonth: '2026-08' });
    expect(pendingGainReview(a)).toEqual({ month: '2026-08', amount: 0 });
  });
});

describe('markGainReview', () => {
  it('marks the month with the contribution', () => {
    expect(markGainReview(assets(), '2026-08', 5000))
      .toEqual({ gainReviewMonth: '2026-08', gainReviewAmount: 5000 });
  });

  it('accumulates two contributions in the same month', () => {
    const a = assets({ gainReviewMonth: '2026-08', gainReviewAmount: 5000 });
    expect(markGainReview(a, '2026-08', 1500))
      .toEqual({ gainReviewMonth: '2026-08', gainReviewAmount: 6500 });
  });

  it('replaces an unanswered marker from an earlier month', () => {
    const a = assets({ gainReviewMonth: '2026-07', gainReviewAmount: 5000 });
    expect(markGainReview(a, '2026-08', 5000))
      .toEqual({ gainReviewMonth: '2026-08', gainReviewAmount: 5000 });
  });

  it('ignores a non-finite contribution rather than poisoning the total', () => {
    expect(markGainReview(assets(), '2026-08', NaN))
      .toEqual({ gainReviewMonth: '2026-08', gainReviewAmount: 0 });
  });
});

describe('costBasis', () => {
  it('is the portfolio minus its unrealized gain', () => {
    expect(costBasis(assets({ portfolio: 656_009, unrealizedGain: 434_088 }))).toBe(221_921);
  });

  it('exceeds the portfolio when sitting on a loss', () => {
    expect(costBasis(assets({ portfolio: 80_000, unrealizedGain: -20_000 }))).toBe(100_000);
  });
});
