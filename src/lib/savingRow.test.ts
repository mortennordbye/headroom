import { describe, it, expect } from 'vitest';
import { classifySaving, savingDestinationBalance } from './savingRow';
import type { Goal } from '../context/FinanceContext';

const goal = (over: Partial<Goal>): Goal => ({ id: 'g1', name: 'Trip', target: 30000, source: 'savingsAccount', ...over });

describe('classifySaving', () => {
  it('marks a savings account a goal is funded from as a goal pot', () => {
    const g = goal({ savingsAccountId: 'a1' });
    expect(classifySaving({ destinationKind: 'savingsAccount', savingsAccountId: 'a1' }, [g])).toEqual({ kind: 'goal', goal: g });
  });

  it('treats an unlinked savings account as a plain account', () => {
    const goals = [goal({ savingsAccountId: 'other' }), goal({ id: 'g2', source: 'manual', savingsAccountId: 'a1' })];
    expect(classifySaving({ destinationKind: 'savingsAccount', savingsAccountId: 'a1' }, goals)).toEqual({ kind: 'account' });
    expect(classifySaving({ destinationKind: 'savingsAccount' }, [goal({})])).toEqual({ kind: 'account' });
  });

  it('maps the single-balance destinations', () => {
    expect(classifySaving({ destinationKind: 'bufferAccount' }, []).kind).toBe('buffer');
    expect(classifySaving({ destinationKind: 'bsu' }, []).kind).toBe('bsu');
    expect(classifySaving({ destinationKind: 'portfolio' }, []).kind).toBe('invested');
  });
});

describe('savingDestinationBalance', () => {
  const assets = {
    savingsAccounts: [{ id: 'a1', name: 'Trip', balance: 1200 }, { id: 'a2', name: 'Bad', balance: NaN }],
    bufferAccount: 5000,
    bsu: 0,
    portfolio: 80000,
  };

  it('reads the balance of each destination', () => {
    expect(savingDestinationBalance({ destinationKind: 'savingsAccount', savingsAccountId: 'a1' }, assets)).toBe(1200);
    expect(savingDestinationBalance({ destinationKind: 'bufferAccount' }, assets)).toBe(5000);
    expect(savingDestinationBalance({ destinationKind: 'bsu' }, assets)).toBe(0);
    expect(savingDestinationBalance({ destinationKind: 'portfolio' }, assets)).toBe(80000);
  });

  it('returns null for a missing account or a non-finite balance', () => {
    expect(savingDestinationBalance({ destinationKind: 'savingsAccount', savingsAccountId: 'gone' }, assets)).toBeNull();
    expect(savingDestinationBalance({ destinationKind: 'savingsAccount', savingsAccountId: 'a2' }, assets)).toBeNull();
    expect(savingDestinationBalance({ destinationKind: 'savingsAccount' }, { ...assets, savingsAccounts: undefined })).toBeNull();
    expect(savingDestinationBalance({ destinationKind: 'portfolio' }, { ...assets, portfolio: undefined as unknown as number })).toBeNull();
  });
});
