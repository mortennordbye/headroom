import { describe, it, expect } from 'vitest';
import { accountToken } from './accountColor';

describe('accountToken', () => {
  it('maps the same key to the same token every time', () => {
    const token = accountToken('acc-12345');
    for (let i = 0; i < 5; i++) expect(accountToken('acc-12345')).toBe(token);
  });

  it('returns one of the chart palette tokens', () => {
    expect(accountToken('another-account')).toMatch(/^--chart-[1-6]$/);
  });
});
