// Test-only helpers: replay what the client and server do with a stored blob
// (load, autosave, undo, restore, import), without React or a database. Each
// mirrors the production path line for line, so the round-trip tests exercise
// the same functions in the same order:
//  • load:    FinanceContext applyPayload(raw, true) → registry state → autosave
//  • import:  applyPayload(raw, false, current) over the loaded state
//  • undo:    server POST /api/history/:rev/undo (changedKeys + revertChange)
//  • restore: server POST /api/history/:rev/restore writes the old blob as is
// Every saved blob goes through JSON, as the server stores it.
import { changedKeys, revertChange } from '../../server/revert.js';
import type {
  Assets, ExportPayload, HomeownerData, LoanData, Pension, TransitionData,
} from '../context/FinanceContext';
import { DEFAULT_BILLING_CONFIG, DEFAULT_EMPLOYER_COST_CONFIG } from './employerCost';
import { currentMortgage } from './existingMortgage';
import { stampLegacyTerm } from './loanTerm';
import { migrateImportedMortgage, migrateMortgageBalance } from './mortgageSlices';
import {
  applyPersistedFields, derivePayload, makePayloadRegistry, persistedKeys,
  type BuiltPayload, type PayloadSetters,
} from './payloadRegistry';
import { sanitizePayload } from './sanitizePayload';

export type Blob = Record<string, unknown>;

/** The month every helper treats as "now", so stamps are deterministic. */
export const NOW = '2026-10';

// Stand-ins for the context's defaults (not exported there). Only their shape
// matters: number-typed keys mark what sanitizePayload coerces, and the
// registry merges them under a loaded slice.
const ASSETS: Assets = {
  portfolio: 0, unrealizedGain: 0, shieldingDeduction: 0, taxRate: 37, bsu: 0, bsuAnnualContribution: 0,
  savings: 0, savingsAccounts: [], houseValue: 0, houseDebt: 0, crypto: 0, cryptoUnrealizedGain: 0,
  cryptoTaxRate: 22, bufferAccount: 0,
};
const HOMEOWNER: HomeownerData = { originalLoanAmount: 1_000_000, rente: 5, nedbetalingstid: 20, termingebyr: 50 };
const TRANSITION: TransitionData = {
  currentHouseValue: 1_000_000, agentFeePercent: 3, documentFee: 5000, otherSaleCosts: 0, bridgeMonths: 2, bridgeLoanRate: 6,
};
const LOAN: LoanData = {
  arslonn: 500_000, eksisterendeGjeld: 0, egenkapital: 100_000, laanebelop: 1_000_000, rente: 5,
  nedbetalingstid: 20, termingebyr: 50, etableringsgebyr: 0, betingetLaan: 0, kjoepesum: 1_100_000, gyldigTil: '',
};
const PENSION: Pension = {
  otpBalance: 0, otpEmployerPct: 2, otpEmployeePct: 0, otpGrowthRate: 5, ipsBalance: 0, ipsAnnualContribution: 0,
  ipsGrowthRate: 5, birthYear: 1990, retirementAge: 67, folketrygdBeholdning: 0, folketrygdSingle: true,
  pensionPayoutYears: 20, afpEligible: false, otpAutoPost: false, ipsAutoPost: false,
};

const registry = makePayloadRegistry({
  assets: ASSETS, loan: LOAN, pension: PENSION, homeowner: HOMEOWNER, transition: TRANSITION, fixedExpenses: [],
});
const SCHEMAS = {
  assets: ASSETS, loan: LOAN, pension: PENSION, homeowner: HOMEOWNER, transition: TRANSITION,
  employerCostConfig: DEFAULT_EMPLOYER_COST_CONFIG, billingConfig: DEFAULT_BILLING_CONFIG,
};

const viaJson = (v: unknown): Blob => JSON.parse(JSON.stringify(v)) as Blob;

/** applyPayload's tail: write `data` into `state` through the registry, then
 *  build the autosave payload from the state. */
function applyAndSave(state: Blob, data: Partial<ExportPayload>, resetMissing: boolean): Blob {
  const next: Blob = { ...state };
  const setters = Object.fromEntries(
    persistedKeys(registry).map((k) => [k, (v: unknown) => { next[k] = v; }]),
  ) as unknown as PayloadSetters;
  applyPersistedFields(registry, setters, data, resetMissing);
  return viaJson(derivePayload(registry, next as unknown as BuiltPayload));
}

/** Load a stored blob as the app does and return what the next autosave writes. */
export function loadAndSave(stored: Blob): Blob {
  const sanitized = sanitizePayload(stored as Partial<ExportPayload>, SCHEMAS);
  const data = migrateMortgageBalance(sanitized, NOW);
  if (data.homeowner) data.homeowner = stampLegacyTerm(data.homeowner, NOW);
  return applyAndSave({}, data, true);
}

/** Import `file` over the loaded `state` and return what the autosave writes. */
export function importAndSave(state: Blob, file: Blob): Blob {
  const sanitized = sanitizePayload(file as Partial<ExportPayload>, SCHEMAS);
  const current = state as unknown as ExportPayload;
  const r = migrateImportedMortgage(current, sanitized, NOW);
  const data: Partial<ExportPayload> = { ...sanitized };
  for (const key of ['assets', 'homeowner', 'transition'] as const) {
    if (sanitized[key] !== undefined || r[key] !== current[key]) Object.assign(data, { [key]: r[key] });
  }
  return applyAndSave(state, data, false);
}

/** Undo history[k] (saved on top of history[k - 1]) against `current`, as the
 *  server does. */
export function undoRevision(current: Blob, history: Blob[], k: number) {
  const before = history[k - 1];
  const after = history[k];
  return revertChange(viaJson(current), viaJson(after), viaJson(before), changedKeys(before, after));
}

type SliceBlob = {
  housingMode?: ExportPayload['housingMode'];
  assets?: Partial<Assets> | null;
  homeowner?: Partial<HomeownerData> | null;
  transition?: Partial<TransitionData> | null;
};

/** The mortgage balance the app shows for a blob or a stored snapshot. */
export function shownBalance(b: unknown): number {
  const s = b as SliceBlob;
  return currentMortgage(s.housingMode, s.assets, s.homeowner, s.transition, NOW).fullBalance;
}

/** True when a blob still holds either old duplicate balance field. */
export function hasLegacyCopies(b: unknown): boolean {
  const s = b as { homeowner?: object | null; transition?: object | null };
  return (s.homeowner != null && 'currentMortgageBalance' in s.homeowner)
    || (s.transition != null && 'currentMortgageBalance' in s.transition);
}

/** The second-level paths ('assets.houseDebt', 'income', ...) whose values differ
 *  between two blobs, in revertChange's conflict path format (object slices
 *  per field, everything else per top-level key). */
export function changedPaths(a: Blob, b: Blob): string[] {
  const isObj = (v: unknown): v is Blob => v !== null && typeof v === 'object' && !Array.isArray(v);
  const same = (x: unknown, y: unknown) => JSON.stringify(sortKeys(x)) === JSON.stringify(sortKeys(y));
  const out: string[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (same(a[k], b[k])) continue;
    if (isObj(a[k]) && isObj(b[k])) {
      const x = a[k];
      const y = b[k];
      for (const f of new Set([...Object.keys(x), ...Object.keys(y)])) if (!same(x[f], y[f])) out.push(`${k}.${f}`);
    } else out.push(k);
  }
  return out.sort();
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Blob)[k])]));
  }
  return v;
}
