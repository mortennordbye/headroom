import { describe, it, expect } from 'vitest';
import { categoryMeta } from './categories';

describe('categoryMeta', () => {
  it('returns metadata for a canonical key', () => {
    expect(categoryMeta('groceries')).toMatchObject({ key: 'groceries', color: '#1F5A42' });
  });

  it('returns undefined for legacy/custom free-text and for undefined', () => {
    expect(categoryMeta('some legacy label')).toBeUndefined();
    expect(categoryMeta(undefined)).toBeUndefined();
  });
});
