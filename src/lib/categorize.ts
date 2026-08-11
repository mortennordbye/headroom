// Local, rule-based transaction categorizer. No external calls — matches a
// merchant/description against a Norwegian-merchant keyword table (and MCC as a
// secondary signal) to produce a canonical CategoryKey. Anything unmatched
// falls to 'other' so the user can correct it by hand.
//
// Pure and unit-tested. The client applies it at ingest (bank sync + backfill);
// the server never categorizes — it only preserves categories on re-sync.
import type { CategoryKey } from './categories';
import { buildMatchHaystack } from './text';

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

// A user-defined rule: any transaction whose merchant+description contains
// `match` (case-insensitive) is forced to `category`. Rules override the
// built-in keyword/MCC engine — they're how the user teaches the app about
// merchants and account numbers it can't know generically (e.g. their loan).
export interface CategoryRule {
  id: string;
  match: string;
  category: CategoryKey;
}

// Keyword → category. Keys are matched case-insensitively as substrings against
// the merchant name + description. Order matters only within a category; the
// first category with a hit wins (RULES order below is the priority).
const RULES: [CategoryKey, string[]][] = [
  ['groceries', [
    'rema', 'kiwi', 'coop', 'meny', 'extra', 'bunnpris', 'joker', 'spar',
    'oda', 'menu', 'europris', 'holdbart', 'obs', 'matkroken', 'dagligvare',
    // Border-trade (Sverige/Nordby) and immigrant/specialty food shops — grocery
    // runs, just not under a chain name the table already knows.
    'maximat', 'gottebiten', 'scanasia', 'international food', 'storo internati',
    // Generic / international grocery words.
    'supermercato', 'supermarket', 'mercato', 'grocery', 'aldi', 'lidl', 'carrefour',
    // Spanish/Italian supermarkets + wholesale (Tenerife/Spain/Roma trips):
    // 'mercado' also covers supermercado/mercadona; cash-and-carry are grocery
    // wholesalers — matched on 'cash and car' because card feeds truncate the
    // merchant at ~22 chars ("DON HAPPY CASH AND CAR"). 'pam local' is PAM's
    // Italian convenience format.
    'mercado', 'mercadona', 'cash and car', 'pam local',
  ]],
  ['transport', [
    'ruter', 'vy ', 'vygruppen', 'nsb', 'flytoget', 'flixbus', 'circle k',
    'circlek', 'shell', ' esso', 'uno-x', 'unox', 'yx ', 'best ', 'st1',
    'uber', 'bolt', 'bompeng', 'autopass', 'fjellinjen', 'ferje',
    'parkering', 'easypark', 'apcoa', 'taxi', 'drivstoff',
    // Rail infrastructure charges (station gates, Bane NOR) and the Nordic
    // e-scooter operators.
    'bane nor', 'banenor', ' ryde', 'voi technology',
    // Airport bus + international rail/air (a trip abroad still means transport).
    // Bare 'airport' is intentionally omitted — it would mislabel airport retail;
    // flights are covered by MCC (3000–3299, 4511) and the terms below.
    // 'finnair' must stay ahead of shopping's ' finn' (finn.no) prefix.
    'flybuss', 'trenitalia', 'italo ', 'aeroporto', 'ryanair', 'wizz air', 'wizzair',
    'finnair',
    // Public-transit operators / contactless transit taps + airport buses seen abroad.
    'atac', 'tap&go', 'tap and go', 'metro ', 'tram ', 'terravision', 'titsa',
  ]],
  ['health', [
    'apotek', 'vitus', 'boots', 'ditt apotek', 'lege', 'legevakt', 'tannlege',
    'fysio', 'sykehus', 'helse', 'optiker',
    // Spanish/Italian pharmacy.
    'farmacia',
  ]],
  // Ahead of 'shopping' so a barbershop isn't caught by its broad 'shop' keyword.
  ['personalcare', [
    'frisør', 'frisor', 'barber', 'hudpleie', 'hårpleie', 'harpleie',
    'negle', 'peluqueria',
  ]],
  ['subscriptions', [
    'spotify', 'netflix', 'hbo', 'viaplay', 'disney', 'youtube',
    'apple.com/bill', 'icloud', 'storytel', 'audible', 'tv 2 play', 'nrk',
    'adobe', 'dropbox', 'patreon',
    // SaaS / productivity that bill monthly.
    'google workspace', 'google cloud', 'microsoft 365', 'office 365', 'github',
    'openai', 'chatgpt', 'anthropic', 'claude.ai', 'notion', 'linkedin',
    // Domains + hosting bill on the same recurring footing as any other SaaS.
    'domeneshop', 'domene', 'webhotell', 'hosting',
  ]],
  ['utilities', [
    'tibber', 'fjordkraft', 'hafslund', 'fortum', 'elvia', 'lyse', 'agva',
    'telenor', 'telia', 'ice ', 'onecall', 'talkmore', 'chess', 'altibox',
    'get ', 'strøm', 'nettleie', 'chilimobil',
  ]],
  ['insurance', [
    'forsikring', 'insurance', 'seguros', 'gjensidige', 'fremtind', 'tryg ',
    'frende', 'eika forsikring',
  ]],
  ['dining', [
    'restaurant', 'cafe', 'kafe', 'kaffe', 'coffee', 'espresso', 'bar ', 'pub',
    'mcdonald', 'burger', 'sushi', 'pizza', 'peppes', 'dolly', 'egon',
    'foodora', 'wolt', 'just eat', 'deliveroo', 'kantine', 'bakeri', 'bakst',
    'gorm', 'starbucks', 'kebab',
    // Norwegian eating-out words the chain list misses: inns, roadside kiosks
    // and food halls. Kiosk chains sell coffee/hot food, so they read as dining
    // rather than a grocery run.
    'gjestgiveri', 'vertshus', 'kro ', 'gatekjøkken', 'gatekjokken', 'spiseri',
    'konditori', 'street food', 'matbar', 'smoothie', 'juicebar',
    'narvesen', '7-eleven', 'seven eleven', 'deli de luca', ' mix ', 'on the run',
    // Card feeds truncate the merchant at ~22 chars, so match the stub:
    // "Oslo Street F(ood)".
    'street f',
    // Airport / travel-hub food operators — the same handful runs the F&B in
    // most European terminals, so these generalise well.
    'ssp-', 'hmshost', 'autogrill', 'select service',
    // Generic international food words — a Norwegian abroad still eats out.
    'caffe', 'caffè', 'gelateria', 'gelato', 'ristorante', 'trattoria',
    'osteria', 'pizzeria', 'bistro', 'brasserie', 'taverna', 'tapas',
    'restaura', 'cuisine', 'namaste', 'tandoori', 'ramen', 'chicken', 'wok ',
    'noodle', 'taipan', 'genghis khan', 'gandhi',
    // Named Oslo eating/drinking spots whose merchant string carries no other
    // signal. Safe to prune — they only ever help someone who eats there.
    'chan miyagi', 'jin yuan', 'trang foedsel', 'fotballfesten', ' brygg ',
  ]],
  ['entertainment', [
    'kino', 'cinema', 'nordisk film', 'sats', 'elixia', 'fresh fitness',
    'evo ', 'treningssenter', 'ticketmaster', 'billettservice', 'steam',
    'playstation', 'nintendo', 'xbox', 'vinmonopol', 'polet',
    // Live sport + sightseeing admissions.
    'ishockey', 'stadion', 'museum', 'museo', 'basilica',
  ]],
  ['travel', [
    // Lodging and the trip itself. Flights, trains and transit stay in
    // 'transport' (matched earlier) — this is where you sleep and what you book.
    'hotel', 'hotell', 'hostel', 'resort', 'booking.com', 'airbnb', 'expedia',
    'scandic', 'radisson', 'apartamentos', 'overnatting', 'camping',
    'vandrerhjem', 'palm beach', 'attractiontickets', 'getyourguide',
  ]],
  ['shopping', [
    'xxl', 'elkjøp', 'elkjop', 'power', 'komplett', 'clas ohl', 'jernia',
    'h&m', 'zara', 'cubus', 'dressmann', 'zalando', 'ikea', 'jysk', 'kid ',
    'nille', 'normal', 'vita', 'kicks', 'flügger', 'flugger', 'byggmax',
    'maxbo', 'biltema', 'plantasjen', 'jula', 'anton sport', 'outnorth',
    'duty free', 'tax free', 'duty-free', 'netthandel', 'aliexpress',
    // Bookshops, shopping centres, bikes.
    ' ark ', 'bokhandel', 'norli', 'tanum', 'akademika', 'kjøpesenter',
    'kjopesenter', 'sykkel',
    // Norwegian online retail chains that bill through a payment rail
    // ("Vipps*NETONNET"), so no .no domain reaches the fallback below.
    'blivakker', 'netonnet', 'elektroimport',
    // Retail chains met abroad: Flying Tiger, Mango, the Canary Islands' Fund
    // Grube, and the airport travel-retail operators.
    'flying tiger', 'tiger ', 'mango ', 'fund grube', 'avolta', 'dufry',
    // Generic web-shop words. 'shop' is deliberately broad and sits this late so
    // dining ("coffee shop") and personal care ("barbershop") claim theirs first.
    'shop', 'webstore', ' finn',
  ]],
  ['housing', [
    'husleie', 'leie ', 'obos', 'boligbygg', 'utleie', 'depositum',
    'huseier', 'borettslag', 'sameie', 'felleskostnad',
  ]],
  // NB: 'vipps' is deliberately NOT here — Vipps is a payment rail used far more
  // for buying from shops ("Vipps*Merchant") than for peer transfers, so matching
  // it wholesale mislabels ordinary purchases as transfers. Genuine peer/own-account
  // Vipps moves fall through to 'other' (or a user rule).
  ['transfers', [
    'overføring', 'overforing', 'overførsel', 'overforsel', 'til konto', 'fra konto',
    'nettbank', 'sparing', 'egen konto', ' giro ',
    // Norwegian bank feeds prefix an outgoing account/person payment with "Til:"
    // (To:) — loans, savings moves, card payments and peer transfers all use it.
    // Purchases never do, so this is a strong, generic transfer signal. Specific
    // destinations (e.g. a loan) can be reassigned with a user rule.
    'til:', 'trustly',
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
  // Travel: lodging, travel agencies, tourist attractions
  7011: 'travel', 4722: 'travel', 7012: 'travel', 7033: 'travel',
  // Personal care: barber/beauty shops, day spas
  7230: 'personalcare', 7297: 'personalcare', 7298: 'personalcare',
  // Insurance
  5960: 'insurance', 6300: 'insurance',
  // Housing
  6513: 'housing',
};

// A `.no` domain sitting at a word boundary, e.g. "STOVSUGERPOSER.NO" — but not
// the "no" of a sentence, and not a longer TLD-looking tail (".nordic").
const NO_DOMAIN = /[a-z0-9-]\.no(?![a-z0-9])/;

function categoryFromMcc(mcc: string): CategoryKey | undefined {
  const n = Number(mcc);
  if (!Number.isFinite(n)) return undefined;
  const exact = MCC_EXACT[n];
  if (exact) return exact;
  // Ranges: airline codes (3000–3299) and car-rental codes (3351–3500) are
  // per-carrier and stay transport; the per-chain lodging codes (3501–3999) are
  // travel. Apparel (5611–5699) and home furnishings (5711–5719) → shopping.
  if (n >= 3000 && n <= 3299) return 'transport';
  if (n >= 3351 && n <= 3500) return 'transport';
  if (n >= 3501 && n <= 3999) return 'travel';
  if (n >= 5611 && n <= 5699) return 'shopping';
  if (n >= 5711 && n <= 5719) return 'shopping';
  return undefined;
}

/**
 * Categorize with user rules taking priority over the built-in engine. Income
 * still short-circuits to `income` (rules never relabel income). Used at the
 * ingest/backfill chokepoint so a rule the user adds relabels every matching
 * row, past and future.
 */
export function categorizeWithRules(input: CategorizeInput, rules: CategoryRule[]): CategorizeResult {
  if (input.kind === 'income') return { category: 'income', source: 'auto' };
  if (rules && rules.length) {
    const hay = buildMatchHaystack(input.merchant, input.description);
    for (const r of rules) {
      const m = (r.match || '').trim().toLowerCase();
      if (m && hay.includes(m)) return { category: r.category, source: 'auto' };
    }
  }
  return categorize(input);
}

/** Categorize a transaction. Income short-circuits to `income`. */
export function categorize(input: CategorizeInput): CategorizeResult {
  if (input.kind === 'income') return { category: 'income', source: 'auto' };

  const hay = buildMatchHaystack(input.merchant, input.description);
  for (const [category, keywords] of RULES) {
    if (keywords.some((kw) => hay.includes(kw))) return { category, source: 'auto' };
  }

  if (input.mcc) {
    const fromMcc = categoryFromMcc(input.mcc);
    if (fromMcc) return { category: fromMcc, source: 'auto' };
  }

  // Last resort before giving up: a merchant string that is a .no domain is a
  // Norwegian web shop ("stovsugerposer.no", "sykkelkomponenter.no"). Anything
  // with a better signal — a bank, an insurer, a utility — matched a keyword
  // above, so what reaches here is the long tail of small online retailers.
  if (NO_DOMAIN.test(hay)) return { category: 'shopping', source: 'auto' };

  return { category: 'other', source: 'auto' };
}
