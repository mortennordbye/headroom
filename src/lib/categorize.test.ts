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
    // International merchants (a Norwegian on a Rome trip) matched by generic words.
    ["ESQUILINO CAFFE' SRL", 'dining'],
    ['GELATERIA', 'dining'],
    ['SUPERMERCATO STELAC SRL', 'groceries'],
    ['TRENITALIA - PT WL', 'transport'],
    ['FLYBUSSEN CONNECT', 'transport'],
    ['DUTY FREE 7108 AVGANG NOR', 'shopping'],
    ['Google Workspace_nordbye', 'subscriptions'],
  ])('labels "%s" as %s', (merchant, expected) => {
    expect(categorize({ merchant }).category).toBe(expected);
  });

  it.each([
    ['5651', 'shopping'],   // family clothing (apparel range)
    ['5812', 'dining'],     // restaurants
    ['4121', 'transport'],  // taxis
    ['3010', 'transport'],  // an airline (3000–3299 range)
    ['3366', 'transport'],  // a car-rental agency (3351–3500 range)
    ['5947', 'shopping'],   // gift/souvenir shop
    ['4814', 'utilities'],  // telecom
    ['5815', 'subscriptions'], // digital goods
  ])('maps MCC %s → %s for an unknown foreign merchant', (mcc, expected) => {
    expect(categorize({ merchant: 'Sconosciuto SRL', mcc }).category).toBe(expected);
  });

  it('leaves lodging MCC (3501–3999) unmapped → other', () => {
    expect(categorize({ merchant: 'Hotel Roma', mcc: '3700' }).category).toBe('other');
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
