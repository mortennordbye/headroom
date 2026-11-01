// Per-change revision history: what one save changed, and reverting just that.
//
// A revision records the top-level keys it changed. Its "before" is the blob of
// the revision it was saved on top of. Undoing it is a three-way merge against
// the current blob: a touched value goes back to `before` only if it still
// equals what that save wrote (`after`). If anything changed it since, the undo
// refuses rather than overwrite the newer edit. Arrays of uniquely-id'd rows,
// arrays of plain values (sets like deletedBankIds) and plain objects are merged
// per row / element / field, so undoing one transaction edit survives a later
// bank sync adding other rows. Pure: no DB, no Express — tested in revert.test.js.

const { isMonthKey, migrateMortgageBalance } = require('./mortgageSlices');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isScalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/** Structural equality, independent of object key order. */
function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

/** The top-level keys that differ between two blobs (a missing blob counts as empty). */
function changedKeys(prev, next) {
  const p = isObj(prev) ? prev : {};
  const n = isObj(next) ? next : {};
  return [...new Set([...Object.keys(p), ...Object.keys(n)])].filter((k) => !deepEqual(p[k], n[k]));
}

/** Rows that can be merged by id: objects whose string ids are unique within the array. */
const isIdRows = (v) =>
  Array.isArray(v) && v.every((r) => isObj(r) && typeof r.id === 'string') && new Set(v.map((r) => r.id)).size === v.length;

/** Arrays of distinct scalars, merged as sets. */
const isScalarSet = (v) => Array.isArray(v) && v.every(isScalar) && new Set(v).size === v.length;

/**
 * Three-way revert of one value. Returns { value, absent, conflicts } where
 * `conflicts` lists the paths that changed since the save (empty = clean).
 */
function revertValue(path, current, after, before) {
  if (deepEqual(current, after)) return { value: before, absent: before === undefined, conflicts: [] };
  // The value is gone now but the save left one: something deleted it since.
  // Rebuilding it from a partial merge would resurrect half an object.
  if (current === undefined) return { conflicts: [path] };

  const empty = Array.isArray(current) ? [] : {};
  const aft = after ?? empty;
  const bef = before ?? empty;

  if (isIdRows(current) && isIdRows(aft) && isIdRows(bef)) {
    const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
    const curM = byId(current);
    const aftM = byId(aft);
    const befM = byId(bef);
    const touched = [...new Set([...aftM.keys(), ...befM.keys()])].filter((id) => !deepEqual(aftM.get(id), befM.get(id)));
    const conflicts = touched.filter((id) => !deepEqual(curM.get(id), aftM.get(id))).map((id) => `${path}[${id}]`);
    if (conflicts.length) return { conflicts };
    const touchedSet = new Set(touched);
    const value = current.flatMap((r) => (touchedSet.has(r.id) ? (befM.has(r.id) ? [befM.get(r.id)] : []) : [r]));
    // Rows the save deleted come back at their old position (clamped).
    for (const id of touched) {
      if (befM.has(id) && !curM.has(id)) {
        value.splice(Math.min(bef.findIndex((r) => r.id === id), value.length), 0, befM.get(id));
      }
    }
    return { value, absent: false, conflicts: [] };
  }

  if (isScalarSet(current) && isScalarSet(aft) && isScalarSet(bef)) {
    const aftS = new Set(aft);
    const befS = new Set(bef);
    const curS = new Set(current);
    const added = aft.filter((x) => !befS.has(x));
    const removed = bef.filter((x) => !aftS.has(x));
    const conflicts = [...added.filter((x) => !curS.has(x)), ...removed.filter((x) => curS.has(x))].map((x) => `${path}[${x}]`);
    if (conflicts.length) return { conflicts };
    const addedS = new Set(added);
    return { value: [...current.filter((x) => !addedS.has(x)), ...removed], absent: false, conflicts: [] };
  }

  if (isObj(current) && isObj(aft) && isObj(bef)) {
    const touched = [...new Set([...Object.keys(aft), ...Object.keys(bef)])].filter((k) => !deepEqual(aft[k], bef[k]));
    const conflicts = touched.filter((k) => !deepEqual(current[k], aft[k])).map((k) => `${path}.${k}`);
    if (conflicts.length) return { conflicts };
    const value = { ...current };
    for (const k of touched) {
      if (bef[k] === undefined) delete value[k];
      else value[k] = bef[k];
    }
    return { value, absent: false, conflicts: [] };
  }

  return { conflicts: [path] };
}

/**
 * Revert one revision's change on the current blob. `afterBlob` is the blob as
 * that revision saved it, `beforeBlob` the blob it was saved on top of, `keys`
 * the top-level keys it changed. Returns { blob } on success or { conflicts }
 * (paths changed since) without touching anything.
 */
function revertChange(currentBlob, afterBlob, beforeBlob, keys) {
  // Undo works on revisions as the app shows them: all three blobs go through
  // the load migration of the mortgage balance first (server/mortgageSlices.js).
  // A balance the migration rewrote (old homeowner/transition copies, a drifted
  // Assets copy nobody saw) is then compared as the user saw it, so hidden
  // copies never conflict and undo restores the balance that was shown. Keys
  // the migration alone makes differ (the balance moving into assets) join the
  // change.
  // The balance date the migration stamps on an undated balance is not a user
  // edit, so the stamp is taken back out: a date missing before the revision
  // stays missing (the next load stamps it again), and a date missing in what
  // the revision saved matches whatever date the current blob holds, which is
  // the one the load after that save stamped.
  const stampOf = (b) => (isObj(b.homeowner) ? b.homeowner.currentMortgageBalanceAsOf : undefined);
  const migrate = (raw, stamp) => {
    // The migration reads the slices as objects; leave a malformed blob as it is.
    if (!['assets', 'homeowner', 'transition'].every((k) => raw[k] == null || typeof raw[k] === 'object')) return raw;
    const b = migrateMortgageBalance(raw, 'stamp'); // any stamp it writes is replaced next
    if (!isObj(b.homeowner) || b.homeowner.currentMortgageBalanceAsOf === stamp) return b;
    const { currentMortgageBalanceAsOf: _stamp, ...rest } = b.homeowner;
    return { ...b, homeowner: stamp === undefined ? rest : { ...rest, currentMortgageBalanceAsOf: stamp } };
  };
  const current = migrate(currentBlob, stampOf(currentBlob));
  const before = migrate(beforeBlob, stampOf(beforeBlob));
  const after = migrate(afterBlob, isMonthKey(stampOf(afterBlob)) ? stampOf(afterBlob) : stampOf(currentBlob));
  const allKeys = [...new Set([...keys, ...changedKeys(before, after)])];
  const out = { ...current };
  const conflicts = [];
  for (const k of allKeys) {
    const r = revertValue(k, current[k], after[k], before[k]);
    if (r.conflicts.length) {
      conflicts.push(...r.conflicts);
      continue;
    }
    if (r.absent) delete out[k];
    else out[k] = r.value;
  }
  return conflicts.length ? { conflicts } : { blob: out };
}

module.exports = { deepEqual, changedKeys, revertChange };
