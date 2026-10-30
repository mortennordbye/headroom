// The year-by-year forecast recurrence behind the Forecast page — extracted from
// the page so two scenarios (A/B compare) can run the *same* math, and so it's
// unit-testable. Pure. Compounds salary (raise), net (tax), net worth (return +
// savings contribution) and mortgage paydown one year at a time.
import type { Debt } from '../context/FinanceContext';
import { calcTaxByRegion, calcWealthTax, type Region } from './norwegianTax';
import { primaryHomeWealthValueOfShare } from './ownership';
import { calcMortgageBalanceByYear } from './calculations';
import { calcDebtBalanceByYear } from './debt';

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
  /** The mortgage whose interest is deducted from income (rentefradrag) and
   *  shown on the mortgage tile. Net worth uses `startHomeDebt` instead. */
  startingMortgage: number;
  mortgageRatePct: number;
  annualMortgagePayment: number;
  region: Region;
  customTaxRatePct: number;
  ipsAnnualContribution: number;
  startYear: number;
  /**
   * Starting balance sheet. Net worth is carried in three parts, so year 0 equals
   * the Dashboard's `totalEquity − totalDebt`:
   *  - financial assets (`startShares + startOtherAssets`, net of latent tax),
   *    compounding at the return plus savings minus wealth tax;
   *  - the home (`startHomeValue − startHomeDebt`, the user's share), growing at
   *    `houseGrowthPct` while the mortgage amortises, as `calcHouseEquityByYear`;
   *  - non-mortgage `debts`, paid down at their minimums (`calcDebtBalanceByYear`).
   * Shares vs other assets is split by today's ratio for the wealth tax's 80 %
   * share valuation. Wealth tax is skipped outside the Norwegian region.
   */
  startHomeValue: number;
  /** The user's share of the mortgage on the home (`myHouseDebt`). */
  startHomeDebt: number;
  /** Remaining term (years) that `startHomeDebt` amortises over at `mortgageRatePct`. */
  homeDebtTermYears: number;
  /** The user's ownership share (0..1) when `startHomeValue` / `startHomeDebt`
   *  are their share of a co-owned home, so the wealth-tax threshold applies to
   *  the whole home. Default 1. */
  homeOwnShare?: number;
  houseGrowthPct: number;
  startShares: number;
  startOtherAssets: number;
  /** Non-mortgage debts, projected with `calcDebtBalanceByYear` from `monthKey`. */
  debts: Debt[];
  monthKey?: string;
}

export interface ForecastRow {
  yearIndex: number;
  yearLabel: number;
  gross: number;
  net: number;
  contribution: number;
  netWorth: number;
  /** The financial-assets part of `netWorth` (excludes home equity and debt);
   *  the only part the return applies to. */
  financial: number;
  netWorthReal: number;
  mortgage: number;
  /** Estimated formuesskatt charged this year (paid out of net worth). 0 at year
   *  0 and whenever the household is under the bunnfradrag or region ≠ 'no'. */
  wealthTax: number;
}

/**
 * Project net worth, salary, tax and mortgage over `s.years` years. Year 0 is
 * today (no growth applied yet); each subsequent year applies the raise, mortgage
 * paydown, savings contribution and investment return, then deflates to today's
 * kroner by the inflation assumption.
 */
export function projectForecast(inputs: ForecastInputs, s: EffectiveScenario): ForecastRow[] {
  const { currentGross, startingMortgage, mortgageRatePct, annualMortgagePayment,
    region, customTaxRatePct, ipsAnnualContribution, startYear,
    startHomeValue, startHomeDebt, homeDebtTermYears, houseGrowthPct, startShares, startOtherAssets,
    debts, monthKey, homeOwnShare = 1 } = inputs;
  const mortgageRate = mortgageRatePct / 100;
  const financialBase = Math.max(0, startShares + startOtherAssets);
  const sharesRatio = financialBase > 0 ? Math.max(0, startShares) / financialBase : 0;
  const homeDebtByYear = calcMortgageBalanceByYear(startHomeDebt, mortgageRatePct, homeDebtTermYears, s.years);
  const otherDebtByYear = calcDebtBalanceByYear(debts, s.years, monthKey);
  const out: ForecastRow[] = [];
  let gross = currentGross;
  let financial = startShares + startOtherAssets;
  let mortgage = startingMortgage;
  let homeValue = startHomeValue;
  // Formuesskatt assessed on last year's ending wealth, charged this year. 0 at
  // year 0 so the first plotted point equals today's net worth.
  let wealthTaxDue = 0;

  for (let y = 0; y <= s.years; y++) {
    // Interest on the balance entering this year — the year's rentefradrag base,
    // which declines as the mortgage amortizes.
    const mortgageInterest = mortgage * mortgageRate;
    if (y > 0) {
      gross = gross * (1 + s.raisePct / 100);
      mortgage = Math.max(0, mortgage + mortgageInterest - annualMortgagePayment);
      homeValue = homeValue * (1 + houseGrowthPct / 100);
    }
    const net = calcTaxByRegion(gross, region, customTaxRatePct, ipsAnnualContribution, mortgageInterest).netAnnual;
    const contribution = Math.max(0, net * (s.savingsPct / 100));
    if (y > 0) {
      // Wealth tax leaves the pot before it can compound further.
      financial = Math.max(0, financial * (1 + s.returnPct / 100) + contribution - wealthTaxDue);
    }
    const homeDebt = homeDebtByYear[y] ?? 0;
    const otherDebt = otherDebtByYear[y] ?? 0;
    const netWorth = financial + homeValue - homeDebt - otherDebt;
    const realDeflator = Math.pow(1 + s.inflationPct / 100, y);
    out.push({
      yearIndex: y,
      yearLabel: startYear + y,
      gross: Math.round(gross),
      net: Math.round(net),
      contribution: Math.round(contribution),
      netWorth: Math.round(netWorth),
      financial: Math.round(financial),
      netWorthReal: Math.round(netWorth / realDeflator),
      mortgage: Math.round(mortgage),
      wealthTax: Math.round(wealthTaxDue),
    });
    // Assess next year's wealth tax on this year's ending composition, with the
    // financial assets split into shares vs other by today's ratio so the 80 %
    // share discount applies.
    if (region === 'no') {
      wealthTaxDue = calcWealthTax({
        primaryHomeValue: primaryHomeWealthValueOfShare(homeValue, homeOwnShare),
        shares: financial * sharesRatio,
        otherAssets: financial * (1 - sharesRatio),
        debt: homeDebt + otherDebt,
      }).tax;
    } else {
      wealthTaxDue = 0;
    }
  }
  return out;
}
