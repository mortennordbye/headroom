import { describe, it, expect } from 'vitest';
import { restskattEstimate } from './restskatt';
import type { MonthlyPayslip } from '../context/FinanceContext';

const slip = (gross: number, tax: number): MonthlyPayslip => ({
  gross, tax, net: gross - tax, base: gross,
});

// A flat 30% "expected tax" function keeps the arithmetic easy to reason about.
const flatTax = (rate: number) => (gross: number) => gross * rate;

describe('restskattEstimate', () => {
  it('flags a restskatt when withholding trails the expected tax', () => {
    // 4 months at 50k gross, only 10k withheld (20%) but the year owes 30%.
    const payslips = { '2026-01': slip(50000, 10000), '2026-02': slip(50000, 10000), '2026-03': slip(50000, 10000), '2026-04': slip(50000, 10000) };
    const r = restskattEstimate(payslips, 2026, flatTax(0.3))!;
    expect(r.monthsRecorded).toBe(4);
    expect(r.projectedAnnualGross).toBeCloseTo(600000, 5);   // 50k × 12
    expect(r.projectedAnnualWithholding).toBeCloseTo(120000, 5);
    expect(r.expectedAnnualTax).toBeCloseTo(180000, 5);
    expect(r.gap).toBeCloseTo(60000, 5);
    expect(r.status).toBe('restskatt');
  });

  it('flags a refund when withholding runs ahead of expected tax', () => {
    const payslips = { '2026-01': slip(50000, 20000), '2026-02': slip(50000, 20000), '2026-03': slip(50000, 20000) };
    const r = restskattEstimate(payslips, 2026, flatTax(0.3))!;
    expect(r.gap).toBeLessThan(0);
    expect(r.status).toBe('refund');
  });

  it('reports onTrack when withholding matches expected tax', () => {
    const payslips = { '2026-01': slip(50000, 15000), '2026-02': slip(50000, 15000) };
    const r = restskattEstimate(payslips, 2026, flatTax(0.3))!;
    expect(r.gap).toBeCloseTo(0, 5);
    expect(r.status).toBe('onTrack');
  });

  it('only counts payslips for the requested year', () => {
    const payslips = { '2025-11': slip(99999, 0), '2026-01': slip(50000, 15000), '2026-02': slip(50000, 15000) };
    const r = restskattEstimate(payslips, 2026, flatTax(0.3))!;
    expect(r.monthsRecorded).toBe(2);
    expect(r.grossToDate).toBeCloseTo(100000, 5);
  });

  it('returns null below the minimum recorded months', () => {
    const payslips = { '2026-01': slip(50000, 15000) };
    expect(restskattEstimate(payslips, 2026, flatTax(0.3))).toBeNull();
  });

  it('does not flag a gap within the materiality threshold', () => {
    // Expected 180k tax, withhold 179k → 1k gap is under the 3% (5.4k) floor.
    const payslips = { '2026-01': slip(50000, 179000 / 12), '2026-02': slip(50000, 179000 / 12) };
    const r = restskattEstimate(payslips, 2026, flatTax(0.3))!;
    expect(r.status).toBe('onTrack');
  });
});
