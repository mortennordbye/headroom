// Local, rule-based transaction categorizer. No external calls — matches a
// merchant/description against a Norwegian-merchant keyword table (and MCC as a
// secondary signal) to produce a canonical CategoryKey. Anything unmatched
// falls to 'other' so the user can correct it by hand.
//
// Pure and unit-tested. The client applies it at ingest (bank sync + backfill);
// the server never categorizes — it only preserves categories on re-sync.
import type { CategoryKey } from './categories';

export interface CategorizeInput {
  merchant?: string;
  description?: string;
  mcc?: string;
  kind?: 'income' | 'expense';
}

export interface CategorizeResult {
  category: CategoryKey;
  source: 'auto';
}

// Keyword → category. Keys are matched case-insensitively as substrings against
// the merchant name + description. Order matters only within a category; the
// first category with a hit wins (RULES order below is the priority).
const RULES: [CategoryKey, string[]][] = [
  ['groceries', [
    'rema', 'kiwi', 'coop', 'meny', 'extra', 'bunnpris', 'joker', 'spar',
    'oda', 'menu', 'europris', 'holdbart', 'obs', 'matkroken', 'dagligvare',
  ]],
  ['transport', [
    'ruter', 'vy ', 'vygruppen', 'nsb', 'flytoget', 'flixbus', 'circle k',
    'circlek', 'shell', ' esso', 'uno-x', 'unox', 'yx ', 'best ', 'st1',
    'uber', 'bolt', 'bompeng', 'autopass', 'fjellinjen', 'ferje',
    'parkering', 'easypark', 'apcoa', 'taxi', 'drivstoff',
  ]],
  ['health', [
    'apotek', 'vitus', 'boots', 'ditt apotek', 'lege', 'legevakt', 'tannlege',
    'fysio', 'sykehus', 'helse', 'optiker',
  ]],
  ['subscriptions', [
    'spotify', 'netflix', 'hbo', 'viaplay', 'disney', 'youtube',
    'apple.com/bill', 'icloud', 'storytel', 'audible', 'tv 2 play', 'nrk',
    'adobe', 'dropbox', 'patreon',
  ]],
  ['utilities', [
    'tibber', 'fjordkraft', 'hafslund', 'fortum', 'elvia', 'lyse', 'agva',
    'telenor', 'telia', 'ice ', 'onecall', 'talkmore', 'chess', 'altibox',
    'get ', 'strøm', 'nettleie',
  ]],
  ['dining', [
    'restaurant', 'cafe', 'kafe', 'kaffe', 'espresso', 'bar ', 'pub',
    'mcdonald', 'burger', 'sushi', 'pizza', 'peppes', 'dolly', 'egon',
    'foodora', 'wolt', 'just eat', 'deliveroo', 'kantine', 'bakeri', 'bakst',
    'gorm', 'starbucks', 'kebab',
  ]],
  ['entertainment', [
    'kino', 'cinema', 'nordisk film', 'sats', 'elixia', 'fresh fitness',
    'evo ', 'treningssenter', 'ticketmaster', 'billettservice', 'steam',
    'playstation', 'nintendo', 'xbox', 'vinmonopol', 'polet',
  ]],
  ['shopping', [
    'xxl', 'elkjøp', 'elkjop', 'power', 'komplett', 'clas ohlson', 'jernia',
    'h&m', 'zara', 'cubus', 'dressmann', 'zalando', 'ikea', 'jysk', 'kid ',
    'nille', 'normal', 'vita', 'kicks', 'flügger', 'flugger', 'byggmax',
    'maxbo', 'biltema', 'plantasjen',
  ]],
  ['housing', [
    'husleie', 'leie ', 'obos', 'boligbygg', 'utleie', 'depositum',
    'huseier', 'borettslag', 'sameie', 'felleskostnad',
  ]],
  ['transfers', [
    'vipps', 'overføring', 'overforing', 'til konto', 'fra konto',
    'nettbank', 'sparing', 'egen konto',
  ]],
];

// ISO 18245 merchant category codes → category, for the ranges we can map
// confidently. Consulted only when the keyword table misses.
function categoryFromMcc(mcc: string): CategoryKey | undefined {
  const n = Number(mcc);
  if (!Number.isFinite(n)) return undefined;
  if (n === 5411 || n === 5422 || n === 5451 || n === 5462) return 'groceries';
  if (n === 5541 || n === 5542 || n === 4111 || n === 4121 || n === 4131) return 'transport';
  if (n === 5812 || n === 5813 || n === 5814) return 'dining';
  if (n === 5912 || n === 8011 || n === 8021 || n === 8062 || n === 8099) return 'health';
  if (n === 7832 || n === 7841 || n === 7996 || n === 7997) return 'entertainment';
  if (n === 5921) return 'entertainment'; // package/liquor store (Vinmonopolet)
  return undefined;
}

/** Categorize a transaction. Income short-circuits to `income`. */
export function categorize(input: CategorizeInput): CategorizeResult {
  if (input.kind === 'income') return { category: 'income', source: 'auto' };

  // Pad with spaces so leading/trailing-space keywords (e.g. ' esso', 'vy ')
  // act as word boundaries — 'esso' must not match inside 'espresso'.
  const hay = ` ${input.merchant ?? ''} ${input.description ?? ''} `.toLowerCase();
  for (const [category, keywords] of RULES) {
    if (keywords.some((kw) => hay.includes(kw))) return { category, source: 'auto' };
  }

  if (input.mcc) {
    const fromMcc = categoryFromMcc(input.mcc);
    if (fromMcc) return { category: fromMcc, source: 'auto' };
  }

  return { category: 'other', source: 'auto' };
}
