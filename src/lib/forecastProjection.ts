// The year-by-year forecast recurrence behind the Forecast page — extracted from
// the page so two scenarios (A/B compare) can run the *same* math, and so it's
// unit-testable. Pure. Compounds salary (raise), net (tax), net worth (return +
// savings contribution) and mortgage paydown one year at a time.
import type { Debt } from '../context/FinanceContext';
import { calcTaxByRegion, calcWealthTax, type Region } from './norwegianTax';
import { calcAmortizationSchedule, calcMortgageBalanceByYear } from './calculations';
import { calcDebtBalanceByYear } from './debt';
import type { CurrentMortgage } from './existingMortgage';
import { feriepengerSurplus } from './feriepenger';

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
/** The home's mortgage, the user's share, from `currentMortgage`
 *  (existingMortgage.ts). One balance series feeds both net worth and the
 *  mortgage tile, so they always agree. */
export interface ForecastMortgage {
  balance: number;
  ratePct: number;
  /** Years it amortises over from today; 0 holds it flat. */
  termYears: number;
  /** Owner modes: the loan whose interest is deducted (rentefradrag) and shown
   *  on the mortgage tile. A first buyer's Assets debt is neither: it only
   *  counts, flat, in net worth. */
  amortises: boolean;
}

/** The forecast's mortgage input from the shared resolver (Forecast page and MCP). */
export function forecastMortgage(m: CurrentMortgage): ForecastMortgage {
  return { balance: m.balance, ratePct: m.ratePct, termYears: m.paymentTermMonths / 12, amortises: m.amortises };
}

export interface ForecastInputs {
  currentGross: number;
  mortgage: ForecastMortgage;
  region: Region;
  customTaxRatePct: number;
  ipsAnnualContribution: number;
  startYear: number;
  /**
   * Starting balance sheet. Net worth is carried in three parts, so year 0 equals
   * the Dashboard's `totalEquity − totalDebt`:
   *  - financial assets (`startShares + startOtherAssets`, net of latent tax),
   *    compounding at the return plus savings minus wealth tax;
   *  - the home (`startHomeValue − mortgage.balance`, the user's share), growing
   *    at `houseGrowthPct` while the mortgage amortises, as `calcHouseEquityByYear`;
   *  - non-mortgage `debts`, paid down at their minimums (`calcDebtBalanceByYear`).
   * Shares vs other assets is split by today's ratio for the wealth tax's 80 %
   * share valuation. Wealth tax is skipped outside the Norwegian region.
   */
  startHomeValue: number;
  /** The user's ownership share (0..1) when `startHomeValue` / `mortgage` are
   *  their share of a co-owned home, so the wealth-tax threshold applies to the
   *  whole home. Default 1. */
  homeOwnShare?: number;
  houseGrowthPct: number;
  startShares: number;
  startOtherAssets: number;
  /** Non-mortgage debts, projected with `calcDebtBalanceByYear` from `monthKey`. */
  debts: Debt[];
  monthKey?: string;
  /** Holiday pay above salary in `startYear` (`holidaySurplusFor`), taxed with
   *  year 0's salary so year 0 matches the budget's net income. Default 0. */
  startHolidaySurplus?: number;
  /** Holiday-pay rate (%) for the later years' surplus, from each year's
   *  projected salary and the year before. 0 or unset (and outside Norway) adds none. */
  feriepengesatsPct?: number;
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
  /** The deductible mortgage still owed this year (the tile): `homeDebt` in the
   *  owner modes, 0 for a first buyer. */
  mortgage: number;
  /** The home's mortgage (the user's share) still owed this year: the debt side
   *  of the home in `netWorth`. */
  homeDebt: number;
  /** Estimated formuesskatt charged this year (paid out of net worth). 0 at year
   *  0 and whenever the household is under the bunnfradrag or region ≠ 'no'. */
  wealthTax: number;
}

/**
 * Project net worth, salary, tax and mortgage over `s.years` years. Year 0 is
 * today (no growth applied yet); each subsequent year applies the raise, mortgage
 * paydown (`calcMortgageBalanceByYear`, the Dashboard's schedule), savings
 * contribution and investment return, then deflates to today's kroner by the
 * inflation assumption.
 */
export function projectForecast(inputs: ForecastInputs, s: EffectiveScenario): ForecastRow[] {
  const { currentGross, mortgage: m,
    region, customTaxRatePct, ipsAnnualContribution, startYear,
    startHomeValue, houseGrowthPct, startShares, startOtherAssets,
    debts, monthKey, homeOwnShare = 1,
    startHolidaySurplus = 0, feriepengesatsPct = 0 } = inputs;
  // The interest actually paid each year on the amortising schedule: the
  // rentefradrag base, so year 0 matches the app's `annualMortgageInterest`.
  const interestByYear = m.amortises && m.balance > 0 && m.ratePct > 0 && m.termYears > 0
    ? calcAmortizationSchedule(m.balance, m.ratePct, m.termYears).map(y => y.interestPaid)
    : [];
  const financialBase = Math.max(0, startShares + startOtherAssets);
  const sharesRatio = financialBase > 0 ? Math.max(0, startShares) / financialBase : 0;
  const homeDebtByYear = calcMortgageBalanceByYear(m.balance, m.ratePct, m.amortises ? m.termYears : 0, s.years);
  const otherDebtByYear = calcDebtBalanceByYear(debts, s.years, monthKey);
  const out: ForecastRow[] = [];
  let gross = currentGross;
  let financial = startShares + startOtherAssets;
  let homeValue = startHomeValue;
  // Formuesskatt assessed on last year's ending wealth, charged this year. 0 at
  // year 0 so the first plotted point equals today's net worth.
  let wealthTaxDue = 0;

  for (let y = 0; y <= s.years; y++) {
    const homeDebt = homeDebtByYear[y] ?? 0;
    // This year's rentefradrag base, declining as the mortgage amortizes.
    const mortgageInterest = interestByYear[y] ?? 0;
    const prevGross = gross;
    if (y > 0) {
      gross = gross * (1 + s.raisePct / 100);
      homeValue = homeValue * (1 + houseGrowthPct / 100);
    }
    // Holiday pay above salary is taxable income on top of it: today's from the
    // real salary history, later years' from this year's and last year's salary.
    const year = startYear + y;
    const holidaySurplus = y === 0
      ? startHolidaySurplus
      : region === 'no'
        ? feriepengerSurplus(year, (k) => (k < `${year}-01` ? prevGross : gross), feriepengesatsPct)
        : 0;
    const net = calcTaxByRegion(gross + holidaySurplus, region, customTaxRatePct, ipsAnnualContribution, mortgageInterest).netAnnual;
    const contribution = Math.max(0, net * (s.savingsPct / 100));
    if (y > 0) {
      // Wealth tax leaves the pot before it can compound further.
      financial = Math.max(0, financial * (1 + s.returnPct / 100) + contribution - wealthTaxDue);
    }
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
      mortgage: m.amortises ? homeDebt : 0,
      homeDebt,
      wealthTax: Math.round(wealthTaxDue),
    });
    // Assess next year's wealth tax on this year's ending composition, with the
    // financial assets split into shares vs other by today's ratio so the 80 %
    // share discount applies.
    if (region === 'no') {
      wealthTaxDue = calcWealthTax({
        primaryHomeValue: homeValue,
        primaryHomeShare: homeOwnShare,
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
