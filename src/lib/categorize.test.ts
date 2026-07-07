import { describe, it, expect } from 'vitest';
import { categorize, categorizeWithRules, type CategoryRule } from './categorize';
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
    ['Overføring til Ola', 'transfers'],
    // Vipps is a payment rail, not a transfer: a shop payment is a purchase.
    ['Vipps*Kitch n Netthandel', 'shopping'],
    // International merchants (a Norwegian on a Rome trip) matched by generic words.
    ["ESQUILINO CAFFE' SRL", 'dining'],
    ['GELATERIA', 'dining'],
    ['SUPERMERCATO STELAC SRL', 'groceries'],
    ['TRENITALIA - PT WL', 'transport'],
    ['FLYBUSSEN CONNECT', 'transport'],
    ['DUTY FREE 7108 AVGANG NOR', 'shopping'],
    ['Google Workspace_nordbye', 'subscriptions'],
    // Real-data coverage: outgoing "Til:" account/person payments → transfers.
    ['Til:90467295445', 'transfers'],
    ['Til: Trustly Norway AS Betalt: 20.06.26', 'transfers'],
    ['108744502068652202 Til: MORROW BANK ASA', 'transfers'],
    // Spanish/travel merchants that used to fall into "Annet".
    ['SUPERMERCADO SANTIAGO', 'groceries'],
    ['MERCADONA PLAYA LAS AM', 'groceries'],
    ['AMEEN CASH AND CARRY', 'groceries'],
    ['FARMACIA PARK', 'health'],
    ['Wizz Air Mal', 'transport'],
    ['WWW.TERRAVISION.EU', 'transport'],
    ['ATAC TAP&GO', 'transport'],
    ['JulaNorway', 'shopping'],
    ['CLAS OHL 2852', 'shopping'],
    ['ALIEXPRESS.COM', 'shopping'],
    ['Chilimobil v/Svea Bank AB', 'utilities'],
    ['Khushi Indian Cuisine', 'dining'],
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

  it('does not tag a generic Vipps merchant payment as a transfer', () => {
    expect(categorize({ merchant: 'Vipps*Some Store AS' }).category).not.toBe('transfers');
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

describe('categorizeWithRules', () => {
  const rules: CategoryRule[] = [
    { id: '1', match: 'Til:90467295445', category: 'housing' }, // the user's loan
    { id: '2', match: 'JOJOE', category: 'dining' },
  ];

  it('applies a user rule over the built-in engine', () => {
    // "Til:90467295445" is otherwise "other"; the rule forces housing.
    expect(categorizeWithRules({ description: 'Til:90467295445' }, rules).category).toBe('housing');
  });

  it('matches case-insensitively as a substring (any JOJOE location)', () => {
    expect(categorizeWithRules({ merchant: 'JOJOERoma' }, rules).category).toBe('dining');
    expect(categorizeWithRules({ merchant: 'jojoe milano' }, rules).category).toBe('dining');
  });

  it('falls back to the built-in engine when no rule matches', () => {
    expect(categorizeWithRules({ merchant: 'REMA 1000' }, rules).category).toBe('groceries');
    expect(categorizeWithRules({ merchant: 'Unknown AS' }, rules).category).toBe('other');
  });

  it('never relabels income, even if a rule would match', () => {
    expect(categorizeWithRules({ merchant: 'JOJOERoma', kind: 'income' }, rules).category).toBe('income');
  });

  it('ignores blank rule matches', () => {
    expect(categorizeWithRules({ merchant: 'REMA 1000' }, [{ id: 'x', match: '  ', category: 'dining' }]).category).toBe('groceries');
  });
});
