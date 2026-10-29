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

import { TAX_YEAR, IPS_MAX_DEDUCTION } from './norwegianTax';

export type PayPeriod = 'month' | '14d' | 'week';

// A skattekort is issued per income year; `year` is the one it was entered for.
export type TaxCard =
  // `period` absent = monthly pay.
  | { kind: 'table'; table: string; period?: PayPeriod; year: number }
  | { kind: 'percent'; pct: number; year: number };

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
  if (typeof input !== 'string') return null;
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

// Pay-period constants (trekkrutine Periode): payouts per year, payouts that
// carry trekk on a 10.5-month table, and the grunnlag step the tables use.
// `inntekt` annualises a payout on ordinary tables (the trekkrutine's 12.12 /
// 26.26 / 52.52); the special tables annualise by the plain payout count.
interface PeriodSpec { payouts: number; trekkPayouts: number; inntekt: number; step: number; juneFree: number; decemberHalf: number }
const PERIODS: Record<PayPeriod, PeriodSpec> = {
  month: { payouts: 12, trekkPayouts: 10.5, inntekt: 12.12, step: 100, juneFree: 1, decemberHalf: 1 },
  '14d': { payouts: 26, trekkPayouts: 23, inntekt: 26.26, step: 50, juneFree: 2, decemberHalf: 2 },
  week: { payouts: 52, trekkPayouts: 46, inntekt: 52.52, step: 20, juneFree: 4, decemberHalf: 4 },
};

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
 * Tabelltrekk for one payout's trekkgrunnlag on a full-trekk payout. Returns 0
 * for non-finite or negative input.
 */
export function calcTabelltrekk(
  t: TrekkTable,
  grunnlagPerPayout: number,
  year: number = TAX_YEAR,
  period: PayPeriod = 'month',
): number {
  if (!Number.isFinite(grunnlagPerPayout) || grunnlagPerPayout <= 0) return 0;
  const P = paramsFor(year);
  const S = PERIODS[period];
  const grunnlag = Math.floor(grunnlagPerPayout);
  // Tables are stepped: every grunnlag in a band uses the band's midpoint.
  const rounded = Math.floor(grunnlag / S.step) * S.step + S.step / 2;
  const vanlig = t.type === 'vanlig';
  const pi = Math.round(rounded * (vanlig ? S.inntekt : S.payouts));

  const standardfradrag = t.type === 'standardfradrag' || t.type === 'sjo' || t.type === 'finnmark'
    ? Math.min(Math.round((pi * P.standardfradragPct) / 100), P.standardfradragMax)
    : 0;
  const sjofradrag = t.type === 'sjo' ? Math.min(Math.round((pi * P.sjofradragPct) / 100), P.sjofradragMax) : 0;
  const alminnelig = pi - minstefradrag(t, P, pi) - t.tableFradrag - standardfradrag - sjofradrag
    - (t.finnmark ? P.personfradragFinnmark : P.personfradrag);

  const kommune = alminnelig > 0 ? Math.round((alminnelig * P.kommunePct) / 100) : 0;
  const felles = alminnelig < 0 ? 0 : Math.round((alminnelig * (t.finnmark ? P.fellesFinnmarkPct : P.fellesPct)) / 100);
  const sumSkatt = kommune + felles + trinnskatt(P, pi) + trygdeavgift(t, P, pi);

  const perPayout = sumSkatt / (vanlig || !t.twelveMonths ? S.trekkPayouts : S.payouts);
  const trekk = t.type === 'sjo' ? Math.floor(perPayout) : Math.round(perPayout);
  return Math.min(trekk, grunnlag);
}

const PAY_PERIODS: readonly PayPeriod[] = ['month', '14d', 'week'];

/** Validated skattekort from untrusted input, or null when it isn't usable. */
export function sanitizeTaxCard(v: unknown): TaxCard | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.year !== 'number' || !Number.isInteger(o.year) || o.year < 2000 || o.year > 2100) return null;
  const year = o.year;
  if (o.kind === 'table' && typeof o.table === 'string' && parseTableNumber(o.table)) {
    if (o.period === undefined) return { kind: 'table', table: o.table.trim(), year };
    if (!PAY_PERIODS.includes(o.period as PayPeriod)) return null;
    return { kind: 'table', table: o.table.trim(), period: o.period as PayPeriod, year };
  }
  if (o.kind === 'percent' && typeof o.pct === 'number' && Number.isFinite(o.pct) && o.pct >= 0 && o.pct <= 100) {
    return { kind: 'percent', pct: o.pct, year };
  }
  return null;
}

/**
 * What is withheld in calendar month `month` (1–12) from that month's regular
 * gross plus any one-off `extraGross` (bonus, overtime) paid that month.
 *
 * Regular pay: on a 10.5-month table June's payouts carry no trekk and
 * December's carry half (one payout each on monthly pay, two on 14-day, four on
 * weekly); the remaining payouts are spread evenly over the other ten months, so
 * the year withholds exactly the table's trekk-payout count. 12-month tables and
 * prosenttrekk withhold the same way every month.
 *
 * One-off pay goes through the table on top of one regular payout (the trekk
 * the payout gains), in any month, June included.
 */
export function withholdingForMonth(
  card: TaxCard,
  monthlyGross: number,
  month: number,
  extraGross: number = 0,
  year: number = TAX_YEAR,
): number {
  const gross = Number.isFinite(monthlyGross) && monthlyGross > 0 ? monthlyGross : 0;
  const extra = Number.isFinite(extraGross) && extraGross > 0 ? extraGross : 0;
  if (card.kind === 'percent') {
    const pct = Number.isFinite(card.pct) ? Math.min(100, Math.max(0, card.pct)) : 0;
    return Math.round(((gross + extra) * pct) / 100);
  }
  const t = parseTableNumber(card.table);
  if (!t) return 0;
  const period: PayPeriod = card.period && PERIODS[card.period] ? card.period : 'month';
  const S = PERIODS[period];
  const perPayout = (gross * 12) / S.payouts;
  const full = calcTabelltrekk(t, perPayout, year, period);
  const extraTrekk = extra > 0 ? calcTabelltrekk(t, perPayout + extra, year, period) - full : 0;

  let regular: number;
  if (t.twelveMonths) regular = full * (S.payouts / 12);
  else if (month === 6) regular = 0;
  else if (month === 12) regular = (full / 2) * S.decemberHalf;
  else regular = full * ((S.payouts - S.juneFree - S.decemberHalf) / 10);
  return Math.round(regular + extraTrekk);
}

/** Withholding for each month Jan–Dec (index 0 = January). */
export function withholdingByMonth(
  card: TaxCard,
  monthlyGrossFor: (month: number) => number,
  extraGrossFor: (month: number) => number = () => 0,
  year: number = TAX_YEAR,
): number[] {
  return Array.from({ length: 12 }, (_, i) =>
    withholdingForMonth(card, monthlyGrossFor(i + 1), i + 1, extraGrossFor(i + 1), year));
}

/**
 * A budget month's flat take-home on a skattekort, or null when the card doesn't
 * apply (no usable card, another region, or a month outside the card's year).
 *
 * Flat on purpose: budget income is a smoothed monthly figure that the seasonal
 * model (`feriepengerMonthlyNet`) shapes into June/December itself, so the card
 * contributes its *yearly* regular trekk spread over 12 months, not the June 0 /
 * December half pattern (that would count the season twice). One-off pay that
 * month nets out at the card's trekk on it. IPS leaves the paycheck, as in the
 * annual model. The table already carries the user's deductions.
 *
 * `holidaySurplusAnnual` (`feriepengerSurplus`) is paid in June on top of salary:
 * trekkfri on a table card, withheld at the card's percent on a prosentkort.
 */
export function cardNetForMonth(
  rawCard: unknown,
  region: string,
  monthKey: string,
  grossAnnual: number,
  extraGross: number,
  ipsAnnualContribution: number,
  holidaySurplusAnnual: number = 0,
): number | null {
  const card = sanitizeTaxCard(rawCard);
  if (!card || region !== 'no' || !monthKey.startsWith(`${card.year}-`)) return null;
  const month = Number(monthKey.slice(5, 7));
  const monthlyGross = Number.isFinite(grossAnnual) ? Math.max(0, grossAnnual) / 12 : 0;
  const extra = Number.isFinite(extraGross) ? Math.max(0, extraGross) : 0;
  const ips = Number.isFinite(ipsAnnualContribution) ? Math.min(Math.max(0, ipsAnnualContribution), IPS_MAX_DEDUCTION) / 12 : 0;
  const yearlyRegular = withholdingByMonth(card, () => monthlyGross, undefined, card.year).reduce((sum, w) => sum + w, 0);
  const extraTrekk = extra > 0
    ? withholdingForMonth(card, monthlyGross, month, extra, card.year) - withholdingForMonth(card, monthlyGross, month, 0, card.year)
    : 0;
  const surplus = Number.isFinite(holidaySurplusAnnual) ? holidaySurplusAnnual : 0;
  const surplusNet = card.kind === 'percent' ? surplus * (1 - Math.min(100, Math.max(0, card.pct)) / 100) : surplus;
  return Math.round(monthlyGross - yearlyRegular / 12 + extra - extraTrekk - ips + surplusNet / 12);
}
