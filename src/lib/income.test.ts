import { describe, it, expect } from 'vitest';
import { incomeDiffPct } from './income';

describe('incomeDiffPct', () => {
  it('reports the percentage above/below the trailing average', () => {
    expect(incomeDiffPct(55000, 50000)).toBeCloseTo(10, 6);
    expect(incomeDiffPct(45000, 50000)).toBeCloseTo(-10, 6);
    expect(incomeDiffPct(50000, 50000)).toBe(0);
  });

  it('returns 0 when there is no positive baseline (no divide-by-zero)', () => {
    expect(incomeDiffPct(55000, 0)).toBe(0);
    expect(incomeDiffPct(55000, -100)).toBe(0);
  });
});
