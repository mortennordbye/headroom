// Declarative payload-field registry (§8.10).
//
// `buildPayload`, `applyPayload`, `getDemoData` and the Settings export used to
// be four hand-synced copies of the same ~44-field list; adding a persisted
// field meant editing every one or it silently dropped from backup/restore
// (CLAUDE.md's documented hazard). This module is the single source of that
// list: one spec per field, carrying the resetMissing group, the demo-mode
// classification, the read (guard + coerce/transform), and the reset default.
//
// Exhaustiveness is compiler-enforced: the registry, the setter map and the
// built payload are all typed over `PersistedKey`, so a newly-added
// `ExportPayload` field FAILS TO COMPILE until it is registered everywhere.
//
// Pure and React-free on purpose (CLAUDE.md "pure logic in src/lib with tests"):
// FinanceContext binds the React state setters to the keys, and the round-trip
// tests exercise this module directly.
import type { ExportPayload } from '../context/FinanceContext';
import { DEFAULT_EMPLOYER_COST_CONFIG, DEFAULT_BILLING_CONFIG } from './employerCost';
import { DEFAULT_FORECAST_ASSUMPTIONS } from './forecastProjection';
import { dedupeBankTransactions } from './bankDedup';
import { migrateSavingsAccounts, migrateSnapshotSavings } from './savingsMigration';

// Every persisted field. `currentMonth` is view state — added by the callers
// that need it, never built here — so it is the one `ExportPayload` key excluded.
export type PersistedKey = Exclude<keyof ExportPayload, 'currentMonth'>;

// State values are never `undefined` (each has a concrete default), so a field's
// applied value is the non-nullable form of its payload type.
type FieldValue<K extends PersistedKey> = NonNullable<ExportPayload[K]>;

// Sentinel returned by a read when the field isn't meaningfully present in the
// blob (distinct from a legitimately-falsy value like `0` or `''`).
export const ABSENT: unique symbol = Symbol('payload-absent');
export type Absent = typeof ABSENT;

// resetMissing behaviour. 'reset' fields drop to their `default` when absent on
// load (state is fresh); 'preserve' fields are only ever applied when present,
// never reset — the sole difference between the load and import callers.
export type FieldGroup = 'reset' | 'preserve';

// Demo-mode contract (finding 2.5): 'personal' fields MUST be set by getDemoData
// so no real value leaks into a demo; 'preference' fields are deliberately left
// as the presenter's (language, currency, region, nav, dismissed nudges).
export type DemoClass = 'personal' | 'preference';

export type FieldRead<K extends PersistedKey> = (data: Partial<ExportPayload>) => FieldValue<K> | Absent;

export interface FieldSpec<K extends PersistedKey = PersistedKey> {
  group: FieldGroup;
  demo: DemoClass;
  read: FieldRead<K>;
  /** Applied when a 'reset' field is absent on load. Unused for 'preserve'. */
  default?: FieldValue<K>;
}

export type PayloadRegistry = { [K in PersistedKey]: FieldSpec<K> };
export type PayloadSetters = { [K in PersistedKey]: (value: FieldValue<K>) => void };
/** A fully-populated snapshot of every persisted field (what buildPayload emits). */
export type BuiltPayload = { [K in PersistedKey]: FieldValue<K> };

// ── Read combinators (pure, unit-tested) ────────────────────────────────────
// Each mirrors exactly one guard shape from the old applyPayload if-chain.

/** `data.x !== undefined` */
export const whenDefined = <K extends PersistedKey>(key: K): FieldRead<K> =>
  (data) => { const v = data[key]; return v === undefined ? ABSENT : (v as FieldValue<K>); };

/** `if (data.x)` — truthy. Note arrays (incl. empty `[]`) are truthy, matching the original. */
export const whenTruthy = <K extends PersistedKey>(key: K): FieldRead<K> =>
  (data) => { const v = data[key]; return v ? (v as FieldValue<K>) : ABSENT; };

/** `typeof data.x === 'boolean'` */
export const whenBoolean = <K extends PersistedKey>(key: K): FieldRead<K> =>
  (data) => { const v = data[key]; return typeof v === 'boolean' ? (v as FieldValue<K>) : ABSENT; };

/** `typeof data.x === 'string'` */
export const whenString = <K extends PersistedKey>(key: K): FieldRead<K> =>
  (data) => { const v = data[key]; return typeof v === 'string' ? (v as FieldValue<K>) : ABSENT; };

/** `typeof data.x === 'number'` */
export const whenNumber = <K extends PersistedKey>(key: K): FieldRead<K> =>
  (data) => { const v = data[key]; return typeof v === 'number' ? (v as FieldValue<K>) : ABSENT; };

/** `Array.isArray(data.x)` */
export const whenArray = <K extends PersistedKey>(key: K): FieldRead<K> =>
  (data) => { const v = data[key]; return Array.isArray(v) ? (v as FieldValue<K>) : ABSENT; };

/** `data.x === a || data.x === b` — a small allow-list (region). */
export const whenOneOf = <K extends PersistedKey>(key: K, allowed: readonly FieldValue<K>[]): FieldRead<K> =>
  (data) => { const v = data[key]; return allowed.includes(v as FieldValue<K>) ? (v as FieldValue<K>) : ABSENT; };

/** `if (data.x) set({ ...DEFAULT, ...data.x })` — truthy guard, merge over a default. */
export const mergedWith = <K extends PersistedKey>(key: K, base: FieldValue<K>): FieldRead<K> =>
  (data) => { const v = data[key]; return v ? ({ ...(base as object), ...(v as object) } as FieldValue<K>) : ABSENT; };

// The object defaults live in FinanceContext (also imported by pages and used as
// sanitize schemas), so they are injected rather than moved — keeping this module
// free of any value import from the context (no import cycle).
export interface PayloadDefaults {
  assets: FieldValue<'assets'>;
  loan: FieldValue<'loan'>;
  pension: FieldValue<'pension'>;
  homeowner: FieldValue<'homeowner'>;
  transition: FieldValue<'transition'>;
  fixedExpenses: FieldValue<'fixedExpenses'>;
}

/**
 * Build the field registry. Every read/default/group/demo here reproduces the
 * corresponding line of the original applyPayload/buildPayload verbatim; the
 * `{ [K in PersistedKey]: FieldSpec<K> }` return type is what makes the list
 * exhaustive at compile time.
 */
export function makePayloadRegistry(d: PayloadDefaults): PayloadRegistry {
  return {
    // ── Group A: default-on-absent (load) / leave-on-absent (import) ──
    income: { group: 'reset', demo: 'personal', read: whenDefined('income'), default: 55000 },
    monthlyIncomes: { group: 'reset', demo: 'personal', read: whenDefined('monthlyIncomes'), default: {} },
    payslips: { group: 'reset', demo: 'personal', read: whenDefined('payslips'), default: {} },
    netWorthHistory: { group: 'reset', demo: 'personal', read: whenDefined('netWorthHistory'), default: {} },
    balanceSnapshots: {
      group: 'reset', demo: 'personal', default: {},
      read: (data) => (data.balanceSnapshots !== undefined ? migrateSnapshotSavings(data.balanceSnapshots) : ABSENT),
    },
    fixedExpenses: { group: 'reset', demo: 'personal', read: whenTruthy('fixedExpenses'), default: d.fixedExpenses },
    dailyTransactions: {
      group: 'reset', demo: 'personal', default: [],
      read: (data) => (data.dailyTransactions ? dedupeBankTransactions(data.dailyTransactions) : ABSENT),
    },
    deletedBankIds: { group: 'reset', demo: 'preference', read: whenDefined('deletedBankIds'), default: [] },
    accountLabels: { group: 'reset', demo: 'personal', read: whenDefined('accountLabels'), default: {} },
    categoryRules: { group: 'reset', demo: 'personal', read: whenDefined('categoryRules'), default: [] },
    labelRules: { group: 'reset', demo: 'personal', read: whenDefined('labelRules'), default: [] },
    categoryBudgets: { group: 'reset', demo: 'personal', read: whenDefined('categoryBudgets'), default: {} },
    debts: { group: 'reset', demo: 'personal', read: whenTruthy('debts'), default: [] },
    assets: {
      group: 'reset', demo: 'personal', default: d.assets,
      read: (data) => {
        const a = data.assets;
        return a ? { ...d.assets, ...a, savings: 0, savingsAccounts: migrateSavingsAccounts(a) } : ABSENT;
      },
    },
    loan: { group: 'reset', demo: 'personal', read: whenTruthy('loan'), default: d.loan },
    pension: { group: 'reset', demo: 'personal', read: mergedWith('pension', d.pension), default: d.pension },
    recurringTemplates: { group: 'reset', demo: 'personal', read: whenDefined('recurringTemplates'), default: [] },
    housingMode: { group: 'reset', demo: 'personal', read: whenDefined('housingMode'), default: 'first_buyer' },
    homeowner: { group: 'reset', demo: 'personal', read: mergedWith('homeowner', d.homeowner), default: d.homeowner },
    transition: { group: 'reset', demo: 'personal', read: mergedWith('transition', d.transition), default: d.transition },
    employerCostConfig: {
      group: 'reset', demo: 'personal', default: DEFAULT_EMPLOYER_COST_CONFIG,
      read: mergedWith('employerCostConfig', DEFAULT_EMPLOYER_COST_CONFIG),
    },
    billingConfig: {
      group: 'reset', demo: 'personal', default: DEFAULT_BILLING_CONFIG,
      read: mergedWith('billingConfig', DEFAULT_BILLING_CONFIG),
    },
    // Legacy blobs pre-date this flag — absent → treated as onboarded (true) on
    // load so existing users never re-trigger the first-run tour.
    onboardingCompleted: { group: 'reset', demo: 'preference', read: whenBoolean('onboardingCompleted'), default: true },
    assumptionsNudgeDismissed: { group: 'reset', demo: 'preference', read: whenBoolean('assumptionsNudgeDismissed'), default: false },
    incomeReminderDismissedMonth: { group: 'reset', demo: 'preference', read: whenString('incomeReminderDismissedMonth'), default: '' },
    conservativeNudgeDismissedMonth: { group: 'reset', demo: 'preference', read: whenString('conservativeNudgeDismissedMonth'), default: '' },
    payday: { group: 'reset', demo: 'preference', read: whenNumber('payday'), default: 0 },

    // ── Group B: apply only when present (identical on load + import) ──
    lang: { group: 'preserve', demo: 'preference', read: whenTruthy('lang') },
    savingsTargetPercent: { group: 'preserve', demo: 'personal', read: whenDefined('savingsTargetPercent') },
    growthReturnRate: { group: 'preserve', demo: 'preference', read: whenDefined('growthReturnRate') },
    forecastAssumptions: { group: 'preserve', demo: 'preference', read: mergedWith('forecastAssumptions', DEFAULT_FORECAST_ASSUMPTIONS) },
    houseGrowthRate: { group: 'preserve', demo: 'preference', read: whenDefined('houseGrowthRate') },
    cashGrowthRate: { group: 'preserve', demo: 'preference', read: whenDefined('cashGrowthRate') },
    cryptoGrowthRate: { group: 'preserve', demo: 'preference', read: whenDefined('cryptoGrowthRate') },
    displayCurrency: { group: 'preserve', demo: 'preference', read: whenTruthy('displayCurrency') },
    nokToUsd: { group: 'preserve', demo: 'preference', read: whenDefined('nokToUsd') },
    customCurrencyCode: { group: 'preserve', demo: 'preference', read: whenDefined('customCurrencyCode') },
    customCurrencyRate: { group: 'preserve', demo: 'preference', read: whenDefined('customCurrencyRate') },
    jobs: { group: 'preserve', demo: 'personal', read: whenArray('jobs') },
    salaries: { group: 'preserve', demo: 'personal', read: whenArray('salaries') },
    bonuses: { group: 'preserve', demo: 'personal', read: whenArray('bonuses') },
    overtime: { group: 'preserve', demo: 'personal', read: whenArray('overtime') },
    hoursSnapshots: { group: 'preserve', demo: 'personal', read: whenArray('hoursSnapshots') },
    goals: { group: 'preserve', demo: 'personal', read: whenArray('goals') },
    region: { group: 'preserve', demo: 'preference', read: whenOneOf('region', ['no', 'generic']) },
    customTaxRatePct: { group: 'preserve', demo: 'preference', read: whenNumber('customTaxRatePct') },
    hiddenNavItems: { group: 'preserve', demo: 'preference', read: whenArray('hiddenNavItems') },
  };
}

/** The persisted-field key list, derived from a registry (single source). */
export function persistedKeys(registry: PayloadRegistry): PersistedKey[] {
  return Object.keys(registry) as PersistedKey[];
}

// Apply one field: set the read value if present, else reset a 'reset' field to
// its default when the caller asked (load). Type-erased on purpose — per-field
// types are checked where the registry and setters are defined; the loop can't
// re-correlate the K across the two maps.
function applyOne(spec: FieldSpec, set: (v: unknown) => void, data: Partial<ExportPayload>, resetMissing: boolean): void {
  const v = spec.read(data);
  if (v !== ABSENT) set(v);
  else if (resetMissing && spec.group === 'reset') set(spec.default);
}

/**
 * Apply a sanitized blob to the bound setters. `resetMissing` true = load (fresh
 * state, absent 'reset' fields drop to default); false = import/demo (absent
 * fields keep their current value). This is the whole of applyPayload's body.
 */
export function applyPersistedFields(
  registry: PayloadRegistry,
  setters: PayloadSetters,
  data: Partial<ExportPayload>,
  resetMissing: boolean,
): void {
  for (const key of persistedKeys(registry)) {
    applyOne(registry[key], setters[key] as (v: unknown) => void, data, resetMissing);
  }
}

/** Project a full state snapshot to the persisted payload (buildPayload's core). */
export function derivePayload(registry: PayloadRegistry, values: BuiltPayload): ExportPayload {
  const out = {} as Record<PersistedKey, unknown>;
  for (const key of persistedKeys(registry)) out[key] = values[key];
  return out as ExportPayload;
}
