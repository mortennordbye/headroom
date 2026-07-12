import { describe, it, expect } from 'vitest';
import { matchesTransferRule, type TransferRule } from './transferRules';

const rules: TransferRule[] = [
  { id: '1', match: 'Til:90467295445' },
  { id: '2', match: 'MORROW BANK' },
  { id: '3', match: '9046.13' },
];

describe('matchesTransferRule', () => {
  it('matches a rule as a case-insensitive substring of merchant+description', () => {
    expect(matchesTransferRule({ description: 'Til:90467295445' }, rules)).toBe(true);
    expect(matchesTransferRule({ description: 'til: morrow bank asa betalt' }, rules)).toBe(true);
    expect(matchesTransferRule({ description: 'Til: 9046.13.03489 Betalt: 10.07.26' }, rules)).toBe(true);
    expect(matchesTransferRule({ merchant: 'MORROW BANK ASA', description: '' }, rules)).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(matchesTransferRule({ description: 'REMA 1000 KORSVOLL' }, rules)).toBe(false);
    expect(matchesTransferRule({ merchant: 'Trustly Norway AS', description: '' }, rules)).toBe(false);
  });

  it('ignores blank matches and empty rule sets', () => {
    expect(matchesTransferRule({ description: 'anything' }, [{ id: 'a', match: '   ' }])).toBe(false);
    expect(matchesTransferRule({ description: 'anything' }, [])).toBe(false);
  });
});
