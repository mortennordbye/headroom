// Forskuddstrekk: what the employer withholds each month from the user's
// skattekort, as opposed to the year's actual tax (norwegianTax.ts). The two
// differ in timing: on tabelltrekk the year's tax is spread over 10.5 months
// (no trekk in June, half in December), so a straight yearly-tax / 12 doesn't
// match the payslip, and the gap between the year's trekk and the year's tax is
// the restskatt or refund at the skatteoppgjør.
//
// Tabelltrekk follows Skatteetaten's published trekkrutine
// (github.com/Skatteetaten/trekktabell), monthly period only. Its constants
// differ from TAX_PARAMS on purpose: the trekk tables use an adjusted
// minstefradrag (40.48%, capped lower) and split the 22% into kommune + felles
// so Finnmark tables can use a lower felles rate. Verified row-for-row against
// Skatteetaten's "trekktabeller i tekstformat" file in forskuddstrekk.test.ts.

import { TAX_YEAR } from './norwegianTax';

export type TaxCard =
  | { kind: 'table'; table: string }
  | { kind: 'percent'; pct: number };

interface TrekkParams {
  personfradrag: number;
  personfradragFinnmark: number;
  trinn: Array<{ from: number; ratePct: number }>;
  trygdeFree: number;          // no trygdeavgift below this personinntekt
  trygdeOpptrappingPct: number;
  trygdeHighPct: number;
  trygdeLowPct: number;
  minstefradragPct: number;    // anvendt minstefradrag, lønn
  minstefradragMax: number;
  sjoMinstefradragPct: number;
  sjoMinstefradragMax: number;
  standardfradragPct: number;
  standardfradragMax: number;
  sjofradragPct: number;
  sjofradragMax: number;
  kommunePct: number;
  fellesPct: number;
  fellesFinnmarkPct: number;
}

// Skatteetaten trekkrutine, Konstanter.java for the year.
export const TREKK_PARAMS: Record<number, TrekkParams> = {
  2026: {
    personfradrag: 114_540,
    personfradragFinnmark: 159_540,
    trinn: [
      { from: 226_100, ratePct: 1.7 },
      { from: 318_300, ratePct: 4.0 },
      { from: 725_050, ratePct: 13.7 },
      { from: 980_100, ratePct: 16.8 },
      { from: 1_467_200, ratePct: 17.8 },
    ],
    trygdeFree: 99_650,
    trygdeOpptrappingPct: 25,
    trygdeHighPct: 7.6,
    trygdeLowPct: 5.1,
    minstefradragPct: 40.48,
    minstefradragMax: 84_216,
    sjoMinstefradragPct: 46,
    sjoMinstefradragMax: 95_700,
    standardfradragPct: 10,
    standardfradragMax: 40_000,
    sjofradragPct: 30,
    sjofradragMax: 86_300,
    kommunePct: 13.75,
    fellesPct: 8.25,
    fellesFinnmarkPct: 4.75,
  },
};

const LATEST_TREKK_YEAR = Math.max(...Object.keys(TREKK_PARAMS).map(Number));

/** The table year actually used for `year`: itself if known, else the latest published. */
export function trekkYear(year: number = TAX_YEAR): number {
  return TREKK_PARAMS[year] ? year : LATEST_TREKK_YEAR;
}

function paramsFor(year: number): TrekkParams {
  return TREKK_PARAMS[trekkYear(year)];
}

type TableType = 'vanlig' | 'standardfradrag' | 'sjo' | 'finnmark' | 'spesial';
type TrygdeType = 'high' | 'low' | 'none';

export interface TrekkTable {
  number: string;
  type: TableType;
  /** Positive = extra deduction (8xxx), negative = addition (9xxx). */
  tableFradrag: number;
  finnmark: boolean;
  trygde: TrygdeType;
  /** Trekk spread over all 12 months instead of 10.5. */
  twelveMonths: boolean;
}

// The special tables, as listed in the trekkrutine's Tabellnummer enum.
const SPECIAL: Record<string, Omit<TrekkTable, 'number' | 'tableFradrag'>> = {
  '7300': { type: 'standardfradrag', finnmark: false, trygde: 'high', twelveMonths: false },
  '7350': { type: 'standardfradrag', finnmark: false, trygde: 'high', twelveMonths: true },
  '7500': { type: 'standardfradrag', finnmark: false, trygde: 'none', twelveMonths: true },
  '7550': { type: 'standardfradrag', finnmark: false, trygde: 'none', twelveMonths: false },
  '7700': { type: 'standardfradrag', finnmark: false, trygde: 'low', twelveMonths: true },
  '6300': { type: 'finnmark', finnmark: true, trygde: 'high', twelveMonths: false },
  '6350': { type: 'finnmark', finnmark: true, trygde: 'high', twelveMonths: true },
  '6500': { type: 'finnmark', finnmark: true, trygde: 'none', twelveMonths: true },
  '6550': { type: 'finnmark', finnmark: true, trygde: 'none', twelveMonths: false },
  '6700': { type: 'finnmark', finnmark: true, trygde: 'low', twelveMonths: true },
  '0100': { type: 'sjo', finnmark: false, trygde: 'none', twelveMonths: true },
  '0101': { type: 'sjo', finnmark: false, trygde: 'high', twelveMonths: true },
  '7150': { type: 'spesial', finnmark: false, trygde: 'high', twelveMonths: true },
  '7160': { type: 'spesial', finnmark: false, trygde: 'none', twelveMonths: true },
  '7170': { type: 'spesial', finnmark: false, trygde: 'none', twelveMonths: false },
};

/**
 * Look up a table number (e.g. "8130"). Ordinary tables run 8000–8400 (an extra
 * deduction of (n − 8000) × 1 000) and 9010–9400 (an addition), in steps of 10.
 * Returns null for anything Skatteetaten doesn't publish.
 */
export function parseTableNumber(input: string): TrekkTable | null {
  const s = input.trim();
  if (!/^\d{4}$/.test(s)) return null;
  const special = SPECIAL[s];
  if (special) return { number: s, tableFradrag: 0, ...special };
  const n = Number(s);
  const ordinary = { number: s, type: 'vanlig' as const, finnmark: false, trygde: 'high' as const, twelveMonths: false };
  if (n >= 8000 && n <= 8400 && n % 10 === 0) return { ...ordinary, tableFradrag: (n - 8000) * 1000 };
  if (n >= 9010 && n <= 9400 && n % 10 === 0) return { ...ordinary, tableFradrag: -(n - 9000) * 1000 };
  return null;
}

// Monthly period constants (Periode.PERIODE_1_MAANED).
const MONTH_STEP = 100;

function minstefradrag(t: TrekkTable, P: TrekkParams, pi: number): number {
  const sjo = t.type === 'sjo';
  const m = Math.round((pi * (sjo ? P.sjoMinstefradragPct : P.minstefradragPct)) / 100);
  return Math.min(Math.max(0, Math.min(m, sjo ? P.sjoMinstefradragMax : P.minstefradragMax)), pi);
}

function trinnskatt(P: TrekkParams, pi: number): number {
  let tax = 0;
  for (let i = 0; i < P.trinn.length; i++) {
    const { from, ratePct } = P.trinn[i];
    if (pi < from) break;
    const to = P.trinn[i + 1]?.from ?? Infinity;
    tax += ((Math.min(pi, to) - from) * ratePct) / 100;
  }
  return Math.round(tax);
}

function trygdeavgift(t: TrekkTable, P: TrekkParams, pi: number): number {
  if (pi < P.trygdeFree || t.trygde === 'none') return 0;
  const ratePct = t.trygde === 'low' ? P.trygdeLowPct : P.trygdeHighPct;
  const limit = Math.round((P.trygdeFree * P.trygdeOpptrappingPct) / (P.trygdeOpptrappingPct - ratePct));
  return pi > limit
    ? Math.round((pi * ratePct) / 100)
    : Math.round(((pi - P.trygdeFree) * P.trygdeOpptrappingPct) / 100);
}

/**
 * Tabelltrekk for one month's trekkgrunnlag on a full-trekk month. Returns 0 for
 * non-finite or negative input.
 */
export function calcTabelltrekk(t: TrekkTable, monthlyGrunnlag: number, year: number = TAX_YEAR): number {
  if (!Number.isFinite(monthlyGrunnlag) || monthlyGrunnlag <= 0) return 0;
  const P = paramsFor(year);
  const grunnlag = Math.floor(monthlyGrunnlag);
  // Tables are stepped: every grunnlag in a 100-kr band uses the band's midpoint.
  const rounded = Math.floor(grunnlag / MONTH_STEP) * MONTH_STEP + MONTH_STEP / 2;
  const vanlig = t.type === 'vanlig';
  const pi = Math.round(rounded * (vanlig ? 12.12 : 12));

  const standardfradrag = t.type === 'standardfradrag' || t.type === 'sjo' || t.type === 'finnmark'
    ? Math.min(Math.round((pi * P.standardfradragPct) / 100), P.standardfradragMax)
    : 0;
  const sjofradrag = t.type === 'sjo' ? Math.min(Math.round((pi * P.sjofradragPct) / 100), P.sjofradragMax) : 0;
  const alminnelig = pi - minstefradrag(t, P, pi) - t.tableFradrag - standardfradrag - sjofradrag
    - (t.finnmark ? P.personfradragFinnmark : P.personfradrag);

  const kommune = alminnelig > 0 ? Math.round((alminnelig * P.kommunePct) / 100) : 0;
  const felles = alminnelig < 0 ? 0 : Math.round((alminnelig * (t.finnmark ? P.fellesFinnmarkPct : P.fellesPct)) / 100);
  const sumSkatt = kommune + felles + trinnskatt(P, pi) + trygdeavgift(t, P, pi);

  const perMonth = sumSkatt / (vanlig || !t.twelveMonths ? 10.5 : 12);
  const trekk = t.type === 'sjo' ? Math.floor(perMonth) : Math.round(perMonth);
  return Math.min(trekk, grunnlag);
}

/** Validated skattekort from untrusted input, or null when it isn't usable. */
export function sanitizeTaxCard(v: unknown): TaxCard | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.kind === 'table' && typeof o.table === 'string' && parseTableNumber(o.table)) {
    return { kind: 'table', table: o.table.trim() };
  }
  if (o.kind === 'percent' && typeof o.pct === 'number' && Number.isFinite(o.pct) && o.pct >= 0 && o.pct <= 100) {
    return { kind: 'percent', pct: o.pct };
  }
  return null;
}

/**
 * What is withheld from `monthlyGross` in calendar month `month` (1–12). On a
 * 10.5-month table June has no trekk and December half; 12-month tables and
 * prosenttrekk withhold the same way every month.
 */
export function withholdingForMonth(card: TaxCard, monthlyGross: number, month: number, year: number = TAX_YEAR): number {
  if (!Number.isFinite(monthlyGross) || monthlyGross <= 0) return 0;
  if (card.kind === 'percent') {
    const pct = Number.isFinite(card.pct) ? Math.min(100, Math.max(0, card.pct)) : 0;
    return Math.round((monthlyGross * pct) / 100);
  }
  const t = parseTableNumber(card.table);
  if (!t) return 0;
  const full = calcTabelltrekk(t, monthlyGross, year);
  if (t.twelveMonths) return full;
  if (month === 6) return 0;
  if (month === 12) return Math.round(full / 2);
  return full;
}

/** Withholding for each month Jan–Dec (index 0 = January). */
export function withholdingByMonth(
  card: TaxCard,
  monthlyGrossFor: (month: number) => number,
  year: number = TAX_YEAR,
): number[] {
  return Array.from({ length: 12 }, (_, i) => withholdingForMonth(card, monthlyGrossFor(i + 1), i + 1, year));
}
