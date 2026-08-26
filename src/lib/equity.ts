import type { Assets } from '../context/FinanceContext';

export interface EquityBreakdown {
  taxOnGain: number;
  /** How much of the shielding allowance the gain actually absorbed (display only). */
  shieldingUsed: number;
  netInvestment: number;
  houseEquity: number;
  cryptoTaxOnGain: number;
  netCrypto: number;
  savingsTotal: number;
  totalEquity: number;
}

// Total cash across savings accounts. Prefers the `savingsAccounts` array; falls
// back to the legacy single `savings` scalar for pre-migration/older-snapshot
// data. Loaded data is migrated at the applyPayload boundary (live assets and
// snapshots both), so the fallback is boundary tolerance for not-yet-applied
// imports rather than a load-bearing path.
export function sumSavings(a: Assets): number {
  if (Array.isArray(a.savingsAccounts)) {
    return a.savingsAccounts.reduce((s, acc) => s + (Number.isFinite(acc.balance) ? acc.balance : 0), 0);
  }
  return a.savings ?? 0;
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
//
// Skjermingsfradrag (the shielding allowance) makes the share side asymmetric:
// accumulated, unused shielding is deducted from a gain before tax, but it can
// never deepen a loss — unused shielding carries forward to later years instead
// of turning into a deduction now. So it only ever bites into a positive gain,
// and it is capped by that gain. Crypto has no shielding and is untouched.
export interface EquityPoint {
  monthKey: string;
  breakdown: EquityBreakdown;
}

/**
 * Per-recorded-month equity breakdown, sorted oldest → newest. Derived from the
 * snapshots through the same `computeEquityBreakdown` the live page uses, so the
 * egenkapital history can never drift from the live figure (HISTORY_PLAN §6.1).
 * Typed structurally (only `assets` is read) to stay decoupled from BalanceSnapshot.
 */
export function equitySeriesFrom(snapshots: Record<string, { assets: Assets }>): EquityPoint[] {
  return Object.keys(snapshots)
    .sort()
    .map(monthKey => ({ monthKey, breakdown: computeEquityBreakdown(snapshots[monthKey].assets) }));
}

export function computeEquityBreakdown(a: Assets): EquityBreakdown {
  // Old balance snapshots are stored verbatim and may predate a field
  // (cryptoUnrealizedGain, bufferAccount, ...); guard each with ?? 0 so a
  // missing field can't turn the whole breakdown into NaN.
  const gain = a.unrealizedGain ?? 0;
  // Floored at 0: a negative allowance is meaningless, and only an imported blob
  // could carry one (the UI clamps the input to >= 0).
  const shielding = Math.max(0, a.shieldingDeduction ?? 0);
  const shieldingUsed = Math.min(shielding, Math.max(0, gain));
  const taxOnGain = ((gain - shieldingUsed) * (a.taxRate ?? 0)) / 100;
  const netInvestment = (a.portfolio ?? 0) - taxOnGain;
  const houseEquity = (a.houseValue ?? 0) - (a.houseDebt ?? 0);
  const cryptoTaxOnGain = ((a.cryptoUnrealizedGain ?? 0) * (a.cryptoTaxRate ?? 0)) / 100;
  const netCrypto = (a.crypto ?? 0) - cryptoTaxOnGain;
  const savingsTotal = sumSavings(a);
  const totalEquity = netInvestment + netCrypto + (a.bsu ?? 0) + savingsTotal + (a.bufferAccount ?? 0) + houseEquity;
  return { taxOnGain, shieldingUsed, netInvestment, houseEquity, cryptoTaxOnGain, netCrypto, savingsTotal, totalEquity };
}
