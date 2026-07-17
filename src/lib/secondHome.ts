/**
 * Second-home (sekundærbolig) economics: buy-to-rent cashflow and
 * renovate-and-refinance (BRRR), with the Norwegian tax picture a rental
 * secondary home triggers — rental-income tax, mortgage interest deduction,
 * wealth tax (formuesskatt) and capital gains on a future sale.
 *
 * Pure and React-free (CLAUDE.md: money math lives in src/lib with tests).
 * Reuses the shared mortgage helpers rather than re-deriving amortization, and
 * pulls the 22% capital-income rate from `TAX_PARAMS` so it tracks the tax year.
 *
 * Rules encoded (utlånsforskriften + skatt, 2025/2026):
 *   • total debt ≤ 5× gross income, LTV/equity handled by the shared borrowing
 *     helpers; the scenario carries its own `equityShare` (bank practice ~25% for
 *     a secondary home — the regulation floor of 10% is not the binding number).
 *   • long-term secondary rental taxed as capital income (22%) on NET (rent minus
 *     deductible costs minus loan interest — interest counted here, once).
 *   • formuesskatt: secondary valued at 100% of market value (vs 25% primary).
 *   • capital gains: 22% on (sale − purchase − improvements − sale costs), no
 *     botid exemption for a pure rental secondary home.
 */
import { calcAmortizationSchedule, calcDebtToIncome, MAX_DEBT_TO_INCOME, STRESS_TEST_ADD_PCT } from './calculations';
import { TAX_PARAMS, TAX_YEAR } from './norwegianTax';

/** Capital-income rate (skatt på alminnelig inntekt), as a percent — 22 today. */
export const CAPITAL_INCOME_RATE_PCT = TAX_PARAMS[TAX_YEAR].skattAlminneligRate * 100;

/** Stress-test floor the lending rule requires: contract rate +3pp, minimum 7%. */
export const STRESS_TEST_MIN_PCT = 7;

/**
 * Share of gross rent a bank typically credits toward the 5×-income cap. Banks
 * vary a lot here (and many exclude rent from the *subject* property entirely, or
 * for a property with no letting history), so this is only a default the user can
 * adjust — not a guarantee. ~0.85 approximates the common "10 of 12 months" haircut.
 */
export const DEFAULT_RENTAL_BANK_FACTOR = 0.85;

export type SecondHomeStrategy = 'rent' | 'brrr';

export interface SecondHomeScenario {
  id: string;
  name: string;
  strategy: SecondHomeStrategy;
  // Purchase
  purchasePrice: number;
  dokumentavgiftPct: number;
  tinglysingsgebyr: number;
  otherPurchaseCosts: number;
  // Financing
  equityShare: number; // 0..1 share of price covered by equity
  mortgageRatePct: number;
  termYears: number;
  // Rental
  monthlyRent: number;
  vacancyPct: number;
  monthlyOperatingCosts: number;
  deductibleCostsAnnual: number; // tax-deductible portion of running costs
  // BRRR
  renovationCost: number;
  afterRepairValue: number;
  refinanceLtvPct: number;
  // Future sale (capital gains)
  holdYears: number;
  annualAppreciationPct: number;
  saleAgentFeePct: number;
  documentedImprovements: number;
  // Tax context
  marginalWealthTaxPct: number;
  // Portfolio: when true this property is treated as owned/committed, so its loan
  // stacks into the cumulative-debt / borrowing-headroom picture for the next buy.
  committed?: boolean;
}

/** New-scenario defaults (id + name supplied by the caller). */
export const DEFAULT_SECOND_HOME_SCENARIO: Omit<SecondHomeScenario, 'id' | 'name'> = {
  strategy: 'rent',
  purchasePrice: 4_000_000,
  dokumentavgiftPct: 2.5,
  tinglysingsgebyr: 585,
  otherPurchaseCosts: 0,
  equityShare: 0.25,
  mortgageRatePct: 5.5,
  termYears: 25,
  monthlyRent: 15_000,
  vacancyPct: 5,
  monthlyOperatingCosts: 3_000,
  deductibleCostsAnnual: 36_000,
  renovationCost: 0,
  afterRepairValue: 4_000_000,
  refinanceLtvPct: 75,
  holdYears: 10,
  annualAppreciationPct: 3,
  saleAgentFeePct: 3,
  documentedImprovements: 0,
  marginalWealthTaxPct: 0.85,
  committed: false,
};

// ── Purchase costs ──────────────────────────────────────────────────────────

export interface PurchaseCosts {
  dokumentavgift: number; // 2.5% of price for a selveier (0 for borettslag)
  tinglysing: number;
  other: number;
  total: number;
}

export function calcPurchaseCosts(
  price: number,
  dokumentavgiftPct: number,
  tinglysingsgebyr: number,
  otherPurchaseCosts: number,
): PurchaseCosts {
  const dokumentavgift = Math.max(0, price) * (Math.max(0, dokumentavgiftPct) / 100);
  const tinglysing = Math.max(0, tinglysingsgebyr);
  const other = Math.max(0, otherPurchaseCosts);
  return { dokumentavgift, tinglysing, other, total: dokumentavgift + tinglysing + other };
}

/** Compound a value forward at an annual percentage over `years`. */
export function projectValue(value: number, annualPct: number, years: number): number {
  return value * Math.pow(1 + annualPct / 100, Math.max(0, years));
}

/** Stress rate the servicing check uses: contract rate +3pp, floored at 7%. */
export function stressRate(mortgageRatePct: number): number {
  return Math.max(STRESS_TEST_MIN_PCT, mortgageRatePct + STRESS_TEST_ADD_PCT);
}

// ── Rental income tax (22% of net capital income) ───────────────────────────

/**
 * Tax on long-term secondary-home rental. Taxed as capital income on the NET:
 * effective rent minus deductible running costs minus the loan interest
 * (rentefradrag). Interest is deducted here and nowhere else — it is not also a
 * wage-tax deduction. A negative net (a loss) yields 0 tax (no benefit modeled).
 */
export function calcRentalIncomeTax(
  effectiveAnnualRent: number,
  deductibleCostsAnnual: number,
  annualInterest: number,
  ratePct: number = CAPITAL_INCOME_RATE_PCT,
): number {
  const net = effectiveAnnualRent - Math.max(0, deductibleCostsAnnual) - Math.max(0, annualInterest);
  return Math.max(0, net) * (ratePct / 100);
}

// ── Rental cashflow (strategy A) ────────────────────────────────────────────

export interface RentalCashflow {
  grossAnnualRent: number;
  effectiveRent: number; // after vacancy
  annualInterest: number; // year-1 interest on the loan
  annualPrincipal: number; // year-1 principal repaid
  annualDebtService: number; // interest + principal
  annualOperatingCosts: number;
  netOperatingIncome: number; // effective rent − operating (pre-financing)
  rentalIncomeTax: number;
  preTaxAnnualCashflow: number; // NOI − debt service
  afterTaxAnnualCashflow: number;
  afterTaxMonthlyCashflow: number;
  grossYieldPct: number; // gross rent / price
  netYieldPct: number; // NOI / total property cost (price + purchase costs)
}

/**
 * Year-one rental cashflow at a given loan amount (the down-payment / financing
 * split is the caller's; BRRR passes the refinanced balance). Yields are guarded
 * to 0 when the denominator is non-positive, matching `calcDebtToIncome`.
 */
export function calcRentalCashflow(s: SecondHomeScenario, loanAmount: number): RentalCashflow {
  const loan = Math.max(0, loanAmount);
  const grossAnnualRent = Math.max(0, s.monthlyRent) * 12;
  const effectiveRent = grossAnnualRent * (1 - Math.min(1, Math.max(0, s.vacancyPct) / 100));
  const schedule = loan > 0 && s.termYears > 0 ? calcAmortizationSchedule(loan, s.mortgageRatePct, s.termYears) : [];
  const annualInterest = schedule[0]?.interestPaid ?? 0;
  const annualPrincipal = schedule[0]?.principalPaid ?? 0;
  const annualDebtService = annualInterest + annualPrincipal;
  const annualOperatingCosts = Math.max(0, s.monthlyOperatingCosts) * 12;
  const netOperatingIncome = effectiveRent - annualOperatingCosts;
  const rentalIncomeTax = calcRentalIncomeTax(effectiveRent, s.deductibleCostsAnnual, annualInterest);
  const preTaxAnnualCashflow = netOperatingIncome - annualDebtService;
  const afterTaxAnnualCashflow = preTaxAnnualCashflow - rentalIncomeTax;
  const totalPropertyCost =
    Math.max(0, s.purchasePrice) +
    calcPurchaseCosts(s.purchasePrice, s.dokumentavgiftPct, s.tinglysingsgebyr, s.otherPurchaseCosts).total;
  return {
    grossAnnualRent,
    effectiveRent,
    annualInterest,
    annualPrincipal,
    annualDebtService,
    annualOperatingCosts,
    netOperatingIncome,
    rentalIncomeTax,
    preTaxAnnualCashflow,
    afterTaxAnnualCashflow,
    afterTaxMonthlyCashflow: afterTaxAnnualCashflow / 12,
    grossYieldPct: s.purchasePrice > 0 ? (grossAnnualRent / s.purchasePrice) * 100 : 0,
    netYieldPct: s.purchasePrice > 0 && totalPropertyCost > 0 ? (netOperatingIncome / totalPropertyCost) * 100 : 0,
  };
}

// ── Wealth tax (formuesskatt) marginal impact ───────────────────────────────

export interface WealthTaxImpact {
  addedTaxableWealth: number; // 100% market value − loan debt (can be negative)
  marginalWealthTax: number; // taxed only on positive added wealth
}

/**
 * Marginal formuesskatt from adding this property. A secondary home is valued at
 * 100% of market value (a primary home is 25%), net of its mortgage debt. The
 * marginal rate is user-supplied (assumes the household is already above the
 * bunnfradrag, so every added krone is taxed).
 */
export function calcWealthTaxImpact(
  marketValue: number,
  loanBalance: number,
  marginalRatePct: number,
): WealthTaxImpact {
  const addedTaxableWealth = Math.max(0, marketValue) - Math.max(0, loanBalance);
  return {
    addedTaxableWealth,
    marginalWealthTax: Math.max(0, addedTaxableWealth) * (Math.max(0, marginalRatePct) / 100),
  };
}

// ── Capital gains on sale (22%) ─────────────────────────────────────────────

export interface CapitalGains {
  salePrice: number;
  saleCosts: number; // agent fee
  gain: number; // may be negative
  tax: number; // 0 when gain ≤ 0 (no loss benefit modeled)
  netProceeds: number; // sale price − sale costs − tax (before mortgage payoff)
}

export function calcPropertyCapitalGains(
  salePrice: number,
  purchasePrice: number,
  purchaseCosts: number,
  documentedImprovements: number,
  saleAgentFeePct: number,
  ratePct: number = CAPITAL_INCOME_RATE_PCT,
): CapitalGains {
  const price = Math.max(0, salePrice);
  const saleCosts = price * (Math.max(0, saleAgentFeePct) / 100);
  const gain =
    price -
    Math.max(0, purchasePrice) -
    Math.max(0, purchaseCosts) -
    Math.max(0, documentedImprovements) -
    saleCosts;
  const tax = Math.max(0, gain) * (ratePct / 100);
  return { salePrice: price, saleCosts, gain, tax, netProceeds: price - saleCosts - tax };
}

// ── BRRR: renovate & refinance (strategy B) ─────────────────────────────────

export interface BrrrResult {
  purchaseCosts: number;
  initialEquity: number; // price × equityShare (cash down)
  initialLoan: number; // price − initialEquity
  renovation: number;
  cashInvested: number; // equity + purchase costs + renovation (out of pocket)
  totalInvested: number; // price + purchase costs + renovation
  arv: number; // after-repair value
  maxRefiLoan: number; // arv × refinanceLtvPct
  cashOut: number; // pulled out on refinance (floored ≥0)
  capitalLeftIn: number; // cash still tied up after cash-out (floored ≥0)
  postRefiLtvPct: number;
}

/**
 * Buy → renovate → revalue (ARV) → refinance up to the bank's LTV cap and pull
 * equity back out. `cashOut` is the extra borrowing beyond the original loan;
 * `capitalLeftIn` is the out-of-pocket cash that couldn't be recovered. Both are
 * floored at 0 (a bank won't hand you more than you invested here).
 */
export function calcBrrr(s: SecondHomeScenario): BrrrResult {
  const price = Math.max(0, s.purchasePrice);
  const purchaseCosts = calcPurchaseCosts(price, s.dokumentavgiftPct, s.tinglysingsgebyr, s.otherPurchaseCosts).total;
  const equityShare = Math.min(1, Math.max(0, s.equityShare));
  const initialEquity = price * equityShare;
  const initialLoan = price - initialEquity;
  const renovation = Math.max(0, s.renovationCost);
  const cashInvested = initialEquity + purchaseCosts + renovation;
  const totalInvested = price + purchaseCosts + renovation;
  const arv = Math.max(0, s.afterRepairValue);
  const maxRefiLoan = arv * (Math.min(100, Math.max(0, s.refinanceLtvPct)) / 100);
  const cashOut = Math.max(0, maxRefiLoan - initialLoan);
  const capitalLeftIn = Math.max(0, cashInvested - cashOut);
  return {
    purchaseCosts,
    initialEquity,
    initialLoan,
    renovation,
    cashInvested,
    totalInvested,
    arv,
    maxRefiLoan,
    cashOut,
    capitalLeftIn,
    postRefiLtvPct: arv > 0 ? (maxRefiLoan / arv) * 100 : 0,
  };
}

// ── Per-scenario summary + portfolio aggregation (owning home 2, 3, 4…) ──────

/** The mortgage balance a scenario carries: the refinanced loan for BRRR, else the
 *  purchase loan after equity. */
export function scenarioLoan(s: SecondHomeScenario): number {
  if (s.strategy === 'brrr') return calcBrrr(s).maxRefiLoan;
  return Math.max(0, s.purchasePrice) * (1 - Math.min(1, Math.max(0, s.equityShare)));
}

export interface ScenarioSummary {
  loan: number;
  marketValue: number;
  cashNeeded: number; // equity + purchase costs (+ renovation for BRRR)
  afterTaxMonthlyCashflow: number;
  grossYieldPct: number;
  netYieldPct: number;
  ltvPct: number;
}

/** A compact one-line summary of a scenario, for the comparison table and the
 *  portfolio aggregate. */
export function summarizeScenario(s: SecondHomeScenario): ScenarioSummary {
  const isBrrr = s.strategy === 'brrr';
  const loan = scenarioLoan(s);
  const marketValue = isBrrr ? calcBrrr(s).arv : Math.max(0, s.purchasePrice);
  const cf = calcRentalCashflow(s, loan);
  const purchaseCosts = calcPurchaseCosts(s.purchasePrice, s.dokumentavgiftPct, s.tinglysingsgebyr, s.otherPurchaseCosts).total;
  const equity = Math.max(0, s.purchasePrice) * Math.min(1, Math.max(0, s.equityShare));
  const cashNeeded = equity + purchaseCosts + (isBrrr ? Math.max(0, s.renovationCost) : 0);
  return {
    loan,
    marketValue,
    cashNeeded,
    afterTaxMonthlyCashflow: cf.afterTaxMonthlyCashflow,
    grossYieldPct: cf.grossYieldPct,
    netYieldPct: cf.netYieldPct,
    ltvPct: marketValue > 0 ? (loan / marketValue) * 100 : 0,
  };
}

export interface PortfolioSummary {
  committedCount: number;
  totalPropertyValue: number;
  totalLoan: number; // sum of committed loans
  cumulativeDebt: number; // existing debt + committed loans
  totalEquityInvested: number; // sum of cash needed
  combinedMonthlyCashflow: number;
  borrowingHeadroom: number; // 5× income − cumulative debt (≥0)
  dtiRatio: number;
}

/**
 * Aggregate the scenarios flagged `committed` into one portfolio picture, so
 * buying property #2 → #3 → #4 scales: each committed loan stacks onto your
 * existing debt, shrinking the 5×-income headroom while its cashflow adds up.
 */
export function calcPortfolio(
  scenarios: SecondHomeScenario[],
  grossAnnualIncome: number,
  existingDebt: number,
): PortfolioSummary {
  const committed = scenarios.filter((s) => s.committed);
  let totalLoan = 0, totalPropertyValue = 0, totalEquityInvested = 0, combinedMonthlyCashflow = 0;
  for (const s of committed) {
    const sum = summarizeScenario(s);
    totalLoan += sum.loan;
    totalPropertyValue += sum.marketValue;
    totalEquityInvested += sum.cashNeeded;
    combinedMonthlyCashflow += sum.afterTaxMonthlyCashflow;
  }
  const cumulativeDebt = Math.max(0, existingDebt) + totalLoan;
  const dti = calcDebtToIncome(cumulativeDebt, grossAnnualIncome);
  return {
    committedCount: committed.length,
    totalPropertyValue,
    totalLoan,
    cumulativeDebt,
    totalEquityInvested,
    combinedMonthlyCashflow,
    borrowingHeadroom: dti.borrowingHeadroom,
    dtiRatio: dti.ratio,
  };
}

// ── Real borrowing capacity (the full 5×-income picture) ────────────────────

export interface RealBorrowingCapacityInput {
  /** Gross annual base salary (bonus excluded). */
  baseAnnualSalary: number;
  /** Gross annual bonus, only counted when `includeBonus` is true. */
  bonusAnnual: number;
  includeBonus: boolean;
  /** Gross annual rent for THIS property (monthlyRent × 12). */
  grossAnnualRent: number;
  /** Share of gross rent the bank credits toward income (0..1). See DEFAULT_RENTAL_BANK_FACTOR. */
  rentalBankFactor: number;
  /** Existing home mortgage already carried (assets.houseDebt). */
  existingMortgage: number;
  /** Other non-mortgage debt (consumer, student, credit-card balances). */
  otherDebt: number;
  /** Granted credit frames counted IN FULL by the bank (kredittkort/rammekreditt limits). */
  creditFrames: number;
  /** The new loan this purchase adds. */
  newLoan: number;
  /** Cash needed up front (equity + purchase costs, + renovation for BRRR). */
  cashRequired: number;
  /** Liquid assets available to cover the cash need. */
  liquidAssets: number;
}

export interface RealBorrowingCapacity {
  acceptedRentalIncome: number; // grossAnnualRent × factor
  totalAcceptedIncome: number; // base (+ bonus) + accepted rent
  maxTotalDebt: number; // income × 5
  existingDebtLoad: number; // mortgage + other debt + credit frames (pre-purchase)
  remainingCapacity: number; // maxTotalDebt − existingDebtLoad (may be negative)
  totalDebtAfter: number; // existingDebtLoad + newLoan
  loanFits: boolean; // newLoan ≤ remainingCapacity
  capacityAfterPurchase: number; // remainingCapacity − newLoan
  dtiAfterPurchase: number; // totalDebtAfter ÷ income (0 when no income)
  liquidityGap: number; // cashRequired − liquidAssets (>0 ⇒ short)
  hasEnoughCash: boolean;
}

/**
 * The bank's real lending check for a secondary-home purchase: total accepted
 * income × 5 is the debt ceiling, against which ALL debt counts — the existing
 * mortgage, other debt, credit frames (counted at their full granted limit, not
 * the drawn balance) and the new loan. Optionally credits part of the rent toward
 * income (bank practice varies; see DEFAULT_RENTAL_BANK_FACTOR). This is the DTI
 * cap only — pair it with the stress-test serviceability check (`stressRate`) for
 * the full picture, and with the liquidity check below for the cash side.
 */
export function calcRealBorrowingCapacity(i: RealBorrowingCapacityInput): RealBorrowingCapacity {
  const base = Math.max(0, i.baseAnnualSalary);
  const bonus = i.includeBonus ? Math.max(0, i.bonusAnnual) : 0;
  const factor = Math.min(1, Math.max(0, i.rentalBankFactor));
  const acceptedRentalIncome = Math.max(0, i.grossAnnualRent) * factor;
  const totalAcceptedIncome = base + bonus + acceptedRentalIncome;
  const maxTotalDebt = totalAcceptedIncome * MAX_DEBT_TO_INCOME;
  const existingDebtLoad =
    Math.max(0, i.existingMortgage) + Math.max(0, i.otherDebt) + Math.max(0, i.creditFrames);
  const remainingCapacity = maxTotalDebt - existingDebtLoad;
  const newLoan = Math.max(0, i.newLoan);
  const totalDebtAfter = existingDebtLoad + newLoan;
  const cashRequired = Math.max(0, i.cashRequired);
  const liquidAssets = Math.max(0, i.liquidAssets);
  return {
    acceptedRentalIncome,
    totalAcceptedIncome,
    maxTotalDebt,
    existingDebtLoad,
    remainingCapacity,
    totalDebtAfter,
    loanFits: newLoan <= remainingCapacity,
    capacityAfterPurchase: remainingCapacity - newLoan,
    dtiAfterPurchase: totalAcceptedIncome > 0 ? totalDebtAfter / totalAcceptedIncome : 0,
    liquidityGap: cashRequired - liquidAssets,
    hasEnoughCash: liquidAssets >= cashRequired,
  };
}
