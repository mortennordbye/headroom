import { describe, it, expect } from 'vitest';
import { buildMatchHaystack } from './text';

describe('buildMatchHaystack', () => {
  it('lowercases and pads merchant + description with boundary spaces', () => {
    expect(buildMatchHaystack('REMA 1000', 'Kortkjøp')).toBe(' rema 1000 kortkjøp ');
  });

  it('treats missing fields as empty strings', () => {
    expect(buildMatchHaystack()).toBe('   ');
    expect(buildMatchHaystack('Vy')).toBe(' vy  ');
    expect(buildMatchHaystack(undefined, 'Til:123')).toBe('  til:123 ');
  });

  it('lets a boundary-padded keyword act as a word boundary', () => {
    // ' esso' must match the fuel merchant but not the substring inside 'espresso'.
    expect(buildMatchHaystack('ESSO', '').includes(' esso')).toBe(true);
    expect(buildMatchHaystack('Espresso House', '').includes(' esso')).toBe(false);
  });
});
