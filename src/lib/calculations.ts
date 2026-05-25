export function calcMonthlyPayment(principal: number, annualRate: number, years: number): number {
  const monthlyRate = annualRate / 100 / 12;
  const n = years * 12;
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
  const n = yearsRemaining * 12;
  const monthlyPaymentCalc =
    monthlyRate === 0
      ? currentBalance / n
      : (currentBalance * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -n));
  const monthlyInterest = currentBalance * monthlyRate;
  const monthlyPrincipal = monthlyPaymentCalc - monthlyInterest;
  const annualTaxDeduction = monthlyInterest * 12 * (skattefradragssats / 100);
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
 * Project each asset bucket forward at its own annual growth rate.
 * `annualSavings` accrues to the stocks bucket each year (assumption:
 * discretionary savings flow into investments).
 */
export function calcNetWorthProjectionByBucket(
  start: BucketAmounts,
  annualSavings: number,
  rates: BucketRates,
  years: number
): BucketProjectionPoint[] {
  const result: BucketProjectionPoint[] = [];
  let { stocks, crypto, cash, house } = start;
  const currentYear = new Date().getFullYear();

  for (let y = 0; y <= years; y++) {
    result.push({
      year: currentYear + y,
      stocks: Math.round(stocks),
      crypto: Math.round(crypto),
      cash: Math.round(cash),
      house: Math.round(house),
      total: Math.round(stocks + crypto + cash + house),
    });
    stocks = stocks * (1 + rates.stocks / 100) + annualSavings;
    crypto = crypto * (1 + rates.crypto / 100);
    cash = cash * (1 + rates.cash / 100);
    house = house * (1 + rates.house / 100);
  }
  return result;
}
