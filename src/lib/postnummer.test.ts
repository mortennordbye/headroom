import { describe, it, expect } from 'vitest';
// The postnummer→kommune lookup lives in the CommonJS server engine
// (server/postnummer.js), backed by data/postnummer.tsv (Bring register).
import { lookupPostnr, kommuneForPostnr } from '../../server/postnummer.js';

describe('postnummer lookup', () => {
  it('resolves known postnumre to their kommunenummer', () => {
    expect(kommuneForPostnr('0575')).toBe('0301'); // Oslo
    expect(kommuneForPostnr('5003')).toBe('4601'); // Bergen
    expect(kommuneForPostnr('7011')).toBe('5001'); // Trondheim
  });

  it('returns the poststed alongside the kommune', () => {
    expect(lookupPostnr('0575')).toEqual({ kommunenr: '0301', poststed: 'OSLO' });
  });

  it('left-pads short numeric input to 4 digits', () => {
    // '1' → '0001' (Oslo)
    expect(kommuneForPostnr('1')).toBe('0301');
  });

  it('returns null for unknown postnumre', () => {
    expect(kommuneForPostnr('9999')).toBeNull();
    expect(lookupPostnr('9999')).toBeNull();
  });
});
