import { describe, it, expect } from 'vitest';
import { findInternalTransferIds, normalizeAccountNumber } from './transfers';
import type { DailyTransaction } from '../context/FinanceContext';

const tx = (o: Partial<DailyTransaction>): DailyTransaction => ({
  id: Math.random().toString(36).slice(2), date: '2026-07-05', description: 'x', amount: 100, kind: 'expense', ...o,
});

describe('findInternalTransferIds', () => {
  it('matches an opposite-kind equal-amount pair across two accounts within the window', () => {
    const out = tx({ id: 'e1', account: 'A', kind: 'expense', amount: 5000, date: '2026-07-05' });
    const inn = tx({ id: 'i1', account: 'B', kind: 'income', amount: 5000, date: '2026-07-06' });
    const ids = findInternalTransferIds([out, inn]);
    expect(ids.has('e1')).toBe(true);
    expect(ids.has('i1')).toBe(true);
  });

  it('ignores a pair on the same account (not a transfer between two accounts)', () => {
    const out = tx({ id: 'e1', account: 'A', kind: 'expense', amount: 5000, date: '2026-07-05' });
    const inn = tx({ id: 'i1', account: 'A', kind: 'income', amount: 5000, date: '2026-07-05' });
    expect(findInternalTransferIds([out, inn]).size).toBe(0);
  });

  it('ignores amounts that differ', () => {
    const out = tx({ id: 'e1', account: 'A', kind: 'expense', amount: 5000 });
    const inn = tx({ id: 'i1', account: 'B', kind: 'income', amount: 5001 });
    expect(findInternalTransferIds([out, inn]).size).toBe(0);
  });

  it('ignores pairs outside the date window', () => {
    const out = tx({ id: 'e1', account: 'A', kind: 'expense', amount: 5000, date: '2026-07-01' });
    const inn = tx({ id: 'i1', account: 'B', kind: 'income', amount: 5000, date: '2026-07-10' });
    expect(findInternalTransferIds([out, inn]).size).toBe(0);
  });

  it('skips ambiguous matches (two equal-amount incomes for one expense)', () => {
    const out = tx({ id: 'e1', account: 'A', kind: 'expense', amount: 5000, date: '2026-07-05' });
    const i1 = tx({ id: 'i1', account: 'B', kind: 'income', amount: 5000, date: '2026-07-05' });
    const i2 = tx({ id: 'i2', account: 'C', kind: 'income', amount: 5000, date: '2026-07-06' });
    expect(findInternalTransferIds([out, i1, i2]).size).toBe(0);
  });

  it('requires both legs to come from a connected account (manual rows never match)', () => {
    const out = tx({ id: 'e1', kind: 'expense', amount: 5000, date: '2026-07-05' }); // no account
    const inn = tx({ id: 'i1', account: 'B', kind: 'income', amount: 5000, date: '2026-07-05' });
    expect(findInternalTransferIds([out, inn]).size).toBe(0);
  });

  it('matches two independent transfers without cross-claiming income legs', () => {
    const rows = [
      tx({ id: 'e1', account: 'A', kind: 'expense', amount: 1000, date: '2026-07-05' }),
      tx({ id: 'i1', account: 'B', kind: 'income', amount: 1000, date: '2026-07-05' }),
      tx({ id: 'e2', account: 'A', kind: 'expense', amount: 2000, date: '2026-07-08' }),
      tx({ id: 'i2', account: 'B', kind: 'income', amount: 2000, date: '2026-07-08' }),
    ];
    const ids = findInternalTransferIds(rows);
    expect([...ids].sort()).toEqual(['e1', 'e2', 'i1', 'i2']);
  });
});

// Fictitious account numbers (not real accounts).
const OWN_A = '11112233333';
const OWN_B = '44445566666';

describe('normalizeAccountNumber', () => {
  it('reduces a Norwegian IBAN to its 11-digit BBAN', () => {
    expect(normalizeAccountNumber('NO12 4444 5566 666')).toBe(OWN_B);
    expect(normalizeAccountNumber('no1244445566666')).toBe(OWN_B);
  });

  it('strips formatting from a BBAN and keeps foreign IBANs whole', () => {
    expect(normalizeAccountNumber('4444.55.66666')).toBe(OWN_B);
    expect(normalizeAccountNumber('SE45 5000 0000 0583 9825 7466')).toBe('SE4550000000058398257466');
  });

  it('returns empty for missing input', () => {
    expect(normalizeAccountNumber(undefined)).toBe('');
    expect(normalizeAccountNumber('  ')).toBe('');
  });
});

describe('findInternalTransferIds own-account matching', () => {
  it('marks a payment to one of the own accounts even when the amounts differ', () => {
    const out = tx({ id: 'e1', account: 'A', accountNumber: OWN_A, counterpartyAccountNumber: OWN_B, kind: 'expense', amount: 5000 });
    const inn = tx({ id: 'i1', account: 'B', accountNumber: `NO12${OWN_B}`, counterpartyAccountNumber: `NO99${OWN_A}`, kind: 'income', amount: 4990 });
    expect([...findInternalTransferIds([out, inn])].sort()).toEqual(['e1', 'i1']);
  });

  it('resolves a pair the amount matcher finds ambiguous', () => {
    const out = tx({ id: 'e1', account: 'A', accountNumber: OWN_A, counterpartyAccountNumber: OWN_B, kind: 'expense', amount: 5000 });
    const i1 = tx({ id: 'i1', account: 'B', accountNumber: OWN_B, counterpartyAccountNumber: OWN_A, kind: 'income', amount: 5000 });
    const i2 = tx({ id: 'i2', account: 'C', kind: 'income', amount: 5000, description: 'Refund' });
    expect([...findInternalTransferIds([out, i1, i2])].sort()).toEqual(['e1', 'i1']);
  });

  it('marks the leg whose counterparty is own even when the other leg is outside the window', () => {
    const out = tx({ id: 'e1', account: 'A', accountNumber: OWN_A, counterpartyAccountNumber: OWN_B, kind: 'expense', amount: 5000, date: '2026-07-01' });
    const other = tx({ id: 'x1', account: 'B', accountNumber: OWN_B, kind: 'expense', amount: 300, date: '2026-07-01' });
    expect([...findInternalTransferIds([out, other])]).toEqual(['e1']);
  });

  it('leaves payments to accounts that are not the user\'s alone', () => {
    const out = tx({ id: 'e1', account: 'A', accountNumber: OWN_A, counterpartyAccountNumber: '99998877777', kind: 'expense', amount: 5000 });
    expect(findInternalTransferIds([out]).size).toBe(0);
  });

  it('ignores a counterparty equal to the row\'s own account', () => {
    const out = tx({ id: 'e1', account: 'A', accountNumber: OWN_A, counterpartyAccountNumber: OWN_A, kind: 'expense', amount: 5000 });
    expect(findInternalTransferIds([out]).size).toBe(0);
  });

  it('ignores manual rows (no connected account) even with a matching number', () => {
    const own = tx({ id: 'x1', account: 'B', accountNumber: OWN_B, kind: 'expense', amount: 1 });
    const manual = tx({ id: 'm1', counterpartyAccountNumber: OWN_B, kind: 'expense', amount: 5000 });
    expect(findInternalTransferIds([own, manual]).size).toBe(0);
  });

  it('nets the partner leg that carries no counterparty number (debit side known)', () => {
    const out = tx({ id: 'e1', account: 'A', accountNumber: OWN_A, counterpartyAccountNumber: OWN_B, kind: 'expense', amount: 5000, date: '2026-07-05' });
    const inn = tx({ id: 'i1', account: 'B', accountNumber: OWN_B, kind: 'income', amount: 5000, date: '2026-07-06' });
    // An equal income on a third account would make the amount matcher give up;
    // the number names B, so the B leg is still found.
    const other = tx({ id: 'i2', account: 'C', accountNumber: '77778899999', kind: 'income', amount: 5000, date: '2026-07-06' });
    expect([...findInternalTransferIds([out, inn, other])].sort()).toEqual(['e1', 'i1']);
  });

  it('nets the partner leg that carries no counterparty number (credit side known)', () => {
    const out = tx({ id: 'e1', account: 'A', accountNumber: OWN_A, kind: 'expense', amount: 5000, date: '2026-07-05' });
    const other = tx({ id: 'e2', account: 'C', accountNumber: '77778899999', kind: 'expense', amount: 5000, date: '2026-07-05' });
    const inn = tx({ id: 'i1', account: 'B', accountNumber: OWN_B, counterpartyAccountNumber: `NO12${OWN_A}`, kind: 'income', amount: 5000, date: '2026-07-06' });
    expect([...findInternalTransferIds([out, other, inn])].sort()).toEqual(['e1', 'i1']);
  });

  it('does not take a payment from someone else as the partner leg', () => {
    // A → B is synced on A only; B shows an equal gift from a third party.
    const out = tx({ id: 'e1', account: 'A', accountNumber: OWN_A, counterpartyAccountNumber: OWN_B, kind: 'expense', amount: 5000, date: '2026-07-05' });
    const own = tx({ id: 'x1', account: 'B', accountNumber: OWN_B, kind: 'expense', amount: 1, date: '2026-07-01' });
    const gift = tx({ id: 'g1', account: 'B', accountNumber: OWN_B, counterpartyAccountNumber: '99998877777', kind: 'income', amount: 5000, date: '2026-07-06' });
    expect([...findInternalTransferIds([out, own, gift])]).toEqual(['e1']);
  });

  it('never starts a match from a row without its own account number (loan or card account)', () => {
    // Checking pays a linked loan account. The loan account's rows carry no
    // accountNumber; its incoming instalment names the checking account.
    const pay = tx({ id: 'e1', account: 'A', accountNumber: OWN_A, kind: 'expense', amount: 5000, date: '2026-07-05' });
    const loanIn = tx({ id: 'l1', account: 'L', counterpartyAccountNumber: OWN_A, kind: 'income', amount: 5000, date: '2026-07-05' });
    // A third-account income keeps the amount matcher out of it (ambiguous).
    const other = tx({ id: 'i2', account: 'C', kind: 'income', amount: 5000, date: '2026-07-05' });
    expect(findInternalTransferIds([pay, loanIn, other]).size).toBe(0);
  });

  it('leaves the partner alone when two rows on the named account could be it', () => {
    const out = tx({ id: 'e1', account: 'A', accountNumber: OWN_A, counterpartyAccountNumber: OWN_B, kind: 'expense', amount: 5000, date: '2026-07-05' });
    const i1 = tx({ id: 'i1', account: 'B', accountNumber: OWN_B, kind: 'income', amount: 5000, date: '2026-07-05' });
    const i2 = tx({ id: 'i2', account: 'B', accountNumber: OWN_B, kind: 'income', amount: 5000, date: '2026-07-06' });
    expect([...findInternalTransferIds([out, i1, i2])]).toEqual(['e1']);
  });
});
