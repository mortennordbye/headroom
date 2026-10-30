import { describe, it, expect } from 'vitest';
import { grossFromNetAnnual } from './grossFromNet';
import { calcTaxByRegion } from './norwegianTax';

describe('grossFromNetAnnual', () => {
  it('round-trips gross → net → gross within a few kroner (Norway)', () => {
    for (const gross of [50000, 150000, 300000, 600000, 900000, 1500000, 3000000]) {
      const net = calcTaxByRegion(gross, 'no', 30).netAnnual;
      expect(Math.abs(grossFromNetAnnual(net, 'no', 30) - gross)).toBeLessThanOrEqual(3);
    }
  });

  it('round-trips with IPS, interest deduction and BSU credit', () => {
    const args = [15000, 160000, 2750] as const;
    for (const gross of [200000, 600000, 1200000]) {
      const net = calcTaxByRegion(gross, 'no', 30, ...args).netAnnual;
      expect(Math.abs(grossFromNetAnnual(net, 'no', 30, ...args) - gross)).toBeLessThanOrEqual(3);
    }
  });

  it('round-trips at a flat rate (generic region)', () => {
    const net = calcTaxByRegion(500000, 'generic', 25).netAnnual;
    expect(Math.abs(grossFromNetAnnual(net, 'generic', 25) - 500000)).toBeLessThanOrEqual(3);
  });

  it('gross is above net once tax applies', () => {
    expect(grossFromNetAnnual(480000, 'no', 30)).toBeGreaterThan(600000);
  });

  it('zero, negative and non-finite net give 0, never NaN', () => {
    expect(grossFromNetAnnual(0, 'no', 30)).toBe(0);
    expect(grossFromNetAnnual(-10000, 'no', 30)).toBe(0);
    expect(grossFromNetAnnual(NaN, 'no', 30)).toBe(0);
    expect(grossFromNetAnnual(Infinity, 'no', 30)).toBe(0);
  });

  it('stays finite when the target can never be reached (100% flat rate)', () => {
    expect(Number.isFinite(grossFromNetAnnual(100000, 'generic', 100))).toBe(true);
  });
});
