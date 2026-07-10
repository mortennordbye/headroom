import { describe, it, expect } from 'vitest';
import { formatSignedPct, formatAxisInt, formatBytes } from './format';

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

describe('formatBytes', () => {
  it('renders raw bytes below 1 KiB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('renders KB with one decimal up to 1 MiB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(12_800)).toBe('12.5 KB');
  });

  it('renders MB with two decimals at and above 1 MiB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
    expect(formatBytes(3_500_000)).toBe('3.34 MB');
  });

  it('renders an em dash for non-finite or negative input', () => {
    expect(formatBytes(NaN)).toBe('—');
    expect(formatBytes(-5)).toBe('—');
  });
});
