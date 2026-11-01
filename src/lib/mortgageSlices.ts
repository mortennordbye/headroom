import type { HousingMode } from '../context/FinanceContext';
import { coerceNumber } from './sanitizePayload';

// The current home's mortgage is stored once, in `assets.houseDebt`; the
// homeowner slice keeps only the month it was written
// (`currentMortgageBalanceAsOf`). Older saves held the same balance in
// `homeowner.currentMortgageBalance` and `transition.currentMortgageBalance`
// too, with a 3 000 000 placeholder default. This file reads those once, picks
// the balance the app showed, writes it to `assets.houseDebt` and drops the old
// fields (migrateMortgageBalance / migrateImportedMortgage).

/** The balance the old homeowner and transition slices started with before
 *  anyone entered a mortgage. Untouched, it meant "not set". Only legacy data
 *  is read against it. */
const PLACEHOLDER_MORTGAGE_BALANCE = 3_000_000;

/** The fields read and written here. Loose: old or imported blobs may lack any,
 *  and the two `currentMortgageBalance` fields exist only in legacy data. */
export interface MortgageSliceFields {
  housingMode?: HousingMode;
  assets?: { houseDebt?: number };
  homeowner?: { currentMortgageBalance?: number; currentMortgageBalanceAsOf?: string };
  // currentHouseValue is never read; it names a field every transition slice has.
  transition?: { currentMortgageBalance?: number; currentHouseValue?: number };
}

const HOUSING_MODES: readonly HousingMode[] = ['first_buyer', 'homeowner', 'transitioning'];

/** A known housing mode, or undefined (a missing or unknown mode). */
export function validHousingMode(v: unknown): HousingMode | undefined {
  return HOUSING_MODES.includes(v as HousingMode) ? (v as HousingMode) : undefined;
}

/** Only a 'YYYY-MM' month counts as a balance date. */
const isMonthKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** A stored balance: finite, negatives clamped to 0; anything else is absent.
 *  A numeric string ("1 900 000") is read the way the load's sanitizer reads
 *  number fields, since the old copies are no longer in its schema. */
const balanceOf = (v: unknown): number | undefined => {
  const n = coerceNumber(v);
  return n !== undefined && Number.isFinite(n) ? Math.max(0, n) : undefined;
};

/** A balance only a user could have entered: positive and not the placeholder. */
const isReal = (b: number | undefined): b is number => b !== undefined && b > 0 && b !== PLACEHOLDER_MORTGAGE_BALANCE;

/**
 * Legacy data only: bring the three old slices to one balance, as the app did
 * before the balance was stored once. Unknown modes read as first_buyer.
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
 * Returns `data` itself when nothing needs changing.
 */
function reconcileLegacy<T extends MortgageSliceFields>(data: T, monthKey: string): T {
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

const isOwnerMode = (m: HousingMode | undefined) => m === 'homeowner' || m === 'transitioning';

/** True when a blob still carries the old duplicate balance fields. */
const hasLegacyFields = (d: MortgageSliceFields) =>
  (d.homeowner != null && 'currentMortgageBalance' in d.homeowner)
  || (d.transition != null && 'currentMortgageBalance' in d.transition);

/**
 * True when a legacy blob or stored snapshot settles on the 3 000 000
 * placeholder only because an old homeowner or transition copy held it (a
 * dated placeholder stands on load when nothing else is real). Assets holding
 * the same value counts as a real loan. Used where a balance anchors a plan,
 * so a placeholder nobody entered is not read as a real loan.
 */
export function settlesOnLegacyPlaceholder(data: MortgageSliceFields, monthKey: string): boolean {
  if (!hasLegacyFields(data) || balanceOf(data.assets?.houseDebt) === PLACEHOLDER_MORTGAGE_BALANCE) return false;
  return balanceOf(migrateMortgageBalance(data, monthKey).assets?.houseDebt) === PLACEHOLDER_MORTGAGE_BALANCE;
}

/** Drop the old duplicate balance fields. Returns `data` itself when absent. */
function dropLegacyFields<T extends MortgageSliceFields>(data: T): T {
  if (!hasLegacyFields(data)) return data;
  const out = { ...data };
  if (data.homeowner != null && 'currentMortgageBalance' in data.homeowner) {
    const { currentMortgageBalance: _h, ...rest } = data.homeowner;
    out.homeowner = rest;
  }
  if (data.transition != null && 'currentMortgageBalance' in data.transition) {
    const { currentMortgageBalance: _t, ...rest } = data.transition;
    out.transition = rest;
  }
  return out;
}

/** In an owner mode the balance carries the month it was written; a missing
 *  or malformed date is stamped `monthKey`. */
function stampBalanceDate<T extends MortgageSliceFields>(data: T, monthKey: string): T {
  const h = data.homeowner;
  if (h == null || !isOwnerMode(validHousingMode(data.housingMode)) || isMonthKey(h.currentMortgageBalanceAsOf)) return data;
  return { ...data, homeowner: { ...h, currentMortgageBalanceAsOf: monthKey } };
}

/**
 * Bring a loaded blob or stored snapshot to the one-field shape. A legacy blob
 * is reconciled once (reconcileLegacy) and its balance written to
 * `assets.houseDebt`; an owner-mode balance with no `assets` creates it. The
 * old fields are then dropped. In an owner mode a missing balance date is
 * stamped `monthKey`.
 *
 * Idempotent, and returns `data` itself when nothing needs changing, so a plain
 * load does not dirty the blob.
 */
export function migrateMortgageBalance<T extends MortgageSliceFields>(data: T, monthKey: string): T {
  if (!hasLegacyFields(data)) return stampBalanceDate(data, monthKey);
  let r = reconcileLegacy(data, monthKey);
  if (r.assets == null && isOwnerMode(validHousingMode(r.housingMode))) {
    const b = balanceOf(r.homeowner?.currentMortgageBalance) ?? balanceOf(r.transition?.currentMortgageBalance);
    if (b !== undefined && b > 0) r = { ...r, assets: { houseDebt: b } };
  }
  return stampBalanceDate(dropLegacyFields(r), monthKey);
}

/**
 * The state after an import overlays `imported` on `current` (fields absent
 * from the import keep their current value; `current` is already migrated).
 * When the import carries a balance, in `assets.houseDebt` or in the legacy
 * fields, the balance the import alone settles on is written to the resulting
 * `assets.houseDebt`, so importing only an old homeowner slice still moves the
 * balance. An imported untouched placeholder (unstamped 3 000 000 and nothing
 * else) carries no balance. An unknown imported mode keeps the current mode.
 */
export function migrateImportedMortgage<T extends MortgageSliceFields>(
  current: T,
  imported: MortgageSliceFields,
  monthKey: string,
): T {
  const housingMode = validHousingMode(imported.housingMode) ?? current.housingMode;
  let merged: T = {
    ...current,
    housingMode,
    assets: imported.assets ?? current.assets,
    homeowner: imported.homeowner ?? current.homeowner,
    transition: imported.transition ?? current.transition,
  };

  const ia = balanceOf(imported.assets?.houseDebt);
  const ih = balanceOf(imported.homeowner?.currentMortgageBalance);
  const it = balanceOf(imported.transition?.currentMortgageBalance);
  const importedAsOf = imported.homeowner?.currentMortgageBalanceAsOf;
  const meaningful = ia !== undefined || isReal(ih) || isReal(it) || (ih !== undefined && isMonthKey(importedAsOf));
  if (meaningful) {
    // The balance the import alone settles on (its own reconcile, so an imported
    // placeholder beside a real imported value still loses).
    const own = reconcileLegacy({
      housingMode,
      ...(ia !== undefined ? { assets: imported.assets } : {}),
      ...(ih !== undefined ? { homeowner: imported.homeowner } : {}),
      ...(it !== undefined ? { transition: imported.transition } : {}),
    }, monthKey);
    const b = balanceOf(own.assets?.houseDebt) ?? balanceOf(own.homeowner?.currentMortgageBalance)
      ?? balanceOf(own.transition?.currentMortgageBalance) ?? 0;
    const asOf = isMonthKey(own.homeowner?.currentMortgageBalanceAsOf) ? own.homeowner.currentMortgageBalanceAsOf
      : isMonthKey(importedAsOf) ? importedAsOf : monthKey;
    merged = {
      ...merged,
      assets: { ...merged.assets, houseDebt: b },
      ...(merged.homeowner ? { homeowner: { ...merged.homeowner, currentMortgageBalanceAsOf: asOf } } : {}),
    };
  } else {
    // The import carries no balance, so the current one stands, with its own
    // date: an imported slice without the balance must not replace either.
    if (imported.assets && current.assets) merged = { ...merged, assets: { ...merged.assets, houseDebt: current.assets.houseDebt } };
    if (imported.homeowner && merged.homeowner) {
      const { currentMortgageBalanceAsOf: _imported, ...rest } = merged.homeowner;
      const asOf = current.homeowner?.currentMortgageBalanceAsOf;
      merged = { ...merged, homeowner: asOf !== undefined ? { ...rest, currentMortgageBalanceAsOf: asOf } : rest };
    }
  }
  return stampBalanceDate(dropLegacyFields(merged), monthKey);
}
