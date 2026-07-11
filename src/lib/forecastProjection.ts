// The year-by-year forecast recurrence behind the Forecast page — extracted from
// the page so two scenarios (A/B compare) can run the *same* math, and so it's
// unit-testable. Pure. Compounds salary (raise), net (tax), net worth (return +
// savings contribution) and mortgage paydown one year at a time.
import { calcTaxByRegion, type Region } from './norwegianTax';

/** One saved forecast scenario. Each assumption is null until the user drags its
 *  slider, so the page can keep seeding it from live data until then. */
export interface ForecastScenario {
  raisePct: number | null;
  savingsPct: number | null;
  returnPct: number | null;
  inflationPct: number | null;
  years: number | null;
  extraMonthly: number | null;
}

/** Scenario A, an optional compare scenario B, and whether compare is on. */
export interface ForecastAssumptions {
  a: ForecastScenario;
  b: ForecastScenario;
  compareOn: boolean;
}

export const EMPTY_SCENARIO: ForecastScenario = {
  raisePct: null, savingsPct: null, returnPct: null, inflationPct: null, years: null, extraMonthly: null,
};

export const DEFAULT_FORECAST_ASSUMPTIONS: ForecastAssumptions = {
  a: EMPTY_SCENARIO,
  b: EMPTY_SCENARIO,
  compareOn: false,
};

/** The resolved (non-null) assumptions a projection actually runs on. */
export interface EffectiveScenario {
  raisePct: number;
  savingsPct: number;
  returnPct: number;
  inflationPct: number;
  years: number;
  extraMonthly: number;
}

/** Non-assumption inputs shared by every scenario (the user's real position). */
export interface ForecastInputs {
  currentGross: number;
  totalEquity: number;
  startingMortgage: number;
  mortgageRatePct: number;
  annualMortgagePayment: number;
  region: Region;
  customTaxRatePct: number;
  ipsAnnualContribution: number;
  startYear: number;
}

export interface ForecastRow {
  yearIndex: number;
  yearLabel: number;
  gross: number;
  net: number;
  contribution: number;
  netWorth: number;
  netWorthReal: number;
  mortgage: number;
}

/**
 * Project net worth, salary, tax and mortgage over `s.years` years. Year 0 is
 * today (no growth applied yet); each subsequent year applies the raise, mortgage
 * paydown, savings contribution and investment return, then deflates to today's
 * kroner by the inflation assumption.
 */
export function projectForecast(inputs: ForecastInputs, s: EffectiveScenario): ForecastRow[] {
  const { currentGross, totalEquity, startingMortgage, mortgageRatePct, annualMortgagePayment,
    region, customTaxRatePct, ipsAnnualContribution, startYear } = inputs;
  const mortgageRate = mortgageRatePct / 100;
  const out: ForecastRow[] = [];
  let gross = currentGross;
  let netWorth = totalEquity;
  let mortgage = startingMortgage;

  for (let y = 0; y <= s.years; y++) {
    // Interest on the balance entering this year — the year's rentefradrag base,
    // which declines as the mortgage amortizes.
    const mortgageInterest = mortgage * mortgageRate;
    if (y > 0) {
      gross = gross * (1 + s.raisePct / 100);
      mortgage = Math.max(0, mortgage + mortgageInterest - annualMortgagePayment);
    }
    const net = calcTaxByRegion(gross, region, customTaxRatePct, ipsAnnualContribution, mortgageInterest).netAnnual;
    const contribution = Math.max(0, net * (s.savingsPct / 100));
    if (y > 0) {
      netWorth = netWorth * (1 + s.returnPct / 100) + contribution;
    }
    const realDeflator = Math.pow(1 + s.inflationPct / 100, y);
    out.push({
      yearIndex: y,
      yearLabel: startYear + y,
      gross: Math.round(gross),
      net: Math.round(net),
      contribution: Math.round(contribution),
      netWorth: Math.round(netWorth),
      netWorthReal: Math.round(netWorth / realDeflator),
      mortgage: Math.round(mortgage),
    });
  }
  return out;
}
