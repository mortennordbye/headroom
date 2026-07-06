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
    // Generic / international grocery words.
    'supermercato', 'supermarket', 'mercato', 'grocery', 'aldi', 'lidl', 'carrefour',
  ]],
  ['transport', [
    'ruter', 'vy ', 'vygruppen', 'nsb', 'flytoget', 'flixbus', 'circle k',
    'circlek', 'shell', ' esso', 'uno-x', 'unox', 'yx ', 'best ', 'st1',
    'uber', 'bolt', 'bompeng', 'autopass', 'fjellinjen', 'ferje',
    'parkering', 'easypark', 'apcoa', 'taxi', 'drivstoff',
    // Airport bus + international rail/air (a trip abroad still means transport).
    'flybuss', 'trenitalia', 'italo ', 'aeroport', 'aeroporto', 'airport', 'ryanair',
  ]],
  ['health', [
    'apotek', 'vitus', 'boots', 'ditt apotek', 'lege', 'legevakt', 'tannlege',
    'fysio', 'sykehus', 'helse', 'optiker',
  ]],
  ['subscriptions', [
    'spotify', 'netflix', 'hbo', 'viaplay', 'disney', 'youtube',
    'apple.com/bill', 'icloud', 'storytel', 'audible', 'tv 2 play', 'nrk',
    'adobe', 'dropbox', 'patreon',
    // SaaS / productivity that bill monthly.
    'google workspace', 'google cloud', 'microsoft 365', 'office 365', 'github',
    'openai', 'chatgpt', 'anthropic', 'claude.ai', 'notion', 'linkedin',
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
    // Generic international food words — a Norwegian abroad still eats out.
    'caffe', 'caffè', 'gelateria', 'gelato', 'ristorante', 'trattoria',
    'osteria', 'pizzeria', 'bistro', 'brasserie', 'taverna', 'tapas',
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
    'duty free', 'tax free',
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

// ISO 18245 merchant category codes → category. The language-independent signal:
// a merchant's MCC is the same whether the card was swiped in Oslo or Rome, so
// this is what rescues a Norwegian's foreign transactions from "other". Consulted
// only when the keyword table misses. Codes we can't map confidently (e.g. lodging
// 3501–3999, cash/financial) are left out and fall through to 'other'.
const MCC_EXACT: Record<number, CategoryKey> = {
  // Groceries / food stores
  5411: 'groceries', 5422: 'groceries', 5441: 'groceries', 5451: 'groceries',
  5462: 'groceries', 5499: 'groceries',
  // Dining
  5811: 'dining', 5812: 'dining', 5813: 'dining', 5814: 'dining',
  // Transport (transit, rail, taxi, bus, fuel, tolls, parking, air carriers)
  4011: 'transport', 4111: 'transport', 4112: 'transport', 4121: 'transport',
  4131: 'transport', 4511: 'transport', 4784: 'transport', 4789: 'transport',
  5541: 'transport', 5542: 'transport', 7523: 'transport',
  // Health
  5912: 'health', 5975: 'health', 5976: 'health', 8011: 'health', 8021: 'health',
  8031: 'health', 8041: 'health', 8042: 'health', 8043: 'health', 8049: 'health',
  8050: 'health', 8062: 'health', 8071: 'health', 8099: 'health',
  // Entertainment / recreation
  5921: 'entertainment', // package/liquor store (Vinmonopolet)
  7832: 'entertainment', 7841: 'entertainment', 7911: 'entertainment',
  7922: 'entertainment', 7929: 'entertainment', 7932: 'entertainment',
  7933: 'entertainment', 7941: 'entertainment', 7991: 'entertainment',
  7992: 'entertainment', 7993: 'entertainment', 7994: 'entertainment',
  7996: 'entertainment', 7997: 'entertainment', 7998: 'entertainment',
  7999: 'entertainment',
  // Shopping / retail
  5200: 'shopping', 5211: 'shopping', 5231: 'shopping', 5251: 'shopping',
  5261: 'shopping', 5300: 'shopping', 5310: 'shopping', 5311: 'shopping',
  5331: 'shopping', 5399: 'shopping', 5722: 'shopping', 5732: 'shopping',
  5733: 'shopping', 5734: 'shopping', 5735: 'shopping', 5941: 'shopping',
  5942: 'shopping', 5943: 'shopping', 5944: 'shopping', 5945: 'shopping',
  5946: 'shopping', 5947: 'shopping', 5948: 'shopping', 5949: 'shopping',
  5950: 'shopping', 5964: 'shopping', 5970: 'shopping', 5977: 'shopping',
  5992: 'shopping', 5999: 'shopping',
  // Utilities / telecom
  4814: 'utilities', 4815: 'utilities', 4816: 'utilities', 4821: 'utilities',
  4899: 'utilities', 4900: 'utilities',
  // Digital goods → recurring subscriptions
  5815: 'subscriptions', 5816: 'subscriptions', 5817: 'subscriptions', 5818: 'subscriptions',
  // Housing
  6513: 'housing',
};

function categoryFromMcc(mcc: string): CategoryKey | undefined {
  const n = Number(mcc);
  if (!Number.isFinite(n)) return undefined;
  const exact = MCC_EXACT[n];
  if (exact) return exact;
  // Ranges: airline codes (3000–3299) and car-rental codes (3351–3500) are
  // per-carrier; lodging (3501–3999) is deliberately not mapped (no travel
  // category). Apparel (5611–5699) and home furnishings (5711–5719) → shopping.
  if (n >= 3000 && n <= 3299) return 'transport';
  if (n >= 3351 && n <= 3500) return 'transport';
  if (n >= 5611 && n <= 5699) return 'shopping';
  if (n >= 5711 && n <= 5719) return 'shopping';
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
