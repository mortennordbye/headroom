/**
 * Approximate Norwegian wage tax (lønnsinntekt) for 2025.
 *
 * Components:
 *   - Skatt på alminnelig inntekt (22%) on income after minstefradrag og personfradrag
 *   - Trinnskatt (progressive bracket tax) on gross
 *   - Trygdeavgift (7.8%) on gross above the lower threshold
 *
 * Brackets and deductions are 2025 estimates rounded to public figures.
 * Real tax depends on residence, marital status, deductions etc. — this is a
 * "good-enough" estimate for take-home calculations, not a tax return.
 */

const SKATT_ALMINNELIG_RATE = 0.22;
const TRYGDEAVGIFT_RATE = 0.078;
const TRYGDEAVGIFT_LOWER_LIMIT = 99_650;
const MINSTEFRADRAG_RATE = 0.46;
const MINSTEFRADRAG_MAX = 92_000;
const PERSONFRADRAG = 88_250;
export const IPS_MAX_DEDUCTION = 15_000;

/** Trinnskatt brackets 2025 (NOK lower bound, rate). */
const TRINNSKATT: Array<{ from: number; rate: number }> = [
  { from: 0,          rate: 0      },
  { from: 217_400,    rate: 0.017  },
  { from: 306_050,    rate: 0.040  },
  { from: 697_150,    rate: 0.137  },
  { from: 942_400,    rate: 0.167  },
  { from: 1_410_750,  rate: 0.177  },
];

function trinnskatt(gross: number): number {
  let tax = 0;
  for (let i = 0; i < TRINNSKATT.length; i++) {
    const lower = TRINNSKATT[i].from;
    const upper = i + 1 < TRINNSKATT.length ? TRINNSKATT[i + 1].from : Infinity;
    if (gross <= lower) break;
    const inBracket = Math.min(gross, upper) - lower;
    tax += inBracket * TRINNSKATT[i].rate;
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

export function calcNorwegianTax(grossAnnual: number, ipsContribution: number = 0): NorwegianTaxBreakdown {
  const gross = Math.max(0, grossAnnual);
  const ipsDeduction = Math.min(Math.max(0, ipsContribution), IPS_MAX_DEDUCTION);

  const minstefradrag = Math.min(gross * MINSTEFRADRAG_RATE, MINSTEFRADRAG_MAX);
  const alminneligInntekt = Math.max(0, gross - minstefradrag - ipsDeduction);
  const skattegrunnlag = Math.max(0, alminneligInntekt - PERSONFRADRAG);
  const inntektsskatt = skattegrunnlag * SKATT_ALMINNELIG_RATE;

  const trinn = trinnskatt(gross);

  const trygde = gross > TRYGDEAVGIFT_LOWER_LIMIT ? gross * TRYGDEAVGIFT_RATE : 0;

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
