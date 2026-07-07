import { describe, it, expect } from 'vitest';
import { ruleLabelFor, txDisplayName, type LabelRule } from './labelRules';

const rules: LabelRule[] = [
  { id: '1', match: 'Til:90467295445', label: 'Boliglån' },
  { id: '2', match: 'SPOTIFY', label: 'Musikk' },
];

describe('labelRules', () => {
  it('returns the label of a matching rule (case-insensitive substring)', () => {
    expect(ruleLabelFor({ description: 'Til:90467295445' }, rules)).toBe('Boliglån');
    expect(ruleLabelFor({ description: 'spotify p27.09.1' }, rules)).toBe('Musikk');
    expect(ruleLabelFor({ merchant: 'Spotify AB', description: '' }, rules)).toBe('Musikk');
  });

  it('returns undefined when nothing matches', () => {
    expect(ruleLabelFor({ description: 'REMA 1000' }, rules)).toBeUndefined();
  });

  it('txDisplayName prefers the custom label, else the description', () => {
    expect(txDisplayName({ description: 'Til:90467295445' }, rules)).toBe('Boliglån');
    expect(txDisplayName({ description: 'REMA 1000' }, rules)).toBe('REMA 1000');
  });

  it('ignores blank matches and empty rule sets', () => {
    expect(txDisplayName({ description: 'x' }, [{ id: 'a', match: '  ', label: 'Nope' }])).toBe('x');
    expect(txDisplayName({ description: 'x' }, [])).toBe('x');
  });
});
