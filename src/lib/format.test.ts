import { describe, it, expect } from 'vitest';
import { formatSignedPct } from './format';

describe('formatSignedPct', () => {
  it('prefixes + for zero and positive values, nothing extra for negative', () => {
    expect(formatSignedPct(4.25)).toBe('+4.3%');
    expect(formatSignedPct(0)).toBe('+0.0%');
    expect(formatSignedPct(-1.34)).toBe('-1.3%');
  });

  it('supports digits and unit overrides', () => {
    expect(formatSignedPct(2.5, 0)).toBe('+3%');
    expect(formatSignedPct(1.27, 1, 'pp')).toBe('+1.3pp');
    expect(formatSignedPct(1.2, 1, '')).toBe('+1.2');
  });

  it('renders null/undefined/non-finite as an em dash', () => {
    expect(formatSignedPct(null)).toBe('—');
    expect(formatSignedPct(undefined)).toBe('—');
    expect(formatSignedPct(NaN)).toBe('—');
    expect(formatSignedPct(Infinity)).toBe('—');
  });
});
