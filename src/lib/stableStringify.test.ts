import { describe, it, expect } from 'vitest';
import { stableStringify } from './stableStringify';

describe('stableStringify', () => {
  it('is insensitive to object key order, recursively', () => {
    const a = { x: 1, nested: { b: 2, a: [{ q: 1, p: 2 }] } };
    const b = { nested: { a: [{ p: 2, q: 1 }], b: 2 }, x: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('preserves array order (arrays are data, not sets)', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it('distinguishes genuinely different values', () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 1, b: 0 }));
  });

  it('drops undefined-valued keys like JSON.stringify does', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });

  it('handles primitives and null', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(42)).toBe('42');
    expect(stableStringify('x')).toBe('"x"');
  });
});
