import { describe, it, expect } from 'vitest';
import { computeEquityBreakdown, sumSavings, equitySeriesFrom } from './equity';
import type { Assets } from '../context/FinanceContext';

const assets = (over: Partial<Assets> = {}): Assets => ({
  portfolio: 0,
  unrealizedGain: 0,
  taxRate: 37.84,
  bsu: 0,
  bsuAnnualContribution: 0,
  savings: 0,
  houseValue: 0,
  houseDebt: 0,
  crypto: 0,
  cryptoUnrealizedGain: 0,
  cryptoTaxRate: 22,
  bufferAccount: 0,
  ...over,
});

describe('computeEquityBreakdown', () => {
  it('nets a latent tax LIABILITY out of a gain', () => {
    const b = computeEquityBreakdown(assets({ portfolio: 100_000, unrealizedGain: 20_000, taxRate: 37.84 }));
    expect(b.taxOnGain).toBeCloseTo(7568, 0);        // 20 000 * 37.84%
    expect(b.netInvestment).toBeCloseTo(92_432, 0);  // portfolio − tax
  });

  it('treats an unrealized LOSS as a tax benefit that raises net value', () => {
    // The reported scenario: a portfolio worth 110 808 that holds a 50 000 loss.
    const b = computeEquityBreakdown(assets({ portfolio: 110_808, unrealizedGain: -50_000, taxRate: 37.84 }));
    expect(b.taxOnGain).toBeCloseTo(-18_920, 0);      // negative → a shield, not a liability
    expect(b.netInvestment).toBeCloseTo(129_728, 0);  // portfolio + deductible loss value
    expect(b.netInvestment).toBeGreaterThan(110_808);
  });

  it('applies the same symmetry to crypto', () => {
    const gain = computeEquityBreakdown(assets({ crypto: 50_000, cryptoUnrealizedGain: 10_000, cryptoTaxRate: 22 }));
    expect(gain.cryptoTaxOnGain).toBeCloseTo(2_200, 0);
    expect(gain.netCrypto).toBeCloseTo(47_800, 0);

    const loss = computeEquityBreakdown(assets({ crypto: 50_000, cryptoUnrealizedGain: -10_000, cryptoTaxRate: 22 }));
    expect(loss.cryptoTaxOnGain).toBeCloseTo(-2_200, 0);
    expect(loss.netCrypto).toBeCloseTo(52_200, 0);
  });

  it('sums multiple savings accounts into net worth (and falls back to the legacy scalar)', () => {
    // Legacy: no accounts array → use the scalar.
    expect(sumSavings(assets({ savings: 40_000 }))).toBe(40_000);
    // Accounts present → they win, scalar ignored (no double count).
    const withAccounts = assets({
      savings: 40_000,
      savingsAccounts: [
        { id: 'a', name: 'Sparekonto', balance: 60_000 },
        { id: 'b', name: 'Feriekonto', balance: 25_000 },
      ],
    });
    expect(sumSavings(withAccounts)).toBe(85_000);
    const b = computeEquityBreakdown(withAccounts);
    expect(b.savingsTotal).toBe(85_000);
    expect(b.totalEquity).toBe(85_000); // only savings set here
  });

  it('returns 0 when neither accounts nor the retired scalar are present', () => {
    const { savings: _legacy, ...withoutScalar } = assets({});
    expect(sumSavings(withoutScalar)).toBe(0);
    expect(computeEquityBreakdown(withoutScalar).totalEquity).toBe(0);
  });

  it('never yields NaN for an old snapshot missing newer fields', () => {
    // Snapshots are stored verbatim; one saved before cryptoUnrealizedGain /
    // bufferAccount existed feeds undefined into the maths.
    const oldSnapshot = {
      portfolio: 100_000, unrealizedGain: 20_000, taxRate: 37.84,
      houseValue: 3_000_000, houseDebt: 2_000_000,
    } as unknown as Assets;
    const b = computeEquityBreakdown(oldSnapshot);
    for (const v of Object.values(b)) expect(Number.isFinite(v)).toBe(true);
    expect(b.totalEquity).toBeCloseTo(100_000 - 7568 + 1_000_000, 0);
  });

  it('rolls the loss benefit into total equity', () => {
    const flat = computeEquityBreakdown(assets({ portfolio: 100_000 }));
    const withLoss = computeEquityBreakdown(assets({ portfolio: 100_000, unrealizedGain: -10_000, taxRate: 37.84 }));
    expect(withLoss.totalEquity).toBeCloseTo(flat.totalEquity + 3784, 0);
  });
});

describe('equitySeriesFrom', () => {
  it('yields one breakdown per month, sorted oldest → newest', () => {
    const series = equitySeriesFrom({
      '2026-03': { assets: assets({ savings: 300 }) },
      '2026-01': { assets: assets({ savings: 100 }) },
      '2026-02': { assets: assets({ savings: 200 }) },
    });
    expect(series.map(p => p.monthKey)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(series.map(p => p.breakdown.totalEquity)).toEqual([100, 200, 300]);
  });

  it('is empty for no snapshots', () => {
    expect(equitySeriesFrom({})).toEqual([]);
  });
});
