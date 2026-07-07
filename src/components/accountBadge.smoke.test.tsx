import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DailyTransaction } from '../context/FinanceContext';

// User-renamed accounts: 'k1' has a friendly label, others fall back.
const mockCtx = { accountLabels: { k1: 'My Card' } as Record<string, string> };
vi.mock('../context/FinanceContext', () => ({ useFinance: () => mockCtx }));

const { AccountBadge } = await import('./AccountBadge');

const base: DailyTransaction = { id: 'eb-1', date: '2026-04-06', description: 'REMA 1000', amount: 249.9, kind: 'expense' };

describe('AccountBadge', () => {
  it('renders the account name when present', () => {
    const html = renderToStaticMarkup(<AccountBadge tx={{ ...base, account: 'ab12:u1', accountName: 'Brukskonto', bank: 'Handelsbanken' }} />);
    expect(html).toContain('Brukskonto');
    expect(html).toContain('--chart-'); // a stable per-account color token
  });

  it('falls back to the bank name when the account has no name', () => {
    const html = renderToStaticMarkup(<AccountBadge tx={{ ...base, account: 'ab12:u1', bank: 'Handelsbanken' }} />);
    expect(html).toContain('Handelsbanken');
  });

  it('renders nothing for a manual row (no account/bank)', () => {
    expect(renderToStaticMarkup(<AccountBadge tx={base} />)).toBe('');
  });

  it('prefers the user-chosen friendly name over the bank-provided name', () => {
    const html = renderToStaticMarkup(<AccountBadge tx={{ ...base, account: 'k1', accountName: 'Morten Victor Nordbye', bank: 'Bank Norwegian' }} />);
    expect(html).toContain('My Card');
    expect(html).not.toContain('Morten Victor Nordbye');
  });

  it('maps different accounts to color tokens deterministically', () => {
    const a = renderToStaticMarkup(<AccountBadge tx={{ ...base, account: 'k1', accountName: 'A' }} />);
    const again = renderToStaticMarkup(<AccountBadge tx={{ ...base, account: 'k1', accountName: 'A' }} />);
    expect(a).toBe(again); // same key → same token, stable across renders
  });
});
