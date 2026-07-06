import type { Assets } from '../context/FinanceContext';

export interface EquityBreakdown {
  taxOnGain: number;
  netInvestment: number;
  houseEquity: number;
  cryptoTaxOnGain: number;
  netCrypto: number;
  savingsTotal: number;
  totalEquity: number;
}

// Total cash across savings accounts. Prefers the `savingsAccounts` array; falls
// back to the legacy single `savings` scalar for pre-migration/older-snapshot
// data (so historical balance snapshots without the array still value correctly).
export function sumSavings(a: Assets): number {
  if (Array.isArray(a.savingsAccounts)) {
    return a.savingsAccounts.reduce((s, acc) => s + (Number.isFinite(acc.balance) ? acc.balance : 0), 0);
  }
  return a.savings;
}

// Single source of truth for turning raw asset inputs into post-tax net equity.
// Used both by the live context and by the historical snapshot viewer so the two
// can never drift.
//
// Latent tax is symmetric: a gain carries a latent tax *liability* (positive
// `taxOnGain`, reduces net value), and an unrealized *loss* carries a latent tax
// *benefit* (negative `taxOnGain`, raises net value) — realizing a loss is
// deductible (e.g. an ASK/aksjekonto loss offsets share-income tax at the same
// rate). Both are contingent-on-selling, so treating them symmetrically is fair.
export function computeEquityBreakdown(a: Assets): EquityBreakdown {
  const taxOnGain = (a.unrealizedGain * a.taxRate) / 100;
  const netInvestment = a.portfolio - taxOnGain;
  const houseEquity = a.houseValue - a.houseDebt;
  const cryptoTaxOnGain = (a.cryptoUnrealizedGain * a.cryptoTaxRate) / 100;
  const netCrypto = a.crypto - cryptoTaxOnGain;
  const savingsTotal = sumSavings(a);
  const totalEquity = netInvestment + netCrypto + a.bsu + savingsTotal + a.bufferAccount + houseEquity;
  return { taxOnGain, netInvestment, houseEquity, cryptoTaxOnGain, netCrypto, savingsTotal, totalEquity };
}
