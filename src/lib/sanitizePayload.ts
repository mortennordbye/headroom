// Coerce a loaded/imported finance blob so a hand-edited or corrupted value
// (e.g. `assets.portfolio: "5000"` or `NaN`) can't leak into money-math and
// charts, then get auto-saved over good data. Conservative by design: it only
// ever touches fields that are *supposed* to be numeric (identified by a schema
// of defaults), coercing strings→numbers and dropping unparseable ones so the
// caller's `{...DEFAULT, ...data}` merge fills the gap. It never removes or
// rewrites non-numeric data. Pure + unit-tested; applied at the apply boundary.

/** A finite number, or undefined if the value can't be one. */
export function coerceNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed === '') return undefined;
    // Accept a comma decimal and thousands spaces (locale-formatted input).
    const n = Number(trimmed.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// Coerce the numeric-typed fields of `obj` (as marked by `schema`, whose
// number-valued keys define which fields are numeric). Unparseable numeric
// fields are dropped so a downstream `{...default, ...result}` merge restores
// them. Non-numeric fields pass through untouched.
function coerceBySchema(obj: unknown, schema: object): Record<string, unknown> {
  if (!obj || typeof obj !== 'object') return {};
  const out: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
  const schemaRec = schema as Record<string, unknown>;
  for (const key of Object.keys(schema)) {
    if (typeof schemaRec[key] === 'number' && key in out) {
      const c = coerceNumber(out[key]);
      if (c === undefined) delete out[key];
      else out[key] = c;
    }
  }
  return out;
}

// Coerce every value of a `Record<string, number>` (e.g. monthlyIncomes),
// dropping entries whose value can't be a finite number.
function coerceNumberRecord(obj: unknown): Record<string, number> {
  if (!obj || typeof obj !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const c = coerceNumber(v);
    if (c !== undefined) out[k] = c;
  }
  return out;
}

const TOP_LEVEL_NUMERIC = [
  'income', 'savingsTargetPercent', 'growthReturnRate', 'houseGrowthRate',
  'cashGrowthRate', 'cryptoGrowthRate', 'nokToUsd', 'customCurrencyRate',
  'customTaxRatePct',
] as const;

const NUMBER_RECORDS = ['monthlyIncomes', 'netWorthHistory', 'categoryBudgets'] as const;

// Schemas (default objects) for the nested numeric objects, keyed by their
// payload field name. Passed in by the caller so this stays decoupled from the
// context (no import cycle) — only the numeric-typed keys are coerced. `object`
// (not Record) so named interfaces like `Assets` are accepted directly.
export type NumericObjectSchemas = Record<string, object>;

/**
 * Return a sanitized shallow copy of a finance blob. Non-object input is
 * returned as-is (the caller already guards null/first-run).
 */
export function sanitizePayload<T>(data: T, objectSchemas: NumericObjectSchemas): T {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };

  for (const key of TOP_LEVEL_NUMERIC) {
    if (key in out) {
      const c = coerceNumber(out[key]);
      if (c === undefined) delete out[key];
      else out[key] = c;
    }
  }

  for (const [key, schema] of Object.entries(objectSchemas)) {
    if (out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])) {
      out[key] = coerceBySchema(out[key], schema);
    }
  }

  for (const key of NUMBER_RECORDS) {
    if (out[key] && typeof out[key] === 'object') {
      out[key] = coerceNumberRecord(out[key]);
    }
  }

  return out as T;
}
