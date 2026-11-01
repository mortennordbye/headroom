import type { Assets, BalanceSnapshot, CoOwner } from '../context/FinanceContext';
import { addMonthsKey, currentMonthKey } from './date';
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

/**
 * The co-owner list after the user answers "you own `sharePct` % of the home"
 * in `month` (the onboarding question). History stays as it was:
 * - No current co-owner: one is added holding the rest, owning since the
 *   move-in month (`moveIn`, as the Bolig page does) or `month` when there is
 *   none or it is later, and never before the month after a past co-owner's
 *   last month.
 * - One current co-owner added this month: their row is edited in place, or
 *   removed at 100 %.
 * - One current co-owner from an earlier month: a changed share ends their row
 *   last month and adds a row from `month` with the new share (none at 100 %),
 *   so the months before keep the old split.
 * The same share returns `list` itself. More than one current co-owner, one
 * with a last month set, a non-finite share, or a result that fails
 * `validateCoOwners` gives null: that is edited on the Bolig page.
 */
export function withOwnershipShare(
  list: CoOwner[], sharePct: number, month: string, newRow: Pick<CoOwner, 'id' | 'name'>, moveIn?: string,
): CoOwner[] | null {
  if (!Number.isFinite(sharePct)) return null;
  const others = 100 - Math.min(100, Math.max(0, sharePct));
  const active = activeCoOwners(list, month);
  if (active.length > 1 || active[0]?.until) return null;
  const c = active[0];
  let next: CoOwner[];
  if (!c) {
    // Never earlier than the month after a past co-owner left, or their months would be rewritten.
    const afterLeft = list.flatMap(x => (isMonthKey(x.until) && x.until < month ? [addMonthsKey(x.until, 1)] : []));
    const since = [isMonthKey(moveIn) && moveIn <= month ? moveIn : month, ...afterLeft]
      .reduce((a, b) => (b > a ? b : a));
    next = others > 0 ? [...list, { ...newRow, ownershipPct: others, since }] : list;
  } else if (c.ownershipPct === others) {
    next = list;
  } else if (c.since === month) {
    next = others > 0 ? list.map(x => (x === c ? { ...c, ownershipPct: others } : x)) : list.filter(x => x !== c);
  } else {
    // `c` has no until (checked above); the new row keeps their name and loan share.
    const ended = list.map(x => (x === c ? { ...c, until: addMonthsKey(month, -1) } : x));
    next = others > 0 ? [...ended, { ...c, id: newRow.id, ownershipPct: others, since: month }] : ended;
  }
  return validateCoOwners(next).ok ? next : null;
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
  const rows = raw.filter(r => r && typeof r === 'object') as Record<string, unknown>[];
  const taken = new Set(rows.map(c => c.id).filter((id): id is string => typeof id === 'string' && id !== ''));
  // Deterministic, so an id-less row doesn't get a new id (and a re-save) on every load.
  const freshId = (i: number): string => {
    let id = `coo-${i + 1}`;
    while (taken.has(id)) id += '-x';
    taken.add(id);
    return id;
  };
  return rows.map((c, i): CoOwner => {
    const out: CoOwner = {
      id: typeof c.id === 'string' && c.id ? c.id : freshId(i),
      name: typeof c.name === 'string' ? c.name : '',
      ownershipPct: coerceNumber(c.ownershipPct) ?? 0,
    };
    // null/absent = follows ownership.
    if (c.debtSharePct != null) out.debtSharePct = coerceNumber(c.debtSharePct) ?? 0;
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
