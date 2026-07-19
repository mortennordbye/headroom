import { describe, it, expect } from 'vitest';
import { estimateAfpGrunnlag, annualAfp, AFP_RATE, AFP_REFERENCE_DELINGSTALL } from './afp';
import { delingstall } from './folketrygd';

describe('estimateAfpGrunnlag', () => {
  it('sums capped income over a full career to 61', () => {
    // workStart 22 → 61 = 39 years; income below 7.1G so uncapped.
    expect(estimateAfpGrunnlag({ birthYear: 1990, annualIncome: 700_000, year: 2026 }))
      .toBe(Math.round(700_000 * 39));
  });
  it('caps yearly income at 7.1G', () => {
    const cap = 7.1 * 136_549;
    expect(estimateAfpGrunnlag({ birthYear: 1990, annualIncome: 2_000_000, year: 2026 }))
      .toBe(Math.round(cap * 39));
  });
  it('is zero when birth year is unset', () => {
    expect(estimateAfpGrunnlag({ birthYear: 0, annualIncome: 700_000, year: 2026 })).toBe(0);
  });
});

describe('annualAfp', () => {
  it('applies the 0.314% base at the reference cohort/age (factor 1.0)', () => {
    const grunnlag = 27_300_000; // 700k × 39
    expect(annualAfp({ grunnlag, birthYear: 1963, retirementAge: 67 }))
      .toBeCloseTo(AFP_RATE * grunnlag, 0);
  });
  it('pays less for a later cohort (higher delingstall)', () => {
    const g = 27_300_000;
    const y1963 = annualAfp({ grunnlag: g, birthYear: 1963, retirementAge: 67 });
    const y1990 = annualAfp({ grunnlag: g, birthYear: 1990, retirementAge: 67 });
    expect(y1990).toBeLessThan(y1963);
    // Matches the delingstall ratio exactly.
    expect(y1990).toBeCloseTo(AFP_RATE * g * (AFP_REFERENCE_DELINGSTALL / delingstall(1990, 67)), 0);
  });
  it('pays more for later withdrawal (lower delingstall)', () => {
    const g = 27_300_000;
    const at67 = annualAfp({ grunnlag: g, birthYear: 1975, retirementAge: 67 });
    const at70 = annualAfp({ grunnlag: g, birthYear: 1975, retirementAge: 70 });
    expect(at70).toBeGreaterThan(at67);
  });
  it('is zero for a zero grunnlag', () => {
    expect(annualAfp({ grunnlag: 0, birthYear: 1980, retirementAge: 67 })).toBe(0);
  });
});
