// The load migration of the mortgage balance, for the revision undo
// (server/revert.js), which compares revisions as the app shows them.
//
// TWIN: `migrateMortgageBalance` in src/lib/mortgageSlices.ts (TS/ESM), with
// the helpers it uses (and `coerceNumber` from src/lib/sanitizePayload.ts), is
// an equivalent copy of this logic. This CJS server can't import from src/, so
// the two are hand-maintained and MUST stay identical: change both or neither.
// persistedShape.property.test.ts checks they agree on random legacy blobs.

const PLACEHOLDER_MORTGAGE_BALANCE = 3_000_000;
const HOUSING_MODES = ['first_buyer', 'homeowner', 'transitioning'];

function coerceNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed === '') return undefined;
    const n = Number(trimmed.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

const validHousingMode = (v) => (HOUSING_MODES.includes(v) ? v : undefined);
const isMonthKey = (v) => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const balanceOf = (v) => {
  const n = coerceNumber(v);
  return n !== undefined && Number.isFinite(n) ? Math.max(0, n) : undefined;
};
const isReal = (b) => b !== undefined && b > 0 && b !== PLACEHOLDER_MORTGAGE_BALANCE;

function reconcileLegacy(data, monthKey) {
  const mode = validHousingMode(data.housingMode) ?? 'first_buyer';
  const { assets: a, homeowner: h, transition: tr } = data;
  const stamped = isMonthKey(h?.currentMortgageBalanceAsOf);

  const hb = balanceOf(h?.currentMortgageBalance);
  const tb = balanceOf(tr?.currentMortgageBalance);
  const ab = balanceOf(a?.houseDebt);

  let balance;
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

const isOwnerMode = (m) => m === 'homeowner' || m === 'transitioning';

const hasLegacyFields = (d) =>
  (d.homeowner != null && 'currentMortgageBalance' in d.homeowner)
  || (d.transition != null && 'currentMortgageBalance' in d.transition);

function dropLegacyFields(data) {
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

function stampBalanceDate(data, monthKey) {
  const h = data.homeowner;
  if (h == null || !isOwnerMode(validHousingMode(data.housingMode)) || isMonthKey(h.currentMortgageBalanceAsOf)) return data;
  return { ...data, homeowner: { ...h, currentMortgageBalanceAsOf: monthKey } };
}

/** Bring a blob to the one-field shape, as the app does on load. Idempotent;
 *  returns `data` itself when nothing needs changing. */
function migrateMortgageBalance(data, monthKey) {
  if (!hasLegacyFields(data)) return stampBalanceDate(data, monthKey);
  let r = reconcileLegacy(data, monthKey);
  if (r.assets == null && isOwnerMode(validHousingMode(r.housingMode))) {
    const b = balanceOf(r.homeowner?.currentMortgageBalance) ?? balanceOf(r.transition?.currentMortgageBalance);
    if (b !== undefined && b > 0) r = { ...r, assets: { houseDebt: b } };
  }
  return stampBalanceDate(dropLegacyFields(r), monthKey);
}

module.exports = { isMonthKey, migrateMortgageBalance };
