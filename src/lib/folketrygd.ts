// Folketrygd (NAV state pension) estimate for the modern "påslagsmodell" that
// applies to everyone born in 1963 or later (alleårsregelen). Pure + unit-tested.
//
// How it works (and the simplifications we deliberately take — all disclosed
// in-UI, none are TODOs):
//
//   1. Each year you accrue 18.1% of pensionable income up to 7.1G into a notional
//      "pensjonsbeholdning" held at NAV. Unlike OTP/IPS this is NOT market-funded —
//      it is regulated annually by wage growth (G), so in *today's kroner* it
//      neither compounds nor decays. We therefore project it flat-in-real-terms:
//      `beholdning + yearsToRetire × annualAccrual`, with income held at today's
//      level. (Contrast pensionFutureValue() for OTP/IPS, which do compound.)
//
//   2. At withdrawal the beholdning is converted to a lifelong annual pension by
//      dividing by the cohort's "delingstall" (life-expectancy adjustment):
//      `inntektspensjon = beholdning / delingstall`. NAV publishes delingstall per
//      cohort at each withdrawal age; we anchor on the age-67 table (1954–2000,
//      interpolated) and adjust ~0.55/yr for other retirement ages.
//
//   3. A garantipensjon floor protects low earners: the guarantee is reduced by
//      80% of the income pension (avkorting), so the total is
//      `inntektspensjon + max(0, garantipensjon − 0.80 × inntektspensjon)`.
//      We use full trygdetid (40 yr) and don't levealdersjuster the guarantee —
//      it only binds for very low earners, where the effect is small.
//
// Amounts are gross (pre-tax); drawdown tax is applied by calcPensionIncomeTax
// in norwegianTax.ts.

export interface FolketrygdParams {
  grunnbelop: number;        // G per 1 May, in kr
  garantipensjonSingle: number;  // høy sats (enslig), annual kr at full trygdetid
  garantipensjonMarried: number; // ordinær sats (gift/samboer), annual kr
}

// Statutory figures. Update when NAV publishes the 1 May rates for a new year;
// the resolver below falls back to the latest year ≤ the requested one.
export const FOLKETRYGD_PARAMS: Record<number, FolketrygdParams> = {
  2025: { grunnbelop: 130_160, garantipensjonSingle: 242_418, garantipensjonMarried: 224_248 },
  2026: { grunnbelop: 136_549, garantipensjonSingle: 253_787, garantipensjonMarried: 234_765 },
};

export const ACCRUAL_RATE = 0.181;   // 18.1% of pensionable income
export const ACCRUAL_CAP_G = 7.1;    // income counted only up to 7.1G
export const GARANTI_AVKORTING = 0.80; // guarantee reduced by 80% of income pension

// NAV delingstall at withdrawal age 67, by birth cohort (from SSB/NAV tables;
// 1970+ are NAV projections). We interpolate between anchors and hold flat
// outside the range.
const DELINGSTALL_67: Array<{ cohort: number; value: number }> = [
  { cohort: 1954, value: 15.08 },
  { cohort: 1955, value: 15.20 },
  { cohort: 1956, value: 15.33 },
  { cohort: 1957, value: 15.46 },
  { cohort: 1958, value: 15.59 },
  { cohort: 1959, value: 15.73 },
  { cohort: 1960, value: 15.88 },
  { cohort: 1961, value: 16.01 },
  { cohort: 1962, value: 16.08 },
  { cohort: 1963, value: 16.11 },
  { cohort: 1964, value: 16.26 },
  { cohort: 1965, value: 16.34 },
  { cohort: 1970, value: 16.70 },
  { cohort: 1975, value: 17.23 },
  { cohort: 1980, value: 17.78 },
  { cohort: 1985, value: 18.32 },
  { cohort: 1990, value: 18.85 },
  { cohort: 2000, value: 19.85 },
];

// Delingstall changes ~0.55 per year of withdrawal age around 67 (earlier
// withdrawal ⇒ more expected pension years ⇒ higher divisor ⇒ lower annual
// pension). A documented linear approximation of NAV's per-age tables.
const DELINGSTALL_PER_AGE_YEAR = 0.55;

/** Resolve the folketrygd params for the newest available year ≤ `year`. */
export function folketrygdParamsFor(year: number): FolketrygdParams {
  const years = Object.keys(FOLKETRYGD_PARAMS).map(Number).filter((y) => y <= year);
  const pick = years.length ? Math.max(...years) : Math.min(...Object.keys(FOLKETRYGD_PARAMS).map(Number));
  return FOLKETRYGD_PARAMS[pick];
}

/**
 * Delingstall for a birth cohort at a given withdrawal age. Interpolates the
 * age-67 anchor table by cohort, then adjusts linearly for the withdrawal age.
 */
export function delingstall(birthYear: number, retirementAge = 67): number {
  const table = DELINGSTALL_67;
  let base: number;
  if (birthYear <= table[0].cohort) base = table[0].value;
  else if (birthYear >= table[table.length - 1].cohort) base = table[table.length - 1].value;
  else {
    base = table[table.length - 1].value;
    for (let i = 0; i < table.length - 1; i++) {
      const lo = table[i], hi = table[i + 1];
      if (birthYear >= lo.cohort && birthYear <= hi.cohort) {
        const frac = (birthYear - lo.cohort) / (hi.cohort - lo.cohort);
        base = lo.value + frac * (hi.value - lo.value);
        break;
      }
    }
  }
  const adjusted = base + (67 - retirementAge) * DELINGSTALL_PER_AGE_YEAR;
  return Math.max(8, adjusted);
}

/** Annual accrual into the pensjonsbeholdning for one year at `income` (kr). */
export function annualAccrual(pensionableIncome: number, year: number): number {
  const P = folketrygdParamsFor(year);
  const capped = Math.min(Math.max(0, pensionableIncome), ACCRUAL_CAP_G * P.grunnbelop);
  return ACCRUAL_RATE * capped;
}

/**
 * Rough estimate of the pensjonsbeholdning accrued *so far*, for users who
 * haven't looked up their exact figure at nav.no. Assumes the current income was
 * (roughly) earned every year since `workStartAge`. Coarse by nature — the real
 * figure from NAV should be preferred.
 */
export function estimateBeholdning(params: {
  birthYear: number;
  currentYear: number;
  annualIncome: number;
  workStartAge?: number;
}): number {
  const { birthYear, currentYear, annualIncome, workStartAge = 22 } = params;
  if (birthYear <= 1900) return 0;
  const age = currentYear - birthYear;
  const yearsWorked = Math.max(0, age - workStartAge);
  return Math.round(annualAccrual(annualIncome, currentYear) * yearsWorked);
}

/** Beholdning projected to retirement (today's kroner): current + future accrual. */
export function projectBeholdning(
  currentBeholdning: number,
  annualIncome: number,
  yearsToRetire: number,
  year: number,
): number {
  const future = Math.max(0, yearsToRetire) * annualAccrual(annualIncome, year);
  return Math.max(0, currentBeholdning) + future;
}

export interface FolketrygdPension {
  beholdning: number;          // beholdning at retirement (today's kr)
  inntektspensjon: number;     // income pension = beholdning / delingstall
  garantiSupplement: number;   // guarantee top-up after 80% avkorting
  annual: number;              // total gross annual folketrygd pension
  delingstall: number;
}

/**
 * Total gross annual folketrygd pension from a beholdning at retirement,
 * including the garantipensjon floor.
 */
export function annualFolketrygdPension(params: {
  beholdning: number;
  birthYear: number;
  retirementAge: number;
  single: boolean;
  year: number;
}): FolketrygdPension {
  const { beholdning, birthYear, retirementAge, single, year } = params;
  const d = delingstall(birthYear, retirementAge);
  const inntektspensjon = Math.max(0, beholdning) / d;
  const P = folketrygdParamsFor(year);
  const guarantee = single ? P.garantipensjonSingle : P.garantipensjonMarried;
  const garantiSupplement = Math.max(0, guarantee - GARANTI_AVKORTING * inntektspensjon);
  return {
    beholdning: Math.max(0, beholdning),
    inntektspensjon,
    garantiSupplement,
    annual: inntektspensjon + garantiSupplement,
    delingstall: d,
  };
}
