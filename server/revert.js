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
  // The mortgage balance is stored once, in assets.houseDebt; the homeowner and
  // transition copies older saves held are dropped on load. Once the current
  // blob has dropped a copy, the copy is left out of the merge on both sides of
  // the revision: undoing the save that dropped it must not bring back a stale
  // balance (which would win over houseDebt on the next load), and undoing an
  // older revision must not report the missing copy as a conflict. Those older
  // revisions changed houseDebt along with the copies, so their undo restores
  // the balance through assets.
  // A revision that changed a copy while houseDebt stayed put (drifted old
  // data) can't be undone through assets, so it is refused rather than
  // reported as undone with the balance left as it is.
  const after = { ...afterBlob };
  const before = { ...beforeBlob };
  const unrepresentable = [];
  const debtOf = (b) => (isObj(b.assets) ? b.assets.houseDebt : undefined);
  for (const slice of ['homeowner', 'transition']) {
    const cur = currentBlob[slice];
    if (!isObj(cur) || 'currentMortgageBalance' in cur) continue;
    const a = isObj(after[slice]) ? after[slice] : undefined;
    const bf = isObj(before[slice]) ? before[slice] : undefined;
    if (a && bf && 'currentMortgageBalance' in a && 'currentMortgageBalance' in bf
      && !deepEqual(a.currentMortgageBalance, bf.currentMortgageBalance) && deepEqual(debtOf(after), debtOf(before))) {
      unrepresentable.push(`${slice}.currentMortgageBalance`);
    }
    for (const side of [after, before]) {
      if (isObj(side[slice]) && 'currentMortgageBalance' in side[slice]) {
        const { currentMortgageBalance: _legacy, ...rest } = side[slice];
        side[slice] = rest;
      }
    }
  }
  if (unrepresentable.length) return { conflicts: unrepresentable };
  const out = { ...currentBlob };
  const conflicts = [];
  for (const k of keys) {
    const r = revertValue(k, currentBlob[k], after[k], before[k]);
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
