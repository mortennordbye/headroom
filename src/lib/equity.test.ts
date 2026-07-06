import { describe, it, expect } from 'vitest';
import { computeEquityBreakdown } from './equity';
import type { Assets } from '../context/FinanceContext';

const assets = (over: Partial<Assets> = {}): Assets => ({
  portfolio: 0,
  unrealizedGain: 0,
  taxRate: 37.84,
  bsu: 0,
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

  it('rolls the loss benefit into total equity', () => {
    const flat = computeEquityBreakdown(assets({ portfolio: 100_000 }));
    const withLoss = computeEquityBreakdown(assets({ portfolio: 100_000, unrealizedGain: -10_000, taxRate: 37.84 }));
    expect(withLoss.totalEquity).toBeCloseTo(flat.totalEquity + 3784, 0);
  });
});
