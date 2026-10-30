import type { HousingMode } from '../context/FinanceContext';

// The current home's mortgage is one real balance stored in three slices:
// `assets.houseDebt` (net worth), `homeowner.currentMortgageBalance` (payment,
// LTV) and `transition.currentMortgageBalance` (sale maths). All hold the whole
// loan. The writers keep them in lockstep; this repairs a blob where they drifted
// (old saves, the placeholder defaults) so every reader sees one balance.

/** The balance the homeowner and transition slices start with before anyone
 *  enters a mortgage. Untouched, it means "not set", not a real 3 MNOK loan. */
export const PLACEHOLDER_MORTGAGE_BALANCE = 3_000_000;

/** The fields read and written here. Loose: old or imported blobs may lack any. */
export interface MortgageSliceFields {
  housingMode?: HousingMode;
  assets?: { houseDebt?: number };
  homeowner?: { currentMortgageBalance?: number; currentMortgageBalanceAsOf?: string };
  transition?: { currentMortgageBalance?: number };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A balance someone wrote: finite, and not the placeholder left untouched (no
 *  as-of stamp; every writer of either owner slice stamps the homeowner one). */
function written(balance: unknown, asOf: unknown): balance is number {
  return finite(balance) && !(balance === PLACEHOLDER_MORTGAGE_BALANCE && !asOf);
}

/**
 * Bring the three slices to one balance. The active mode's slice wins
 * (homeowner → homeowner, transitioning → transition, first_buyer →
 * assets.houseDebt); an owner slice that was never written falls back to
 * assets.houseDebt. In the owner modes a missing balance date is stamped
 * `monthKey`. Slices absent from `data` are left absent.
 *
 * Idempotent, and returns `data` itself when nothing needs changing, so a plain
 * load does not dirty the blob.
 */
export function reconcileMortgageSlices<T extends MortgageSliceFields>(data: T, monthKey: string): T {
  const mode = data.housingMode ?? 'first_buyer';
  const { assets: a, homeowner: h, transition: tr } = data;
  const asOf = h?.currentMortgageBalanceAsOf;

  const hb = h?.currentMortgageBalance;
  const tb = tr?.currentMortgageBalance;
  const ab = a?.houseDebt;
  const balance = mode === 'homeowner' && written(hb, asOf) ? hb
    : mode === 'transitioning' && written(tb, asOf) ? tb
      : finite(ab) ? ab : undefined;
  if (balance === undefined) return data;

  const stamp = mode !== 'first_buyer' && !asOf;
  const fixAssets = a != null && ab !== balance;
  const fixHomeowner = h != null && (hb !== balance || stamp);
  const fixTransition = tr != null && tb !== balance;
  if (!fixAssets && !fixHomeowner && !fixTransition) return data;

  return {
    ...data,
    ...(fixAssets ? { assets: { ...a, houseDebt: balance } } : {}),
    ...(fixHomeowner
      ? { homeowner: { ...h, currentMortgageBalance: balance, ...(stamp ? { currentMortgageBalanceAsOf: monthKey } : {}) } }
      : {}),
    ...(fixTransition ? { transition: { ...tr, currentMortgageBalance: balance } } : {}),
  };
}
