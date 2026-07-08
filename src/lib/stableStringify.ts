// Deterministic JSON: object keys are sorted recursively, so two structurally
// equal values stringify identically regardless of key insertion order (a
// loaded blob and a freshly built payload rarely share key order). Used to
// detect "nothing actually changed" before autosaving — a false mismatch only
// costs one redundant save, never data.
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const rec = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(rec).sort()) {
      // Match JSON.stringify semantics: undefined-valued keys are dropped.
      if (rec[k] !== undefined) out[k] = sortValue(rec[k]);
    }
    return out;
  }
  return v;
}
