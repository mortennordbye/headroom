// Per-change revision history: what one save changed, and reverting just that.
//
// A revision records the top-level keys it changed and their values before the
// save. Undoing it is a three-way merge against the current blob: a touched value
// goes back to `before` only if it still equals what that save wrote (`after`).
// If anything changed it since, the undo refuses rather than overwrite the newer
// edit. Arrays of `{ id }` rows and plain objects are merged per row / per field,
// so undoing one transaction edit survives a later bank sync adding other rows.
// Pure: no DB, no Express — tested in revert.test.js.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Structural equality, independent of object key order. */
function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => has(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

/**
 * The top-level keys that differ between two blobs, with each key's value before
 * the change. A key absent before is listed in `keys` but has no `before` entry.
 */
function diffBlobs(prev, next) {
  const p = isObj(prev) ? prev : {};
  const n = isObj(next) ? next : {};
  const keys = [];
  const before = {};
  for (const k of new Set([...Object.keys(p), ...Object.keys(n)])) {
    if (deepEqual(p[k], n[k])) continue;
    keys.push(k);
    if (p[k] !== undefined) before[k] = p[k];
  }
  return { keys, before };
}

/**
 * Fold a newer change into an older one (coalescing back-to-back saves): the keys
 * are the union, and each key's `before` is the earliest one seen.
 */
function mergeChanges(older, newer) {
  const keys = [...new Set([...older.keys, ...newer.keys])];
  const before = {};
  for (const k of keys) {
    const src = older.keys.includes(k) ? older.before : newer.before;
    if (has(src, k)) before[k] = src[k];
  }
  return { keys, before };
}

const isIdRows = (v) => Array.isArray(v) && v.every((r) => isObj(r) && typeof r.id === 'string');

/**
 * Three-way revert of one value. Returns { value, absent, conflicts } where
 * `conflicts` lists the paths that changed since the save (empty = clean).
 */
function revertValue(path, current, after, before) {
  if (deepEqual(current, after)) return { value: before, absent: before === undefined, conflicts: [] };

  const cur = current ?? (Array.isArray(after) || Array.isArray(before) ? [] : undefined);
  const aft = after ?? (Array.isArray(cur) ? [] : undefined);
  const bef = before ?? (Array.isArray(cur) ? [] : undefined);

  if (isIdRows(cur) && isIdRows(aft) && isIdRows(bef)) {
    const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
    const curM = byId(cur);
    const aftM = byId(aft);
    const befM = byId(bef);
    const touched = [...new Set([...aftM.keys(), ...befM.keys()])].filter((id) => !deepEqual(aftM.get(id), befM.get(id)));
    const conflicts = touched.filter((id) => !deepEqual(curM.get(id), aftM.get(id))).map((id) => `${path}[${id}]`);
    if (conflicts.length) return { conflicts };
    const touchedSet = new Set(touched);
    const value = cur.flatMap((r) => (touchedSet.has(r.id) ? (befM.has(r.id) ? [befM.get(r.id)] : []) : [r]));
    // Rows the save deleted come back at their old position (clamped).
    for (const id of touched) {
      if (befM.has(id) && !curM.has(id)) {
        const at = Math.min(bef.findIndex((r) => r.id === id), value.length);
        value.splice(at, 0, befM.get(id));
      }
    }
    return { value, absent: false, conflicts: [] };
  }

  if ((isObj(cur) || cur === undefined) && (isObj(aft) || aft === undefined) && (isObj(bef) || bef === undefined)
    && (isObj(cur) || isObj(aft) || isObj(bef))) {
    const c = cur ?? {};
    const a = aft ?? {};
    const b = bef ?? {};
    const touched = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !deepEqual(a[k], b[k]));
    const conflicts = touched.filter((k) => !deepEqual(c[k], a[k])).map((k) => `${path}.${k}`);
    if (conflicts.length) return { conflicts };
    const value = { ...c };
    for (const k of touched) {
      if (b[k] === undefined) delete value[k];
      else value[k] = b[k];
    }
    return { value, absent: false, conflicts: [] };
  }

  return { conflicts: [path] };
}

/**
 * Revert one revision's change on the current blob. `afterBlob` is the blob as
 * that revision saved it; `change` is its { keys, before }. Returns
 * { blob } on success or { conflicts } (paths changed since) without touching
 * anything.
 */
function revertChange(currentBlob, afterBlob, change) {
  const out = { ...currentBlob };
  const conflicts = [];
  for (const k of change.keys) {
    const r = revertValue(k, currentBlob[k], afterBlob[k], has(change.before, k) ? change.before[k] : undefined);
    if (r.conflicts.length) {
      conflicts.push(...r.conflicts);
      continue;
    }
    if (r.absent) delete out[k];
    else out[k] = r.value;
  }
  return conflicts.length ? { conflicts } : { blob: out };
}

module.exports = { deepEqual, diffBlobs, mergeChanges, revertChange };
