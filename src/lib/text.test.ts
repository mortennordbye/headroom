import { describe, it, expect } from 'vitest';
import { buildMatchHaystack, normalizeMatchText } from './text';

describe('normalizeMatchText', () => {
  it('splits the payment-rail prefix off the merchant name', () => {
    expect(normalizeMatchText('Vipps*Kitch n Netthandel')).toBe('vipps kitch n netthandel');
    expect(normalizeMatchText('Zettle_*60 degrees AS')).toBe('zettle 60 degrees as');
    expect(normalizeMatchText('GOOGLE*CLOUD')).toBe('google cloud');
  });

  it('collapses whitespace runs and trims', () => {
    expect(normalizeMatchText('  PAYPAL *HIVESPETER ')).toBe('paypal hivespeter');
  });

  it('treats a missing string as empty', () => {
    expect(normalizeMatchText(undefined)).toBe('');
  });
});

describe('buildMatchHaystack', () => {
  it('lowercases and pads merchant + description with boundary spaces', () => {
    expect(buildMatchHaystack('REMA 1000', 'Kortkjøp')).toBe(' rema 1000 kortkjøp ');
  });

  it('treats missing fields as empty strings', () => {
    expect(buildMatchHaystack()).toBe('  ');
    expect(buildMatchHaystack('Vy')).toBe(' vy ');
    expect(buildMatchHaystack(undefined, 'Til:123')).toBe(' til:123 ');
  });

  it('normalizes the haystack so a needle from the same normalizer matches', () => {
    const hay = buildMatchHaystack('Vipps*Kitch n Netthandel');
    expect(hay.includes(normalizeMatchText('Vipps*Kitch n Netthandel'))).toBe(true);
  });

  it('lets a boundary-padded keyword act as a word boundary', () => {
    // ' esso' must match the fuel merchant but not the substring inside 'espresso'.
    expect(buildMatchHaystack('ESSO', '').includes(' esso')).toBe(true);
    expect(buildMatchHaystack('Espresso House', '').includes(' esso')).toBe(false);
  });
});
