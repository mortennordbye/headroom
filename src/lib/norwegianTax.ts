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
): NorwegianTaxBreakdown {
  if (region === 'no') return calcNorwegianTax(grossAnnual, ipsContribution);
  const gross = Math.max(0, grossAnnual);
  const rate = Math.min(100, Math.max(0, customRatePct)) / 100;
  // Approximate: IPS deduction also lowers taxable income in generic mode at the same flat rate.
  const ipsDeduction = Math.min(Math.max(0, ipsContribution), IPS_MAX_DEDUCTION);
  const taxable = Math.max(0, gross - ipsDeduction);
  const totalTax = taxable * rate;
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
): number {
  const gross = Math.max(0, grossAnnual);
  const delta = 1000;
  const base = calcNorwegianTax(gross, ipsContribution, year).totalTax;
  const bumped = calcNorwegianTax(gross + delta, ipsContribution, year).totalTax;
  return ((bumped - base) / delta) * 100;
}

export function calcNorwegianTax(
  grossAnnual: number,
  ipsContribution: number = 0,
  year: number = TAX_YEAR,
): NorwegianTaxBreakdown {
  const P = TAX_PARAMS[year] ?? PARAMS;
  const gross = Math.max(0, grossAnnual);
  const ipsDeduction = Math.min(Math.max(0, ipsContribution), IPS_MAX_DEDUCTION);

  const minstefradrag = Math.min(gross * P.minstefradragRate, P.minstefradragMax);
  const alminneligInntekt = Math.max(0, gross - minstefradrag - ipsDeduction);
  const skattegrunnlag = Math.max(0, alminneligInntekt - P.personfradrag);
  const inntektsskatt = skattegrunnlag * P.skattAlminneligRate;

  const trinn = trinnskatt(gross, P.trinnskatt);

  const trygde = gross > P.trygdeavgiftLowerLimit
    ? Math.min(
        gross * P.trygdeavgiftRate,
        TRYGDE_OPPTRAPPING_RATE * (gross - P.trygdeavgiftLowerLimit),
      )
    : 0;

  const totalTax = inntektsskatt + trinn + trygde;
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
