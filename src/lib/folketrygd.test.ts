import { describe, it, expect } from 'vitest';
import {
  annualAccrual,
  delingstall,
  projectBeholdning,
  estimateBeholdning,
  annualFolketrygdPension,
  folketrygdParamsFor,
  FOLKETRYGD_PARAMS,
} from './folketrygd';

describe('folketrygdParamsFor', () => {
  it('returns the exact year when present', () => {
    expect(folketrygdParamsFor(2026).grunnbelop).toBe(136_549);
    expect(folketrygdParamsFor(2025).grunnbelop).toBe(130_160);
  });
  it('falls back to the newest year <= requested', () => {
    expect(folketrygdParamsFor(2030)).toBe(FOLKETRYGD_PARAMS[2026]);
  });
  it('falls back to the earliest year when requested is older than all', () => {
    expect(folketrygdParamsFor(2000)).toBe(FOLKETRYGD_PARAMS[2025]);
  });
});

describe('annualAccrual', () => {
  it('accrues 18.1% of income below the 7.1G cap', () => {
    expect(annualAccrual(500_000, 2026)).toBeCloseTo(90_500, 0); // 0.181 * 500000
  });
  it('caps pensionable income at 7.1G', () => {
    const cap = 7.1 * 136_549; // 969,497.9
    expect(annualAccrual(2_000_000, 2026)).toBeCloseTo(0.181 * cap, 0);
  });
  it('is zero for non-positive income', () => {
    expect(annualAccrual(0, 2026)).toBe(0);
    expect(annualAccrual(-100, 2026)).toBe(0);
  });
});

describe('delingstall', () => {
  it('uses the exact age-67 anchor for a known cohort', () => {
    expect(delingstall(1963, 67)).toBeCloseTo(16.11, 2);
  });
  it('interpolates between anchors', () => {
    // 1967 sits 40% from 1965 (16.34) toward 1970 (16.70)
    expect(delingstall(1967, 67)).toBeCloseTo(16.34 + 0.4 * (16.70 - 16.34), 3);
  });
  it('clamps below and above the table range', () => {
    expect(delingstall(1940, 67)).toBeCloseTo(15.08, 2);
    expect(delingstall(2050, 67)).toBeCloseTo(19.85, 2);
  });
  it('raises the divisor for earlier withdrawal and lowers it for later', () => {
    expect(delingstall(1963, 62)).toBeCloseTo(16.11 + 5 * 0.55, 2);
    expect(delingstall(1963, 70)).toBeCloseTo(16.11 - 3 * 0.55, 2);
  });
});

describe('projectBeholdning', () => {
  it('adds future accrual to the current beholdning', () => {
    const accr = annualAccrual(600_000, 2026);
    expect(projectBeholdning(1_000_000, 600_000, 10, 2026)).toBeCloseTo(1_000_000 + 10 * accr, 0);
  });
  it('holds flat when there are no years left', () => {
    expect(projectBeholdning(1_000_000, 600_000, 0, 2026)).toBe(1_000_000);
  });
});

describe('estimateBeholdning', () => {
  it('estimates from years worked since work-start age', () => {
    // Age 40 in 2026 (born 1986), worked from 22 => 18 years.
    const est = estimateBeholdning({ birthYear: 1986, currentYear: 2026, annualIncome: 600_000 });
    expect(est).toBe(Math.round(annualAccrual(600_000, 2026) * 18));
  });
  it('returns 0 when birth year is unset', () => {
    expect(estimateBeholdning({ birthYear: 0, currentYear: 2026, annualIncome: 600_000 })).toBe(0);
  });
});

describe('annualFolketrygdPension', () => {
  it('divides beholdning by delingstall for a high earner (no guarantee top-up)', () => {
    const r = annualFolketrygdPension({ beholdning: 6_000_000, birthYear: 1963, retirementAge: 67, single: true, year: 2026 });
    expect(r.inntektspensjon).toBeCloseTo(6_000_000 / 16.11, 0);
    expect(r.garantiSupplement).toBe(0);
    expect(r.annual).toBeCloseTo(6_000_000 / 16.11, 0);
  });
  it('applies the garantipensjon floor with 80% avkorting for a low earner', () => {
    const r = annualFolketrygdPension({ beholdning: 1_000_000, birthYear: 1990, retirementAge: 67, single: true, year: 2026 });
    const d = delingstall(1990, 67);
    const ip = 1_000_000 / d;
    const supplement = 253_787 - 0.8 * ip;
    expect(r.garantiSupplement).toBeCloseTo(supplement, 0);
    expect(r.annual).toBeCloseTo(ip + supplement, 0);
    expect(r.annual).toBeGreaterThan(ip); // floor lifted it
  });
  it('uses the married (ordinær) guarantee rate when not single', () => {
    const single = annualFolketrygdPension({ beholdning: 0, birthYear: 1990, retirementAge: 67, single: true, year: 2026 });
    const married = annualFolketrygdPension({ beholdning: 0, birthYear: 1990, retirementAge: 67, single: false, year: 2026 });
    expect(single.annual).toBeCloseTo(253_787, 0);
    expect(married.annual).toBeCloseTo(234_765, 0);
  });
});
