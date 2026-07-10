// "Prepay the mortgage vs invest the money" — the most common spare-krone
// question in Norway, where mortgage interest is tax-deductible (rentefradrag).
// Pure + unit-tested so the Forecast tile can reuse it without React.
//
// Both sides are modeled as the same fixed extra amount put to work every month
// for the horizon, then grown to a future value:
//   - Prepaying earns a guaranteed return equal to the mortgage's *after-tax*
//     rate: every krone of interest you avoid would have been deductible at
//     `interestDeductionRatePct`, so the real saving is rate × (1 − deduction).
//   - Investing earns the expected return, optionally net of a gains tax.
//
// Comparing the two future values answers "where does the extra krone grow
// faster". This is the standard Norwegian rule of thumb (after-tax mortgage
// rate vs expected return), not a full cash-flow model: it ignores mortgage
// payoff timing and assumes the extra is put to work for the whole horizon.

export interface PrepayVsInvest {
  extraMonthly: number;
  months: number;
  contributions: number;            // extraMonthly × months (what you put in)
  afterTaxMortgageRatePct: number;  // mortgageRate × (1 − deduction)
  afterTaxReturnPct: number;        // investReturn × (1 − gainsTax)
  prepayFutureValue: number;        // FV of the extra at the after-tax mortgage rate
  investFutureValue: number;        // FV of the extra at the after-tax return
  prepayGain: number;               // prepayFutureValue − contributions
  investGain: number;               // investFutureValue − contributions
  advantage: number;                // |investFV − prepayFV|
  winner: 'prepay' | 'invest' | 'tie';
}

/** Future value of an ordinary monthly annuity (contributions at period end). */
function futureValueAnnuity(monthly: number, annualRatePct: number, months: number): number {
  const i = annualRatePct / 100 / 12;
  if (Math.abs(i) < 1e-9) return monthly * months; // 0% → no compounding
  return monthly * ((Math.pow(1 + i, months) - 1) / i);
}

export function prepayVsInvest(
  extraMonthly: number,
  mortgageRatePct: number,
  investReturnPct: number,
  years: number,
  interestDeductionRatePct = 22,
  investGainsTaxPct = 0,
): PrepayVsInvest {
  const monthly = Math.max(0, extraMonthly);
  const months = Math.max(0, Math.round(years * 12));
  const deduction = Math.min(100, Math.max(0, interestDeductionRatePct)) / 100;
  const gainsTax = Math.min(100, Math.max(0, investGainsTaxPct)) / 100;

  const afterTaxMortgageRatePct = mortgageRatePct * (1 - deduction);
  const afterTaxReturnPct = investReturnPct * (1 - gainsTax);

  const prepayFutureValue = futureValueAnnuity(monthly, afterTaxMortgageRatePct, months);
  const investFutureValue = futureValueAnnuity(monthly, afterTaxReturnPct, months);
  const contributions = monthly * months;

  const diff = investFutureValue - prepayFutureValue;
  const EPS = 1; // sub-krone differences read as a tie
  const winner = Math.abs(diff) < EPS ? 'tie' : diff > 0 ? 'invest' : 'prepay';

  return {
    extraMonthly: monthly,
    months,
    contributions,
    afterTaxMortgageRatePct,
    afterTaxReturnPct,
    prepayFutureValue,
    investFutureValue,
    prepayGain: prepayFutureValue - contributions,
    investGain: investFutureValue - contributions,
    advantage: Math.abs(diff),
    winner,
  };
}
