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
// can never drift. Latent tax is floored at 0 — a loss is not a liquid asset.
export function computeEquityBreakdown(a: Assets): EquityBreakdown {
  const taxOnGain = (Math.max(0, a.unrealizedGain) * a.taxRate) / 100;
  const netInvestment = a.portfolio - taxOnGain;
  const houseEquity = a.houseValue - a.houseDebt;
  const cryptoTaxOnGain = (Math.max(0, a.cryptoUnrealizedGain) * a.cryptoTaxRate) / 100;
  const netCrypto = a.crypto - cryptoTaxOnGain;
  const totalEquity = netInvestment + netCrypto + a.bsu + a.savings + a.bufferAccount + houseEquity;
  return { taxOnGain, netInvestment, houseEquity, cryptoTaxOnGain, netCrypto, totalEquity };
}
