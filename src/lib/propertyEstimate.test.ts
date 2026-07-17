import { describe, it, expect } from 'vitest';
import { estimatedPropertyValue } from './propertyEstimate';

describe('estimatedPropertyValue', () => {
  it('multiplies size by price per m² and rounds', () => {
    expect(estimatedPropertyValue(68, 102372)).toBe(6961296);
    expect(estimatedPropertyValue(50.5, 100000)).toBe(5050000);
  });

  it('returns null when size is missing or non-positive', () => {
    expect(estimatedPropertyValue(undefined, 100000)).toBeNull();
    expect(estimatedPropertyValue(0, 100000)).toBeNull();
    expect(estimatedPropertyValue(-10, 100000)).toBeNull();
  });

  it('returns null when price is missing or non-positive', () => {
    expect(estimatedPropertyValue(68, null)).toBeNull();
    expect(estimatedPropertyValue(68, undefined)).toBeNull();
    expect(estimatedPropertyValue(68, 0)).toBeNull();
  });

  it('never yields NaN', () => {
    expect(estimatedPropertyValue(NaN, 100000)).toBeNull();
    expect(estimatedPropertyValue(68, NaN)).toBeNull();
  });
});
