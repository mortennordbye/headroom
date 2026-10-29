import type { Assets, BalanceSnapshot, CoOwner } from '../context/FinanceContext';
import { currentMonthKey } from './date';
import { makeId } from './savingsMigration';
import { TAX_YEAR, WEALTH_TAX_PARAMS } from './norwegianTax';
import { coerceNumber } from './sanitizePayload';

// Co-owned home. `assets.houseValue` / `houseDebt` always hold the whole property
// and the whole joint loan, as the bank shows them; the user's share is derived
// here: mine = 100 % minus the co-owners active that month. Stored data and the
// helpers that move raw balances (snapshots, automation, projections) stay full;
// only personal figures (net worth, wealth tax, rentefradrag) are scaled.

const isMonthKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const pct = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Co-owners in force at `month`. Rows without since/until (snapshot rows) always count. */
export function activeCoOwners(list: unknown, month: string = currentMonthKey()): CoOwner[] {
  if (!Array.isArray(list)) return [];
  return list.filter((c): c is CoOwner => {
    if (!c || typeof c !== 'object') return false;
    const { since, until } = c as CoOwner;
    if (isMonthKey(since) && month < since) return false;
    if (isMonthKey(until) && month > until) return false;
    return true;
  });
}

const debtPct = (c: CoOwner): number =>
  typeof c.debtSharePct === 'number' && Number.isFinite(c.debtSharePct) ? c.debtSharePct : pct(c.ownershipPct);

/** The user's share of the property (`own`) and of the joint loan (`debt`), as fractions 0..1. */
export function ownershipShares(a: Pick<Assets, 'coOwners'> | null | undefined, month?: string): { own: number; debt: number } {
  const others = activeCoOwners(a?.coOwners, month);
  const sumOwn = others.reduce((s, c) => s + pct(c.ownershipPct), 0);
  const sumDebt = others.reduce((s, c) => s + debtPct(c), 0);
  return { own: clamp01(1 - sumOwn / 100), debt: clamp01(1 - sumDebt / 100) };
}

export function myHouseValue(a: Pick<Assets, 'coOwners' | 'houseValue'>, month?: string): number {
  return pct(a.houseValue) * ownershipShares(a, month).own;
}

export function myHouseDebt(a: Pick<Assets, 'coOwners' | 'houseDebt'>, month?: string): number {
  return pct(a.houseDebt) * ownershipShares(a, month).debt;
}

/**
 * The market value to hand `calcWealthTax` as `primaryHomeValue` for an `own`
 * share of a primary home worth `fullValue`. The 70 % rule's threshold is tested
 * against the whole property, then the valued amount is split by share: 16 MNOK
 * at 50 % gives (10 M × 0.25 × 0.5) + (6 M × 0.7 × 0.5) = 3 350 000, not the
 * 2 000 000 that valuing an 8 M share on its own would give.
 * Source: Skatte-ABC 2025/2026, B-11-2.7.1 "Boliger med færre enn fem boenheter"
 * (skatteetaten.no/rettskilder/type/handboker/skatte-abc/gjeldende/b-11-bolig--formue/B-11.002/B-11.012/):
 * "Vurderingen av om boligen har så høy verdi at 70 %-regelen skal benyttes,
 * gjøres imidlertid med utgangspunkt i hele eiendommens omsetningsverdi."
 * calcWealthTax only takes a market value, so this returns the value v with
 * valued(v) = own × valued(fullValue).
 */
export function primaryHomeWealthValue(fullValue: number, own: number, year: number = TAX_YEAR): number {
  const P = WEALTH_TAX_PARAMS[year] ?? WEALTH_TAX_PARAMS[TAX_YEAR];
  const v = Math.max(0, pct(fullValue));
  const share = clamp01(pct(own));
  if (share === 1) return v;
  const low = P.primaryHomeHighThreshold * P.primaryHomeRate;
  const valued = v <= P.primaryHomeHighThreshold
    ? v * P.primaryHomeRate
    : low + (v - P.primaryHomeHighThreshold) * P.primaryHomeHighRate;
  const target = valued * share;
  return target <= low
    ? target / P.primaryHomeRate
    : P.primaryHomeHighThreshold + (target - low) / P.primaryHomeHighRate;
}

/** Same, from the user's share of the market value (`own × fullValue`), for
 *  projections that only carry the scaled amount. */
export function primaryHomeWealthValueOfShare(myValue: number, own: number, year?: number): number {
  const share = clamp01(pct(own));
  return share > 0 ? primaryHomeWealthValue(pct(myValue) / share, share, year) : 0;
}

export function myPrimaryHomeWealthValue(a: Pick<Assets, 'coOwners' | 'houseValue'>, month?: string): number {
  return primaryHomeWealthValue(a.houseValue, ownershipShares(a, month).own);
}

/** The user's part of a co-owned home's sale: the proceeds before the loan are
 *  split by ownership, the loan by debt share. `netProceeds` is the whole
 *  property's (sale price − costs − whole loan). */
export function mySaleProceeds(netProceeds: number, mortgageBalance: number, s: { own: number; debt: number }): number {
  return (pct(netProceeds) + pct(mortgageBalance)) * s.own - pct(mortgageBalance) * s.debt;
}

export type CoOwnerError = 'range' | 'sumOwnership' | 'sumDebt' | 'dates';

/** Each pct 0-100, valid months with since <= until, and at no month do the
 *  co-owners together hold more than 100 % of the property or the loan. */
export function validateCoOwners(list: CoOwner[]): { ok: true } | { ok: false; error: CoOwnerError } {
  const inRange = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
  for (const c of list) {
    if (!inRange(c.ownershipPct) || (c.debtSharePct !== undefined && !inRange(c.debtSharePct))) {
      return { ok: false, error: 'range' };
    }
    if ((c.since !== undefined && !isMonthKey(c.since)) || (c.until !== undefined && !isMonthKey(c.until))
      || (c.since && c.until && c.since > c.until)) {
      return { ok: false, error: 'dates' };
    }
  }
  // The active set only grows at a `since`, so the peak is at one of them (or
  // before any, for rows without a since).
  const months = ['0000-01', ...list.flatMap(c => (c.since ? [c.since] : []))];
  for (const m of months) {
    const active = activeCoOwners(list, m);
    if (active.reduce((s, c) => s + c.ownershipPct, 0) > 100) return { ok: false, error: 'sumOwnership' };
    if (active.reduce((s, c) => s + debtPct(c), 0) > 100) return { ok: false, error: 'sumDebt' };
  }
  return { ok: true };
}

/** The co-owners to store in `month`'s snapshot: rows active then, dates stripped. */
export function snapshotCoOwners(list: unknown, month: string): CoOwner[] {
  return activeCoOwners(list, month).map(({ since: _s, until: _u, ...rest }) => rest);
}

/**
 * Write the live list into every stored snapshot ("owned since": the share
 * applies from `since`, so history shows no fake drop when a co-owner is added
 * late). Snapshots that had no co-owners and still have none are left as stored.
 */
export function rewriteSnapshotCoOwners(
  snaps: Record<string, BalanceSnapshot>, list: CoOwner[],
): Record<string, BalanceSnapshot> {
  const out: Record<string, BalanceSnapshot> = {};
  for (const [month, snap] of Object.entries(snaps)) {
    if (!snap?.assets) { out[month] = snap; continue; }
    const rows = snapshotCoOwners(list, month);
    const had = Array.isArray(snap.assets.coOwners) && snap.assets.coOwners.length > 0;
    out[month] = rows.length === 0 && !had ? snap : { ...snap, assets: { ...snap.assets, coOwners: rows } };
  }
  return out;
}

/** Clean an imported/loaded list: non-array → [], numerics coerced (unparseable
 *  → 0), bad months dropped, a missing id generated rather than the row dropped. */
export function sanitizeCoOwners(raw: unknown): CoOwner[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(r => r && typeof r === 'object').map((r): CoOwner => {
    const c = r as Record<string, unknown>;
    const out: CoOwner = {
      id: typeof c.id === 'string' && c.id ? c.id : makeId('coo'),
      name: typeof c.name === 'string' ? c.name : '',
      ownershipPct: coerceNumber(c.ownershipPct) ?? 0,
    };
    if (c.debtSharePct !== undefined) out.debtSharePct = coerceNumber(c.debtSharePct) ?? 0;
    if (isMonthKey(c.since)) out.since = c.since;
    if (isMonthKey(c.until)) out.until = c.until;
    return out;
  });
}

/** Sanitize `assets.coOwners` in every stored snapshot that carries the key;
 *  snapshots without it come back as stored. */
export function sanitizeSnapshotCoOwners(snaps: Record<string, BalanceSnapshot>): Record<string, BalanceSnapshot> {
  let changed = false;
  const out: Record<string, BalanceSnapshot> = {};
  for (const [month, snap] of Object.entries(snaps)) {
    if (snap?.assets && snap.assets.coOwners !== undefined) {
      changed = true;
      out[month] = { ...snap, assets: { ...snap.assets, coOwners: sanitizeCoOwners(snap.assets.coOwners) } };
    } else {
      out[month] = snap;
    }
  }
  return changed ? out : snaps;
}
