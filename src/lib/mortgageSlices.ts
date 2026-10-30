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

const HOUSING_MODES: readonly HousingMode[] = ['first_buyer', 'homeowner', 'transitioning'];

/** A known housing mode, or undefined (a missing or unknown mode). */
export function validHousingMode(v: unknown): HousingMode | undefined {
  return HOUSING_MODES.includes(v as HousingMode) ? (v as HousingMode) : undefined;
}

/** Only a 'YYYY-MM' month counts as a balance date. */
const isMonthKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** A stored balance: finite, negatives clamped to 0; anything else is absent. */
const balanceOf = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : undefined;

/** A balance only a user could have entered: positive and not the placeholder. */
const isReal = (b: number | undefined): b is number => b !== undefined && b > 0 && b !== PLACEHOLDER_MORTGAGE_BALANCE;

/**
 * Bring the three slices to one balance. Unknown modes read as first_buyer.
 *  • first_buyer: assets.houseDebt wins.
 *  • homeowner / transitioning: the active owner slice (homeowner →
 *    homeowner, transitioning → transition) wins unless it holds exactly the
 *    placeholder. Then a real value in another slice (Assets first) wins,
 *    stamped or not: #218's legacy-term stamp also landed on untouched
 *    placeholders, so a stamp does not prove the placeholder was entered. With
 *    no real value elsewhere, a stamped placeholder stands; otherwise Assets'
 *    value (0 when Assets is absent) is used. The accepted cost: a real loan of
 *    exactly 3 000 000 loses to another slice that disagrees with it.
 *    A missing or malformed balance date is stamped `monthKey`.
 * Negative balances clamp to 0. Slices absent from `data` are left absent.
 *
 * Idempotent, and returns `data` itself when nothing needs changing, so a plain
 * load does not dirty the blob.
 */
export function reconcileMortgageSlices<T extends MortgageSliceFields>(data: T, monthKey: string): T {
  const mode = validHousingMode(data.housingMode) ?? 'first_buyer';
  const { assets: a, homeowner: h, transition: tr } = data;
  const stamped = isMonthKey(h?.currentMortgageBalanceAsOf);

  const hb = balanceOf(h?.currentMortgageBalance);
  const tb = balanceOf(tr?.currentMortgageBalance);
  const ab = balanceOf(a?.houseDebt);

  let balance: number | undefined;
  if (mode === 'first_buyer') {
    balance = ab;
  } else {
    const active = mode === 'homeowner' ? hb : tb;
    const others = mode === 'homeowner' ? [ab, tb] : [ab, hb];
    if (active !== undefined && active !== PLACEHOLDER_MORTGAGE_BALANCE) balance = active;
    else balance = others.find(isReal) ?? (active !== undefined && stamped ? active : ab ?? 0);
  }
  if (balance === undefined) return data;

  const stamp = mode !== 'first_buyer' && !stamped;
  const fixAssets = a != null && a.houseDebt !== balance;
  const fixHomeowner = h != null && (h.currentMortgageBalance !== balance || stamp);
  const fixTransition = tr != null && tr.currentMortgageBalance !== balance;
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

/**
 * Reconcile after an import overlays `imported` on `current` (fields absent from
 * the import keep their current value). The imported mortgage takes precedence:
 * when the import carries some of the three slices, its balance is copied into
 * the ones it lacks before reconciling, so importing only Assets does not lose
 * to the stored homeowner slice. An imported untouched placeholder (unstamped
 * 3 000 000 and nothing else) carries no balance and is not copied. An unknown
 * imported mode keeps the current mode.
 */
export function reconcileImportedMortgage<T extends MortgageSliceFields>(
  current: T,
  imported: MortgageSliceFields,
  monthKey: string,
): T {
  const housingMode = validHousingMode(imported.housingMode) ?? current.housingMode;
  const merged: T = {
    ...current,
    housingMode,
    assets: imported.assets ?? current.assets,
    homeowner: imported.homeowner ?? current.homeowner,
    transition: imported.transition ?? current.transition,
  };

  const ia = balanceOf(imported.assets?.houseDebt);
  const ih = balanceOf(imported.homeowner?.currentMortgageBalance);
  const it = balanceOf(imported.transition?.currentMortgageBalance);
  const carried = [ia, ih, it].filter(b => b !== undefined);
  const meaningful = ia !== undefined || isReal(ih) || isReal(it)
    || (ih !== undefined && isMonthKey(imported.homeowner?.currentMortgageBalanceAsOf));
  if (carried.length === 0 || carried.length === 3 || !meaningful) return reconcileMortgageSlices(merged, monthKey);

  // The balance the import alone settles on (its own reconcile, so an imported
  // placeholder beside a real imported value still loses).
  const own = reconcileMortgageSlices({
    housingMode,
    ...(ia !== undefined ? { assets: imported.assets } : {}),
    ...(ih !== undefined ? { homeowner: imported.homeowner } : {}),
    ...(it !== undefined ? { transition: imported.transition } : {}),
  }, monthKey);
  const b = balanceOf(own.assets?.houseDebt) ?? balanceOf(own.homeowner?.currentMortgageBalance)
    ?? balanceOf(own.transition?.currentMortgageBalance) ?? 0;

  return reconcileMortgageSlices({
    ...merged,
    ...(ia === undefined && merged.assets ? { assets: { ...merged.assets, houseDebt: b } } : {}),
    ...(ih === undefined && merged.homeowner
      ? { homeowner: { ...merged.homeowner, currentMortgageBalance: b, currentMortgageBalanceAsOf: monthKey } }
      : {}),
    ...(it === undefined && merged.transition ? { transition: { ...merged.transition, currentMortgageBalance: b } } : {}),
  }, monthKey);
}
