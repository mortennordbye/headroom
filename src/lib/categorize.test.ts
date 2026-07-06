import { describe, it, expect } from 'vitest';
import { categorize } from './categorize';
import { isCategoryKey } from './categories';

describe('categorize', () => {
  it('income short-circuits regardless of merchant', () => {
    expect(categorize({ merchant: 'REMA 1000', kind: 'income' }).category).toBe('income');
  });

  it.each([
    ['REMA 1000', 'groceries'],
    ['Kiwi 855 Majorstuen', 'groceries'],
    ['Coop Extra', 'groceries'],
    ['Oda.com', 'groceries'],
    ['Ruter AS', 'transport'],
    ['Circle K Storo', 'transport'],
    ['Bompenger Fjellinjen', 'transport'],
    ['EasyPark', 'transport'],
    ['Vitusapotek Sentrum', 'health'],
    ['Spotify', 'subscriptions'],
    ['Netflix.com', 'subscriptions'],
    ['Tibber', 'utilities'],
    ['Telenor Norge', 'utilities'],
    ['Foodora', 'dining'],
    ['Peppes Pizza', 'dining'],
    ['Espresso House', 'dining'],
    ['Kino Oslo', 'entertainment'],
    ['SATS Elixia', 'entertainment'],
    ['Vinmonopolet', 'entertainment'],
    ['Elkjøp Nordic', 'shopping'],
    ['IKEA Furuset', 'shopping'],
    ['Husleie mars', 'housing'],
    ['Vipps til Ola', 'transfers'],
  ])('labels "%s" as %s', (merchant, expected) => {
    expect(categorize({ merchant }).category).toBe(expected);
  });

  it('is case-insensitive and matches inside the description too', () => {
    expect(categorize({ merchant: '', description: 'kjøp hos rema 1000' }).category).toBe('groceries');
  });

  it('falls back to MCC when no keyword matches', () => {
    expect(categorize({ merchant: 'Ukjent butikk AS', mcc: '5411' }).category).toBe('groceries');
    expect(categorize({ merchant: 'Ukjent AS', mcc: '5812' }).category).toBe('dining');
  });

  it('falls back to "other" for an unknown merchant with no MCC', () => {
    expect(categorize({ merchant: 'Some Random LLC' }).category).toBe('other');
  });

  it('always returns a valid canonical key with source "auto"', () => {
    const r = categorize({ merchant: 'whatever' });
    expect(isCategoryKey(r.category)).toBe(true);
    expect(r.source).toBe('auto');
  });
});
