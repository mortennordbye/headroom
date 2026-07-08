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
// them — except in 'zero' mode (array items, balance snapshots), where no such
// merge exists downstream, so unparseable values become 0 instead of leaving an
// `undefined` to NaN-poison unguarded sums. Non-numeric fields pass through
// untouched.
function coerceBySchema(obj: unknown, schema: object, onInvalid: 'drop' | 'zero' = 'drop'): Record<string, unknown> {
  if (!obj || typeof obj !== 'object') return {};
  const out: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
  const schemaRec = schema as Record<string, unknown>;
  for (const key of Object.keys(schema)) {
    if (typeof schemaRec[key] === 'number' && key in out) {
      const c = coerceNumber(out[key]);
      if (c !== undefined) out[key] = c;
      else if (onInvalid === 'drop') delete out[key];
      else out[key] = 0;
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

// Numeric fields of the array-of-objects payload fields, as item schemas
// (same number-marks-numeric convention as `objectSchemas`).
const ARRAY_ITEM_SCHEMAS: Record<string, object> = {
  fixedExpenses: { amount: 0 },
  dailyTransactions: { amount: 0 },
  debts: { balance: 0, rate: 0, minPayment: 0 },
};

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

  for (const [key, schema] of Object.entries(ARRAY_ITEM_SCHEMAS)) {
    if (Array.isArray(out[key])) {
      out[key] = (out[key] as unknown[]).map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? coerceBySchema(item, schema, 'zero')
          : item,
      );
    }
  }

  // Balance snapshots hold nested copies of the schema objects (assets, loan,
  // pension, …), stored and re-applied verbatim — coerce their numeric fields
  // too so an old/hand-edited snapshot can't NaN the composition chart.
  const snaps = out.balanceSnapshots;
  if (snaps && typeof snaps === 'object' && !Array.isArray(snaps)) {
    const cleaned: Record<string, unknown> = {};
    for (const [month, snap] of Object.entries(snaps as Record<string, unknown>)) {
      if (snap && typeof snap === 'object' && !Array.isArray(snap)) {
        const s: Record<string, unknown> = { ...(snap as Record<string, unknown>) };
        for (const [key, schema] of Object.entries(objectSchemas)) {
          if (s[key] && typeof s[key] === 'object' && !Array.isArray(s[key])) {
            s[key] = coerceBySchema(s[key], schema, 'zero');
          }
        }
        // Snapshots also carry the month's non-mortgage debts (an array, so the
        // object-schema loop above skips it) — coerce its items like top-level debts.
        if (Array.isArray(s.debts)) {
          s.debts = (s.debts as unknown[]).map((item) =>
            item && typeof item === 'object' && !Array.isArray(item)
              ? coerceBySchema(item, ARRAY_ITEM_SCHEMAS.debts, 'zero')
              : item,
          );
        }
        cleaned[month] = s;
      } else {
        cleaned[month] = snap;
      }
    }
    out.balanceSnapshots = cleaned;
  }

  return out as T;
}
