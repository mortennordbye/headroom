export function calcMonthlyPayment(principal: number, annualRate: number, years: number): number {
  const monthlyRate = annualRate / 100 / 12;
  const n = years * 12;
  if (n <= 0) return 0; // guard: a 0/negative term has no payment schedule (avoids Infinity/NaN)
  if (monthlyRate === 0) return principal / n;
  return principal * monthlyRate / (1 - Math.pow(1 + monthlyRate, -n));
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
      annualPayment: monthlyPayment * 12,
      principalPaid: yearPrincipal,
      interestPaid: yearInterest,
      balance,
    });
    if (balance < 0.01) break;
  }
  return schedule;
}

export interface BudgetRecommendation {
  recommendedSpending: number;
  recommendedInvestment: number;
  conservativeMode: boolean;
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
  const conservativeMode = shortfall > 0.10 || volatility > 0.15;
  if (residual <= 0) return { recommendedSpending: 0, recommendedInvestment: 0, conservativeMode: true };
  // In conservative mode, bump savings by 10 percentage points (capped at 95%)
  const investRatio = conservativeMode
    ? Math.min(0.95, (savingsTargetPercent + 10) / 100)
    : savingsTargetPercent / 100;
  return {
    recommendedSpending: Math.round(residual * (1 - investRatio)),
    recommendedInvestment: Math.round(residual * investRatio),
    conservativeMode,
  };
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
  equityPercent: number;
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
  const equityPercent =
    originalLoan > 0
      ? Math.max(0, ((originalLoan - currentBalance) / originalLoan) * 100)
      : 0;
  return { monthlyPaymentCalc, monthlyInterest, monthlyPrincipal, annualTaxDeduction, equityPercent };
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
    // paid off the schedule runs out and the remaining balance is 0.
    const debt = y === 0 ? houseDebt : schedule[y - 1]?.balance ?? 0;
    equity.push(value - debt);
    value = value * (1 + appreciationRate / 100);
  }
  return equity;
}

/**
 * Project each asset bucket forward at its own annual growth rate.
 * `annualSavings` accrues to the stocks bucket each year (assumption:
 * discretionary savings flow into investments).
 *
 * Pass `houseByYear` (see `calcHouseEquityByYear`) to model housing with
 * appreciation + mortgage paydown; without it, the house bucket simply
 * compounds `start.house` at `rates.house`.
 */
export function calcNetWorthProjectionByBucket(
  start: BucketAmounts,
  annualSavings: number,
  rates: BucketRates,
  years: number,
  houseByYear?: number[]
): BucketProjectionPoint[] {
  const result: BucketProjectionPoint[] = [];
  let { stocks, crypto, cash, house } = start;
  const currentYear = new Date().getFullYear();

  for (let y = 0; y <= years; y++) {
    const houseVal = houseByYear ? houseByYear[y] ?? house : house;
    result.push({
      year: currentYear + y,
      stocks: Math.round(stocks),
      crypto: Math.round(crypto),
      cash: Math.round(cash),
      house: Math.round(houseVal),
      total: Math.round(stocks + crypto + cash + houseVal),
    });
    stocks = stocks * (1 + rates.stocks / 100) + annualSavings;
    crypto = crypto * (1 + rates.crypto / 100);
    cash = cash * (1 + rates.cash / 100);
    if (!houseByYear) house = house * (1 + rates.house / 100);
  }
  return result;
}
