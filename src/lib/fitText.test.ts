import { describe, it, expect } from 'vitest';
import { fitFontScale, MIN_FIT_SCALE } from './fitText';

describe('fitFontScale', () => {
  it('leaves text that already fits alone', () => {
    expect(fitFontScale(200, 120)).toBe(1);
    expect(fitFontScale(200, 200)).toBe(1);
  });

  it('shrinks text that overflows to the ratio that fits', () => {
    expect(fitFontScale(150, 200)).toBe(0.75);
    expect(fitFontScale(100, 200, 0.2)).toBe(0.5);
  });

  it('rounds down so rounding can never leave the text too wide', () => {
    // 100/300 = 0.3333… — rounding up would still overflow by a hair.
    const scale = fitFontScale(100, 300, 0);
    expect(scale).toBe(0.333);
    expect(scale * 300).toBeLessThanOrEqual(100);
  });

  it('never shrinks past the readability floor', () => {
    expect(fitFontScale(10, 1000)).toBe(MIN_FIT_SCALE);
    expect(fitFontScale(10, 1000, 0.5)).toBe(0.5);
  });

  it('returns 1 for an unmeasurable box (hidden, or not yet laid out)', () => {
    expect(fitFontScale(0, 200)).toBe(1);
    expect(fitFontScale(200, 0)).toBe(1);
    expect(fitFontScale(NaN, 200)).toBe(1);
    expect(fitFontScale(200, NaN)).toBe(1);
    expect(fitFontScale(-50, 200)).toBe(1);
  });
});
