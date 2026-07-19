/**
 * Approximate Norwegian wage tax (lønnsinntekt).
 *
 * Components:
 *   - Skatt på alminnelig inntekt (22%) on income after minstefradrag og personfradrag
 *   - Trinnskatt (progressive bracket tax) on gross
 *   - Trygdeavgift on gross above the lower threshold
 *
 * Brackets and deductions are estimates rounded to public figures. Real tax
 * depends on residence, marital status, deductions etc. — this is a
 * "good-enough" estimate for take-home calculations, not a tax return.
 *
 * All year-specific constants live in the `TAX_PARAMS` table below so a new tax
 * year is a single-place update and staleness is visible. `TAX_YEAR` selects the
 * active set and is exported for display in the UI.
 */

export interface TaxParams {
  skattAlminneligRate: number;
  trygdeavgiftRate: number;
  trygdeavgiftLowerLimit: number;
  minstefradragRate: number;
  minstefradragMax: number;
  personfradrag: number;
  /** Trinnskatt brackets (NOK lower bound, rate). */
  trinnskatt: Array<{ from: number; rate: number }>;
}

export const TAX_PARAMS: Record<number, TaxParams> = {
  2025: {
    skattAlminneligRate: 0.22,
    trygdeavgiftRate: 0.077,
    trygdeavgiftLowerLimit: 99_650,
    minstefradragRate: 0.46,
    minstefradragMax: 92_000,
    personfradrag: 108_550,
    trinnskatt: [
      { from: 0,          rate: 0      },
      { from: 217_400,    rate: 0.017  },
      { from: 306_050,    rate: 0.040  },
      { from: 697_150,    rate: 0.137  },
      { from: 942_400,    rate: 0.167  },
      { from: 1_410_750,  rate: 0.177  },
    ],
  },
  // Skatteetaten, Forskuddsutskrivingen 2026 (final adopted figures).
  2026: {
    skattAlminneligRate: 0.22,
    trygdeavgiftRate: 0.076,
    trygdeavgiftLowerLimit: 99_650,
    minstefradragRate: 0.46,
    minstefradragMax: 95_700,
    personfradrag: 114_540,
    trinnskatt: [
      { from: 0,          rate: 0      },
      { from: 226_100,    rate: 0.017  },
      { from: 318_300,    rate: 0.040  },
      { from: 725_050,    rate: 0.137  },
      { from: 980_100,    rate: 0.168  },
      { from: 1_467_200,  rate: 0.178  },
    ],
  },
};

/**
 * Active tax year: the newest `TAX_PARAMS` year that has started. Derived from
 * the clock so adding next year's entry activates it on Jan 1, and a missed
 * update falls back to the latest known year instead of a missing table.
 */
export const TAX_YEAR = Math.max(
  ...Object.keys(TAX_PARAMS).map(Number).filter((y) => y <= new Date().getFullYear()),
);

const PARAMS = TAX_PARAMS[TAX_YEAR];

export const IPS_MAX_DEDUCTION = 15_000;

// Mortgage-interest tax deduction (rentefradrag) rate. This is not a per-loan
// choice — interest lowers alminnelig inntekt, taxed back at the flat 22% rate —
// so it is the single source of truth for the Bolig page's "skattefradrag" line
// (previously an editable copy duplicated on both the loan and homeowner forms).
export const RENTEFRADRAG_RATE_PCT = PARAMS.skattAlminneligRate * 100;

// In the opptrapping band just above the lower limit, trygdeavgift is capped at
// 25% of income exceeding the limit — a statutory rate that phases the avgift in
// smoothly instead of it jumping to the full rate at the threshold.
const TRYGDE_OPPTRAPPING_RATE = 0.25;

function trinnskatt(gross: number, brackets: TaxParams['trinnskatt']): number {
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const lower = brackets[i].from;
    const upper = i + 1 < brackets.length ? brackets[i + 1].from : Infinity;
    if (gross <= lower) break;
    const inBracket = Math.min(gross, upper) - lower;
    tax += inBracket * brackets[i].rate;
  }
  return tax;
}

export interface NorwegianTaxBreakdown {
  gross: number;
  inntektsskatt: number;   // skatt på alminnelig inntekt
  trinnskatt: number;
  trygdeavgift: number;
  totalTax: number;
  netAnnual: number;
  netMonthly: number;
  effectiveRatePct: number;
}

export type Region = 'no' | 'generic';

/**
 * Region-aware tax calculation. For 'no' uses the Norwegian model above.
 * For 'generic' applies a flat effective rate the user sets in Settings.
 * Returned breakdown still uses the Norwegian field names so call sites stay
 * uniform; in 'generic' mode only `totalTax`, `netAnnual`, `netMonthly`,
 * `effectiveRatePct`, and `gross` are meaningful.
 */
export function calcTaxByRegion(
  grossAnnual: number,
  region: Region,
  customRatePct: number,
  ipsContribution: number = 0,
  interestDeduction: number = 0,
  bsuTaxCredit: number = 0,
): NorwegianTaxBreakdown {
  if (region === 'no') return calcNorwegianTax(grossAnnual, ipsContribution, TAX_YEAR, interestDeduction, bsuTaxCredit);
  const gross = Math.max(0, grossAnnual);
  const rate = Math.min(100, Math.max(0, customRatePct)) / 100;
  // Approximate: IPS + interest deductions also lower taxable income in generic mode at the flat rate.
  const ipsDeduction = Math.min(Math.max(0, ipsContribution), IPS_MAX_DEDUCTION);
  const interest = Math.max(0, interestDeduction);
  const taxable = Math.max(0, gross - ipsDeduction - interest);
  const rawTax = taxable * rate;
  // BSU credit applies in generic mode too, non-refundable against the flat tax.
  const totalTax = rawTax - Math.min(Math.max(0, bsuTaxCredit), rawTax);
  const netAnnual = gross - totalTax - ipsDeduction;
  return {
    gross,
    inntektsskatt: 0,
    trinnskatt: 0,
    trygdeavgift: 0,
    totalTax,
    netAnnual,
    netMonthly: netAnnual / 12,
    effectiveRatePct: gross > 0 ? (totalTax / gross) * 100 : 0,
  };
}

/**
 * Marginal tax rate on the next krone of wage income, as a percent. Computed as
 * a finite difference of `totalTax` so it captures every moving part at once:
 * the trinnskatt bracket you're in, the 22% on alminnelig inntekt (net of the
 * minstefradrag phase-in at low income), and trygdeavgift (incl. its opptrapping
 * band). Norwegian model only — in generic mode the marginal rate equals the
 * flat effective rate, so this isn't needed there.
 */
export function calcMarginalTaxRate(
  grossAnnual: number,
  ipsContribution: number = 0,
  year: number = TAX_YEAR,
  interestDeduction: number = 0,
): number {
  const gross = Math.max(0, grossAnnual);
  const delta = 1000;
  const base = calcNorwegianTax(gross, ipsContribution, year, interestDeduction).totalTax;
  const bumped = calcNorwegianTax(gross + delta, ipsContribution, year, interestDeduction).totalTax;
  return ((bumped - base) / delta) * 100;
}

export function calcNorwegianTax(
  grossAnnual: number,
  ipsContribution: number = 0,
  year: number = TAX_YEAR,
  interestDeduction: number = 0,
  bsuTaxCredit: number = 0,
): NorwegianTaxBreakdown {
  const P = TAX_PARAMS[year] ?? PARAMS;
  const gross = Math.max(0, grossAnnual);
  const ipsDeduction = Math.min(Math.max(0, ipsContribution), IPS_MAX_DEDUCTION);
  // Mortgage/loan interest (rentefradrag) reduces alminnelig inntekt, taxed back
  // at the 22% rate. Uncapped, unlike the IPS deduction.
  const interest = Math.max(0, interestDeduction);

  const minstefradrag = Math.min(gross * P.minstefradragRate, P.minstefradragMax);
  const alminneligInntekt = Math.max(0, gross - minstefradrag - ipsDeduction - interest);
  const skattegrunnlag = Math.max(0, alminneligInntekt - P.personfradrag);
  const inntektsskatt = skattegrunnlag * P.skattAlminneligRate;

  const trinn = trinnskatt(gross, P.trinnskatt);

  const trygde = gross > P.trygdeavgiftLowerLimit
    ? Math.min(
        gross * P.trygdeavgiftRate,
        TRYGDE_OPPTRAPPING_RATE * (gross - P.trygdeavgiftLowerLimit),
      )
    : 0;

  // BSU credit is a non-refundable fradrag i skatt — it can only cancel tax owed.
  const bsuCredit = Math.min(Math.max(0, bsuTaxCredit), inntektsskatt + trinn + trygde);
  const totalTax = inntektsskatt + trinn + trygde - bsuCredit;
  // IPS contribution leaves the paycheck (locked savings) — subtract from take-home.
  const netAnnual = gross - totalTax - ipsDeduction;
  const netMonthly = netAnnual / 12;
  const effectiveRatePct = gross > 0 ? (totalTax / gross) * 100 : 0;

  return {
    gross,
    inntektsskatt,
    trinnskatt: trinn,
    trygdeavgift: trygde,
    totalTax,
    netAnnual,
    netMonthly,
    effectiveRatePct,
  };
}

// ─────────────────────────── Pension-income tax (drawdown) ───────────────────
//
// Pension income (folketrygd alderspensjon, OTP and IPS payouts) is taxed
// differently from wages: a lower trygdeavgift (5.1%), its own minstefradrag
// rate/cap, and a "skattefradrag for pensjonsinntekt" that fully offsets tax on a
// minimum pension and phases out at higher pensions — so a minstepensjonist pays
// no tax. Alminnelig-inntekt rate (22%), personfradrag and the trinnskatt
// brackets are shared with the wage model (TAX_PARAMS).
//
// Simplification: we treat all three streams as ordinary pension income. New IPS
// (post-2017) is in fact taxed only as alminnelig inntekt (no trinnskatt/trygde);
// folding it in here slightly over-states its tax, which under-states net pension
// — the conservative direction — and keeps one coherent drawdown-tax function.

export interface PensionTaxParams {
  minstefradragRate: number;
  minstefradragMax: number;
  trygdeavgiftRate: number;
  skattefradragMax: number;
  skattefradragT1From: number;  // reduction starts here
  skattefradragT1Rate: number;
  skattefradragT2From: number;  // steeper reduction from here
  skattefradragT2Rate: number;
}

export const PENSION_TAX_PARAMS: Record<number, PensionTaxParams> = {
  2025: {
    minstefradragRate: 0.40,
    minstefradragMax: 73_150,
    trygdeavgiftRate: 0.051,
    skattefradragMax: 36_000,
    skattefradragT1From: 276_400,
    skattefradragT1Rate: 0.167,
    skattefradragT2From: 422_950,
    skattefradragT2Rate: 0.060,
  },
  2026: {
    minstefradragRate: 0.40,
    minstefradragMax: 75_400,
    trygdeavgiftRate: 0.051,
    skattefradragMax: 37_100,
    skattefradragT1From: 284_950,
    skattefradragT1Rate: 0.167,
    skattefradragT2From: 436_050,
    skattefradragT2Rate: 0.060,
  },
};

/** Skattefradrag for pensjonsinntekt: max, reduced in two tiers, floored at 0. */
function pensionTaxCredit(gross: number, PP: PensionTaxParams): number {
  let reduction = 0;
  if (gross > PP.skattefradragT1From) {
    reduction += (Math.min(gross, PP.skattefradragT2From) - PP.skattefradragT1From) * PP.skattefradragT1Rate;
  }
  if (gross > PP.skattefradragT2From) {
    reduction += (gross - PP.skattefradragT2From) * PP.skattefradragT2Rate;
  }
  return Math.max(0, PP.skattefradragMax - reduction);
}

/**
 * Tax on gross annual pension income in drawdown. Norwegian model only (in
 * generic mode the caller should apply its flat rate). Returns the same shape as
 * calcNorwegianTax so tiles/memos stay uniform.
 */
export function calcPensionIncomeTax(
  grossPensionAnnual: number,
  year: number = TAX_YEAR,
): NorwegianTaxBreakdown {
  const P = TAX_PARAMS[year] ?? PARAMS;
  const PP = PENSION_TAX_PARAMS[year] ?? PENSION_TAX_PARAMS[TAX_YEAR] ?? PENSION_TAX_PARAMS[2026];
  const gross = Math.max(0, grossPensionAnnual);

  const minstefradrag = Math.min(gross * PP.minstefradragRate, PP.minstefradragMax);
  const alminneligInntekt = Math.max(0, gross - minstefradrag);
  const skattegrunnlag = Math.max(0, alminneligInntekt - P.personfradrag);
  const inntektsskatt = skattegrunnlag * P.skattAlminneligRate;

  // Pension is personinntekt, so the trinnskatt brackets apply.
  const trinn = trinnskatt(gross, P.trinnskatt);
  const trygde = gross * PP.trygdeavgiftRate;

  const rawTax = inntektsskatt + trinn + trygde;
  // The credit is non-refundable — it can only cancel tax already owed.
  const credit = Math.min(pensionTaxCredit(gross, PP), rawTax);
  const totalTax = Math.max(0, rawTax - credit);

  const netAnnual = gross - totalTax;
  return {
    gross,
    inntektsskatt,
    trinnskatt: trinn,
    trygdeavgift: trygde,
    totalTax,
    netAnnual,
    netMonthly: netAnnual / 12,
    effectiveRatePct: gross > 0 ? (totalTax / gross) * 100 : 0,
  };
}

// ─────────────────────────── Formuesskatt (wealth tax) ───────────────────────
//
// Approximate Norwegian net-wealth tax. Net wealth = valued assets − debt; tax
// applies to the slice above the personal deduction (bunnfradrag). Assets are
// valued at official rates (verdsettingsrabatt): a primary residence at 25% of
// market value (70% on the part above 10M), listed shares/funds at 80%, and
// everything else (deposits, crypto, BSU, buffer) at full value.
//
// Simplifications (a "good-enough" estimate, not a tax return): single-person
// bunnfradrag (no spousal doubling), and full debt is deducted (the proportional
// gjeldsreduksjon for discount-valued assets is not modelled, so this slightly
// over-states deductible debt / under-states tax for the wealthy).

export interface WealthTaxParams {
  /** Personal deduction per person — net wealth below this is untaxed. */
  bunnfradrag: number;
  /** Rate brackets on net wealth: `from` is the NOK lower bound (first = bunnfradrag). */
  brackets: Array<{ from: number; rate: number }>;
  /** Primary residence: valued at `primaryHomeRate` up to `primaryHomeHighThreshold`, then `primaryHomeHighRate`. */
  primaryHomeRate: number;
  primaryHomeHighThreshold: number;
  primaryHomeHighRate: number;
  /** Listed shares & equity funds valuation rate (aksjerabatt). */
  sharesRate: number;
}

export const WEALTH_TAX_PARAMS: Record<number, WealthTaxParams> = {
  2025: {
    bunnfradrag: 1_760_000,
    brackets: [
      { from: 1_760_000, rate: 0.010 },
      { from: 20_700_000, rate: 0.011 },
    ],
    primaryHomeRate: 0.25,
    primaryHomeHighThreshold: 10_000_000,
    primaryHomeHighRate: 0.70,
    sharesRate: 0.80,
  },
  // Formuesskatt figures carried forward from 2025 (thresholds unchanged in the
  // adopted 2026 budget); update if Stortinget revises them.
  2026: {
    bunnfradrag: 1_760_000,
    brackets: [
      { from: 1_760_000, rate: 0.010 },
      { from: 20_700_000, rate: 0.011 },
    ],
    primaryHomeRate: 0.25,
    primaryHomeHighThreshold: 10_000_000,
    primaryHomeHighRate: 0.70,
    sharesRate: 0.80,
  },
};

const WEALTH_PARAMS = WEALTH_TAX_PARAMS[TAX_YEAR] ?? WEALTH_TAX_PARAMS[2025];

export interface WealthTaxComponents {
  /** Market value of the primary residence (valued at 25% / 70%). */
  primaryHomeValue: number;
  /** Listed shares & equity funds market value (valued at 80%). */
  shares: number;
  /** Deposits, crypto, BSU, buffer — everything valued at 100%. */
  otherAssets: number;
  /** Total deductible debt (mortgage + non-mortgage). */
  debt: number;
}

export interface WealthTaxBreakdown {
  /** Assets after valuation discounts. */
  valuedAssets: number;
  /** Valued assets − debt, floored at 0. */
  netWealth: number;
  bunnfradrag: number;
  /** Net wealth above the bunnfradrag (the taxed slice). */
  taxableBase: number;
  /** Annual formuesskatt. */
  tax: number;
  /** tax ÷ net wealth, as a percent (0 when there's no net wealth). */
  effectiveRatePct: number;
}

function valuePrimaryHome(marketValue: number, P: WealthTaxParams): number {
  const v = Math.max(0, marketValue);
  if (v <= P.primaryHomeHighThreshold) return v * P.primaryHomeRate;
  return P.primaryHomeHighThreshold * P.primaryHomeRate + (v - P.primaryHomeHighThreshold) * P.primaryHomeHighRate;
}

/**
 * Annual Norwegian wealth tax (formuesskatt) on a household's net wealth. See the
 * section header for the valuation rules and simplifications.
 */
export function calcWealthTax(c: WealthTaxComponents, year: number = TAX_YEAR): WealthTaxBreakdown {
  const P = WEALTH_TAX_PARAMS[year] ?? WEALTH_PARAMS;
  const valuedAssets =
    valuePrimaryHome(c.primaryHomeValue, P) +
    Math.max(0, c.shares) * P.sharesRate +
    Math.max(0, c.otherAssets);
  const netWealth = Math.max(0, valuedAssets - Math.max(0, c.debt));
  const taxableBase = Math.max(0, netWealth - P.bunnfradrag);
  // Each bracket taxes the slice of net wealth between its `from` and the next
  // bracket's `from`; the first bracket starts at the bunnfradrag.
  let tax = 0;
  for (let i = 0; i < P.brackets.length; i++) {
    const from = P.brackets[i].from;
    if (netWealth <= from) break;
    const to = P.brackets[i + 1]?.from ?? Infinity;
    tax += (Math.min(netWealth, to) - from) * P.brackets[i].rate;
  }
  const effectiveRatePct = netWealth > 0 ? (tax / netWealth) * 100 : 0;
  return { valuedAssets, netWealth, bunnfradrag: P.bunnfradrag, taxableBase, tax, effectiveRatePct };
}
