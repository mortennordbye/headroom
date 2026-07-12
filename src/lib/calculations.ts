export function calcMonthlyPayment(principal: number, annualRate: number, years: number): number {
  const monthlyRate = annualRate / 100 / 12;
  const n = years * 12;
  if (n <= 0) return 0; // guard: a 0/negative term has no payment schedule (avoids Infinity/NaN)
  if (monthlyRate === 0) return principal / n;
  return principal * monthlyRate / (1 - Math.pow(1 + monthlyRate, -n));
}

// Norwegian mortgage-lending limits (utlånsforskriften):
//  • debt ≤ 5× gross annual income (minus existing debt), and
//  • equity ≥ 15% of the purchase price (i.e. LTV ≤ 85%).
// The affordable price is the lower of the two caps. We also surface the monthly
// payment stress-tested at +3pp, the servicing check the same rules require.
export const MAX_DEBT_TO_INCOME = 5;
export const MIN_EQUITY_SHARE = 0.15; // 15% equity → 85% LTV
export const STRESS_TEST_ADD_PCT = 3; // +3 percentage points

export interface BorrowingCapacity {
  maxDebt: number;            // 5× income − existing debt (debt-to-income cap), floored at 0
  maxPriceFromDebt: number;   // maxDebt + equity
  maxPriceFromLtv: number;    // equity / 0.15 (the 15%-equity / 85%-LTV cap)
  maxPrice: number;           // the binding (lower) of the two
  ltvBound: boolean;          // true when the equity cap binds rather than the income cap
  debtAtMaxPrice: number;     // actual mortgage needed at maxPrice (maxPrice − equity)
  stressRatePct: number;      // mortgageRate + 3pp
  stressedMonthlyPayment: number; // monthly payment on debtAtMaxPrice at the stress rate
}

export function calcBorrowingCapacity(
  grossAnnualIncome: number,
  equity: number,
  existingDebt: number,
  mortgageRatePct: number,
  termYears: number,
): BorrowingCapacity {
  const income = Math.max(0, grossAnnualIncome);
  const eq = Math.max(0, equity);
  const maxDebt = Math.max(0, MAX_DEBT_TO_INCOME * income - Math.max(0, existingDebt));
  const maxPriceFromDebt = maxDebt + eq;
  const maxPriceFromLtv = eq / MIN_EQUITY_SHARE; // eq must be ≥ 15% of price
  const maxPrice = Math.min(maxPriceFromDebt, maxPriceFromLtv);
  const ltvBound = maxPriceFromLtv < maxPriceFromDebt;
  const debtAtMaxPrice = Math.max(0, maxPrice - eq);
  const stressRatePct = mortgageRatePct + STRESS_TEST_ADD_PCT;
  const stressedMonthlyPayment = calcMonthlyPayment(debtAtMaxPrice, stressRatePct, termYears);
  return {
    maxDebt, maxPriceFromDebt, maxPriceFromLtv, maxPrice, ltvBound,
    debtAtMaxPrice, stressRatePct, stressedMonthlyPayment,
  };
}

export interface AmortizationYear {
  year: number;
  annualPayment: number;
  principalPaid: number;
  interestPaid: number;
  balance: number;
}

export function calcAmortizationSchedule(
  principal: number,
  annualRate: number,
  years: number
): AmortizationYear[] {
  const monthlyRate = annualRate / 100 / 12;
  const monthlyPayment = calcMonthlyPayment(principal, annualRate, years);
  const schedule: AmortizationYear[] = [];
  let balance = principal;

  for (let y = 1; y <= years; y++) {
    let yearPrincipal = 0;
    let yearInterest = 0;
    for (let m = 0; m < 12; m++) {
      if (balance < 0.01) break;
      const interest = balance * monthlyRate;
      const principalPaid = Math.min(monthlyPayment - interest, balance);
      yearInterest += interest;
      yearPrincipal += principalPaid;
      balance -= principalPaid;
    }
    balance = Math.max(0, balance);
    schedule.push({
      year: y,
      // Sum of the year's actual payments, not monthlyPayment × 12 — the payoff
      // year has fewer than 12 payments, so a flat ×12 overstates its total.
      annualPayment: yearPrincipal + yearInterest,
      principalPaid: yearPrincipal,
      interestPaid: yearInterest,
      balance,
    });
    if (balance < 0.01) break;
  }
  return schedule;
}

export type ConservativeReason = 'shortfall' | 'volatility' | null;

export interface BudgetRecommendation {
  recommendedSpending: number;
  recommendedInvestment: number;
  conservativeMode: boolean;
  /** Which trigger put us in conservative mode (null when not active). */
  conservativeReason: ConservativeReason;
  /**
   * Conservative advisory target for investment. In conservative mode this is
   * higher than recommendedInvestment (savings bumped +10pp); otherwise it
   * equals recommendedInvestment. Purely advisory — it never overrides the plan.
   */
  suggestedInvestment: number;
}

export function calcRecommendations(
  effectiveIncome: number,
  averageIncome: number,
  totalFixedExpenses: number,
  volatility: number,
  savingsTargetPercent: number = 20
): BudgetRecommendation {
  const residual = effectiveIncome - totalFixedExpenses;
  const shortfall = averageIncome > 0 ? (averageIncome - effectiveIncome) / averageIncome : 0;
  // Shortfall takes priority when both triggers fire, since it's the more concrete signal.
  const conservativeReason: ConservativeReason =
    shortfall > 0.10 ? 'shortfall' : volatility > 0.15 ? 'volatility' : null;
  const conservativeMode = conservativeReason !== null;
  if (residual <= 0) return { recommendedSpending: 0, recommendedInvestment: 0, conservativeMode: true, conservativeReason, suggestedInvestment: 0 };
  // The plan follows the user's chosen savings target exactly — manual edits stick.
  const investRatio = savingsTargetPercent / 100;
  // Conservative mode only *suggests* saving 10pp more (capped at 95%); it does not override the plan.
  const suggestedRatio = conservativeMode
    ? Math.min(0.95, (savingsTargetPercent + 10) / 100)
    : investRatio;
  return {
    recommendedSpending: Math.round(residual * (1 - investRatio)),
    recommendedInvestment: Math.round(residual * investRatio),
    conservativeMode,
    conservativeReason,
    suggestedInvestment: Math.round(residual * suggestedRatio),
  };
}

export type EmergencyFundStatus = 'low' | 'adequate' | 'strong';

export interface EmergencyFundResult {
  monthsCovered: number;       // buffer ÷ monthly essential expenses (Infinity if no expenses)
  minMonths: number;           // lower bound of the recommended band
  targetMonths: number;        // upper bound of the recommended band
  status: EmergencyFundStatus;
  shortfallToMin: number;      // kr still needed to reach minMonths (0 if already there)
}

/**
 * Emergency-fund adequacy: how many months of essential (fixed) expenses the
 * buffer account covers, against the conventional 3–6 month band.
 *
 * monthlyEssentialExpenses == 0 ⇒ no expenses to cover, so coverage is Infinity
 * and the fund counts as 'strong' (callers should special-case the display).
 */
export function calcEmergencyFundStatus(
  bufferAccount: number,
  monthlyEssentialExpenses: number,
  minMonths: number = 3,
  targetMonths: number = 6
): EmergencyFundResult {
  if (monthlyEssentialExpenses <= 0) {
    return { monthsCovered: Infinity, minMonths, targetMonths, status: 'strong', shortfallToMin: 0 };
  }
  const monthsCovered = bufferAccount / monthlyEssentialExpenses;
  const status: EmergencyFundStatus =
    monthsCovered >= targetMonths ? 'strong' : monthsCovered >= minMonths ? 'adequate' : 'low';
  const shortfallToMin = Math.max(0, minMonths * monthlyEssentialExpenses - bufferAccount);
  return { monthsCovered, minMonths, targetMonths, status, shortfallToMin };
}

export interface BufferRecommendation {
  /** 'build' while below the minimum band; 'maintain' once at/above it. */
  action: 'build' | 'maintain';
  /** Monthly set-aside that closes the shortfall over `horizonMonths`, rounded up
   *  to a whole 100 kr. 0 when nothing is needed. This is the figure to route to
   *  the buffer account as a monthly fixed expense. */
  suggestedMonthly: number;
  horizonMonths: number;
}

/**
 * Turn an emergency-fund status into one actionable number: the monthly amount
 * that would close the gap to the minimum band over `horizonMonths`. Rounds up to
 * a clean 100 kr so the reserve reaches the minimum within the horizon rather than
 * a hair under. Returns 'maintain' (0) once the buffer is already at/above min.
 */
export function bufferRecommendation(ef: EmergencyFundResult, horizonMonths: number = 12): BufferRecommendation {
  const months = Math.max(1, horizonMonths);
  if (!(ef.shortfallToMin > 0)) return { action: 'maintain', suggestedMonthly: 0, horizonMonths: months };
  const suggestedMonthly = Math.ceil(ef.shortfallToMin / months / 100) * 100;
  return { action: 'build', suggestedMonthly, horizonMonths: months };
}

export type DebtToIncomeStatus = 'healthy' | 'moderate' | 'high';

export interface DebtToIncomeResult {
  ratio: number;               // total debt ÷ gross annual income (0 if no income)
  cap: number;                 // regulatory ceiling (Norway: 5×)
  status: DebtToIncomeStatus;
  borrowingHeadroom: number;   // additional debt allowed before hitting the cap (≥0)
}

/**
 * Debt-to-income ratio against Norway's lending rule, which caps total debt at
 * 5× gross annual income. Below 3× is comfortable, 3×–cap is moderate, above
 * the cap means no further borrowing is permitted under the rule.
 *
 * grossAnnualIncome == 0 ⇒ ratio is undefined; we report 0 and no headroom so
 * callers can show an "add salary" placeholder instead of a misleading number.
 */
export function calcDebtToIncome(
  totalDebt: number,
  grossAnnualIncome: number,
  cap: number = 5
): DebtToIncomeResult {
  if (grossAnnualIncome <= 0) {
    return { ratio: 0, cap, status: 'healthy', borrowingHeadroom: 0 };
  }
  const ratio = totalDebt / grossAnnualIncome;
  const status: DebtToIncomeStatus = ratio > cap ? 'high' : ratio >= 3 ? 'moderate' : 'healthy';
  const borrowingHeadroom = Math.max(0, cap * grossAnnualIncome - totalDebt);
  return { ratio, cap, status, borrowingHeadroom };
}

export interface SaleProceeds {
  agentCost: number;
  netProceeds: number;
}

export function calcNetSaleProceeds(
  salePrice: number,
  mortgageBalance: number,
  agentFeePercent: number,
  documentFee: number,
  otherCosts: number
): SaleProceeds {
  const agentCost = (salePrice * agentFeePercent) / 100;
  const netProceeds = salePrice - mortgageBalance - agentCost - documentFee - otherCosts;
  return { agentCost, netProceeds };
}

export function calcBridgeLoanCost(
  bridgeAmount: number,
  bridgeLoanRate: number,
  bridgeMonths: number
): number {
  return bridgeAmount * (bridgeLoanRate / 100 / 12) * bridgeMonths;
}

export interface HomeownerStatus {
  monthlyPaymentCalc: number;
  monthlyInterest: number;
  monthlyPrincipal: number;
  annualTaxDeduction: number;
  /** Share of the ORIGINAL loan already repaid, as a percent (not home equity). */
  originalLoanRepaidPercent: number;
}

export function calcHomeownerMortgageStatus(
  currentBalance: number,
  originalLoan: number,
  annualRate: number,
  yearsRemaining: number,
  skattefradragssats: number
): HomeownerStatus {
  const monthlyRate = annualRate / 100 / 12;
  const monthlyPaymentCalc = calcMonthlyPayment(currentBalance, annualRate, yearsRemaining);
  const monthlyInterest = currentBalance * monthlyRate;
  const monthlyPrincipal = monthlyPaymentCalc - monthlyInterest;
  // Tax deduction is based on the FIRST year's real interest (summed over the
  // amortizing 12 months), not month-1 interest extrapolated flat — the balance
  // (and thus interest) falls every month, so flat×12 overstates it.
  const yearOneInterest = calcAmortizationSchedule(currentBalance, annualRate, yearsRemaining)[0]?.interestPaid
    ?? monthlyInterest * 12;
  const annualTaxDeduction = yearOneInterest * (skattefradragssats / 100);
  const originalLoanRepaidPercent =
    originalLoan > 0
      ? Math.max(0, ((originalLoan - currentBalance) / originalLoan) * 100)
      : 0;
  return { monthlyPaymentCalc, monthlyInterest, monthlyPrincipal, annualTaxDeduction, originalLoanRepaidPercent };
}

export interface BucketAmounts {
  stocks: number;
  crypto: number;
  cash: number;
  house: number;
}

export interface BucketRates {
  stocks: number;
  crypto: number;
  cash: number;
  house: number;
}

export interface BucketProjectionPoint {
  year: number;
  stocks: number;
  crypto: number;
  cash: number;
  house: number;
  /** Non-mortgage debt remaining that year (0 unless `debtByYear` is passed). */
  debt: number;
  total: number;
}

/**
 * Project housing equity forward year by year.
 *
 * Equity = market value − remaining mortgage. The appreciation rate applies to
 * the full property value (not to the equity), and the mortgage balance declines
 * each year per its amortization schedule. Because the debt shrinks while the
 * whole asset appreciates, equity grows considerably faster than the bare
 * appreciation rate would suggest (the leverage effect).
 *
 * Returns equity for years 0..years (index 0 = today).
 */
export function calcHouseEquityByYear(
  houseValue: number,
  houseDebt: number,
  appreciationRate: number,
  loanRate: number,
  loanTermYears: number,
  years: number
): number[] {
  const schedule =
    houseDebt > 0 && loanTermYears > 0
      ? calcAmortizationSchedule(houseDebt, loanRate, loanTermYears)
      : [];
  const equity: number[] = [];
  let value = houseValue;
  for (let y = 0; y <= years; y++) {
    // schedule[y - 1] is the balance at the end of year y; once the loan is
    // paid off the schedule runs out and the remaining balance is 0. But when
    // there's NO schedule at all (term ≤ 0), the debt doesn't amortize — carry
    // houseDebt forward instead of vanishing it to 0.
    const debt =
      y === 0
        ? houseDebt
        : schedule.length > 0
          ? schedule[y - 1]?.balance ?? 0
          : houseDebt;
    equity.push(value - debt);
    value = value * (1 + appreciationRate / 100);
  }
  return equity;
}

/**
 * Mortgage balance remaining at the end of each year, index 0..years (year 0 is
 * the current balance). Mirrors the debt half of `calcHouseEquityByYear`: once
 * the loan amortizes away the balance is 0; with no term (≤ 0) the debt can't
 * amortize, so it's carried flat rather than vanished.
 */
export function calcMortgageBalanceByYear(
  houseDebt: number,
  loanRate: number,
  loanTermYears: number,
  years: number
): number[] {
  const schedule =
    houseDebt > 0 && loanTermYears > 0
      ? calcAmortizationSchedule(houseDebt, loanRate, loanTermYears)
      : [];
  const out: number[] = [];
  for (let y = 0; y <= years; y++) {
    const debt =
      y === 0
        ? houseDebt
        : schedule.length > 0
          ? schedule[y - 1]?.balance ?? 0
          : houseDebt;
    out.push(Math.round(Math.max(0, debt)));
  }
  return out;
}

/**
 * Project each asset bucket forward at its own annual growth rate.
 * `annualSavings` accrues to the stocks bucket each year (assumption:
 * discretionary savings flow into investments).
 *
 * Pass `houseByYear` (see `calcHouseEquityByYear`) to model housing with
 * appreciation + mortgage paydown; without it, the house bucket simply
 * compounds `start.house` at `rates.house`.
 *
 * Pass `debtByYear` (see `calcDebtBalanceByYear`) to net non-mortgage debt
 * paydown out of `total`, so the projection starts at true net worth instead
 * of asset equity; without it, debt is 0 and `total` is the asset sum.
 */
export function calcNetWorthProjectionByBucket(
  start: BucketAmounts,
  annualSavings: number,
  rates: BucketRates,
  years: number,
  houseByYear?: number[],
  debtByYear?: number[]
): BucketProjectionPoint[] {
  const result: BucketProjectionPoint[] = [];
  let { stocks, crypto, cash, house } = start;
  const currentYear = new Date().getFullYear();

  for (let y = 0; y <= years; y++) {
    const houseVal = houseByYear ? houseByYear[y] ?? house : house;
    const debtVal = debtByYear ? debtByYear[y] ?? 0 : 0;
    result.push({
      year: currentYear + y,
      stocks: Math.round(stocks),
      crypto: Math.round(crypto),
      cash: Math.round(cash),
      house: Math.round(houseVal),
      debt: Math.round(debtVal),
      total: Math.round(stocks + crypto + cash + houseVal - debtVal),
    });
    stocks = stocks * (1 + rates.stocks / 100) + annualSavings;
    crypto = crypto * (1 + rates.crypto / 100);
    cash = cash * (1 + rates.cash / 100);
    if (!houseByYear) house = house * (1 + rates.house / 100);
  }
  return result;
}
