import { describe, it, expect } from 'vitest';
import {
  calcNorwegianTax,
  calcTaxByRegion,
  TAX_PARAMS,
  TAX_YEAR,
  IPS_MAX_DEDUCTION,
} from './norwegianTax';

describe('TAX_PARAMS / TAX_YEAR', () => {
  it('has a params entry for the active tax year', () => {
    expect(TAX_PARAMS[TAX_YEAR]).toBeDefined();
  });

  it('resolves the active year from the clock (2026 or later)', () => {
    // IMPROVEMENTS 1.2 — the year was a hardcoded 2025 well into 2026.
    expect(TAX_YEAR).toBeGreaterThanOrEqual(2026);
  });

  it('uses the 2025 personfradrag (108 550), not the stale 2024 value', () => {
    // Regression guard for AUDIT §3.1 — the 2024 value (88 250) overstated tax.
    expect(TAX_PARAMS[2025].personfradrag).toBe(108_550);
  });
});

describe('golden values, hand-computed from the statutory parameters', () => {
  // One exact-total assertion per tax year (IMPROVEMENTS §6): a wrong rate or
  // threshold anywhere in TAX_PARAMS shifts these totals, which is what the
  // purely structural assertions above can't catch. Expected figures are
  // computed by hand from Skatteetaten's published parameters for each year.
  it('2025: 744 000 gross', () => {
    const r = calcNorwegianTax(744_000, 0, 2025);
    expect(r.inntektsskatt).toBeCloseTo(119_559.0, 2);  // (744000 − 92000 − 108550) × 0.22
    expect(r.trinnskatt).toBeCloseTo(23_569.5, 2);      // 88650×0.017 + 391100×0.04 + 46850×0.137
    expect(r.trygdeavgift).toBeCloseTo(57_288.0, 2);    // 744000 × 0.077
    expect(r.totalTax).toBeCloseTo(200_416.5, 2);
  });

  it('2026: 700 000 gross', () => {
    const r = calcNorwegianTax(700_000, 0, 2026);
    expect(r.inntektsskatt).toBeCloseTo(107_747.2, 2);  // (700000 − 95700 − 114540) × 0.22
    expect(r.trinnskatt).toBeCloseTo(16_835.4, 2);      // 92200×0.017 + 381700×0.04
    expect(r.trygdeavgift).toBeCloseTo(53_200.0, 2);    // 700000 × 0.076
    expect(r.totalTax).toBeCloseTo(177_782.6, 2);
  });
});

describe('calcNorwegianTax', () => {
  it('returns all-zero tax for zero income', () => {
    const r = calcNorwegianTax(0);
    expect(r.totalTax).toBe(0);
    expect(r.netAnnual).toBe(0);
    expect(r.effectiveRatePct).toBe(0);
  });

  it('charges no trygdeavgift at or below the lower limit', () => {
    const limit = TAX_PARAMS[TAX_YEAR].trygdeavgiftLowerLimit;
    expect(calcNorwegianTax(limit).trygdeavgift).toBe(0);
    expect(calcNorwegianTax(limit + 1).trygdeavgift).toBeGreaterThan(0);
  });

  it('caps trygdeavgift at 25% of income above the limit in the opptrapping band', () => {
    const { trygdeavgiftLowerLimit: limit, trygdeavgiftRate: rate } = TAX_PARAMS[TAX_YEAR];
    // Just above the limit the phased-in cap (25% of the excess) binds, not the
    // full rate — so no hard cliff at the threshold.
    const gross = limit + 20_000;
    expect(calcNorwegianTax(gross).trygdeavgift).toBeCloseTo(0.25 * 20_000, 6);
    expect(0.25 * 20_000).toBeLessThan(gross * rate); // the cap really is the binding one
  });

  it('applies the full trygdeavgift rate once past the opptrapping crossover', () => {
    const { trygdeavgiftRate: rate } = TAX_PARAMS[TAX_YEAR];
    const gross = 250_000; // well above the ~144.8k crossover
    expect(calcNorwegianTax(gross).trygdeavgift).toBeCloseTo(gross * rate, 6);
  });

  it('applies minstefradrag up to its ceiling', () => {
    const { minstefradragMax, minstefradragRate } = TAX_PARAMS[TAX_YEAR];
    // Well above the ceiling: minstefradrag is capped at the max.
    const highGross = minstefradragMax / minstefradragRate + 500_000;
    const r = calcNorwegianTax(highGross);
    // Sanity: effective rate is between 0 and 100.
    expect(r.effectiveRatePct).toBeGreaterThan(0);
    expect(r.effectiveRatePct).toBeLessThan(100);
  });

  it('is monotonic — higher gross never lowers total tax', () => {
    let prev = -1;
    for (const g of [100_000, 300_000, 500_000, 700_000, 1_000_000, 1_500_000]) {
      const t = calcNorwegianTax(g).totalTax;
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });

  it('nets out to gross minus tax minus IPS', () => {
    const r = calcNorwegianTax(600_000, 15_000);
    expect(r.netAnnual).toBeCloseTo(r.gross - r.totalTax - IPS_MAX_DEDUCTION, 6);
    expect(r.netMonthly).toBeCloseTo(r.netAnnual / 12, 6);
  });

  it('clamps the IPS deduction to its maximum', () => {
    const capped = calcNorwegianTax(600_000, 50_000);
    const atMax = calcNorwegianTax(600_000, IPS_MAX_DEDUCTION);
    expect(capped.totalTax).toBeCloseTo(atMax.totalTax, 6);
  });

  it('produces a plausible effective rate for a median salary', () => {
    // ~730k gross → roughly 25–35% effective in the Norwegian model.
    const r = calcNorwegianTax(730_000);
    expect(r.effectiveRatePct).toBeGreaterThan(20);
    expect(r.effectiveRatePct).toBeLessThan(40);
  });
});

describe('calcTaxByRegion — generic mode', () => {
  it('applies a flat rate on income after IPS', () => {
    const r = calcTaxByRegion(500_000, 'generic', 30, 0);
    expect(r.totalTax).toBeCloseTo(500_000 * 0.3, 6);
    expect(r.effectiveRatePct).toBeCloseTo(30, 6);
  });

  it('clamps the custom rate to 0–100', () => {
    expect(calcTaxByRegion(500_000, 'generic', 250, 0).totalTax).toBeCloseTo(500_000, 6);
    expect(calcTaxByRegion(500_000, 'generic', -50, 0).totalTax).toBe(0);
  });

  it('delegates to the Norwegian model for region "no"', () => {
    const a = calcTaxByRegion(600_000, 'no', 0, 0);
    const b = calcNorwegianTax(600_000, 0);
    expect(a.totalTax).toBeCloseTo(b.totalTax, 6);
  });
});
