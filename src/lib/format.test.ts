import { describe, it, expect } from 'vitest';
import { formatSignedPct, formatAxisInt } from './format';

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

describe('formatAxisInt', () => {
  it('renders millions with one decimal and an M suffix', () => {
    expect(formatAxisInt(1_500_000)).toBe('1.5M');
    expect(formatAxisInt(1_000_000)).toBe('1.0M');
    expect(formatAxisInt(-2_300_000)).toBe('-2.3M');
  });

  it('renders thousands as a rounded integer with a k suffix', () => {
    expect(formatAxisInt(12_000)).toBe('12k');
    expect(formatAxisInt(1_000)).toBe('1k');
    expect(formatAxisInt(1_499)).toBe('1k');
    expect(formatAxisInt(1_500)).toBe('2k');
    expect(formatAxisInt(-12_000)).toBe('-12k');
  });

  it('renders values below 1000 as the raw integer string', () => {
    expect(formatAxisInt(0)).toBe('0');
    expect(formatAxisInt(999)).toBe('999');
    expect(formatAxisInt(-500)).toBe('-500');
  });
});
