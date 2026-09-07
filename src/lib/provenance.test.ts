import { describe, it, expect } from 'vitest';
import { provenanceOf } from './provenance';

describe('provenanceOf', () => {
  it('is "default" when the value equals the default', () => {
    expect(provenanceOf(5, 5)).toBe('default');
  });

  it('is "custom" when the value differs from the default', () => {
    expect(provenanceOf(5, 4)).toBe('custom');
  });
});
