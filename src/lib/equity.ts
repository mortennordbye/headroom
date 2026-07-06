import type { Assets } from '../context/FinanceContext';

export interface EquityBreakdown {
  taxOnGain: number;
  netInvestment: number;
  houseEquity: number;
  cryptoTaxOnGain: number;
  netCrypto: number;
  totalEquity: number;
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
  const totalEquity = netInvestment + netCrypto + a.bsu + a.savings + a.bufferAccount + houseEquity;
  return { taxOnGain, netInvestment, houseEquity, cryptoTaxOnGain, netCrypto, totalEquity };
}
