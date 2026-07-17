import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calcMonthlyPayment } from './calculations';
import { calcNorwegianTax } from './norwegianTax';
import { parseLocaleNumber } from './validators';
import { estimatedPropertyValue } from './propertyEstimate';

// Property-based ("fuzz") tests for the money-math core. Each throws thousands of
// random inputs at a pure function and asserts an invariant, targeting this app's
// highest-risk bug class: NaN/Infinity leaking into arithmetic and charts.

describe('calcMonthlyPayment (property)', () => {
  // principal + rate stay fully adversarial doubles (a subnormal rate exercises
  // the denominator-underflow guard); the term is fuzzed as an integer, its real
  // domain (nedbetalingstid is always a whole number of years).
  it('returns a finite, non-negative payment for any realistic loan', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e12, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 0, max: 40 }),
        (principal, rate, years) => {
          const p = calcMonthlyPayment(principal, rate, years);
          expect(Number.isFinite(p)).toBe(true);
          expect(p).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('never exceeds the principal in a single monthly payment for terms >= 1 year', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 1e12, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 30, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 1, max: 40 }),
        (principal, rate, years) => {
          expect(calcMonthlyPayment(principal, rate, years)).toBeLessThanOrEqual(principal);
        },
      ),
    );
  });
});

describe('calcNorwegianTax (property)', () => {
  it('keeps tax finite and within 0..gross for any income (incl. negatives)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e7, max: 1e8, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1e5, noNaN: true, noDefaultInfinity: true }),
        (gross, ips) => {
          const t = calcNorwegianTax(gross, ips);
          const clampedGross = Math.max(0, gross);
          expect(Number.isFinite(t.totalTax)).toBe(true);
          expect(t.totalTax).toBeGreaterThanOrEqual(0);
          // You never owe more income tax than you earned.
          expect(t.totalTax).toBeLessThanOrEqual(clampedGross + 1e-6);
          expect(t.effectiveRatePct).toBeGreaterThanOrEqual(0);
          expect(t.effectiveRatePct).toBeLessThanOrEqual(100);
          expect(Number.isFinite(t.netMonthly)).toBe(true);
        },
      ),
    );
  });
});

describe('parseLocaleNumber (property)', () => {
  it('never throws and returns NaN or a number for any string', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const n = parseLocaleNumber(s);
        expect(typeof n).toBe('number');
      }),
    );
  });

  it('round-trips a finite number through its string form (comma or dot)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        (n) => {
          const rounded = Math.round(n * 100) / 100; // 2-decimal money value
          const dot = parseLocaleNumber(String(rounded));
          const comma = parseLocaleNumber(String(rounded).replace('.', ','));
          expect(dot).toBeCloseTo(rounded, 6);
          expect(comma).toBeCloseTo(rounded, 6);
        },
      ),
    );
  });
});

describe('estimatedPropertyValue (property)', () => {
  it('never yields NaN — returns null or a finite positive value for any inputs', () => {
    // fc.double() here intentionally includes NaN and +/-Infinity as adversarial inputs.
    fc.assert(
      fc.property(fc.double(), fc.double(), (sqm, price) => {
        const v = estimatedPropertyValue(sqm, price);
        if (v !== null) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThan(0);
        }
      }),
    );
  });
});
