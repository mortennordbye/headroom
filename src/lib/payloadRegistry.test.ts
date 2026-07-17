import { describe, it, expect } from 'vitest';
import {
  makePayloadRegistry,
  applyPersistedFields,
  derivePayload,
  persistedKeys,
  ABSENT,
  whenDefined,
  whenTruthy,
  whenBoolean,
  whenString,
  whenNumber,
  whenArray,
  whenOneOf,
  mergedWith,
  type PayloadDefaults,
  type PayloadRegistry,
  type PayloadSetters,
  type PersistedKey,
  type BuiltPayload,
} from './payloadRegistry';
import { DEFAULT_EMPLOYER_COST_CONFIG, DEFAULT_BILLING_CONFIG } from './employerCost';
import { getDemoData } from './demoData';
import type {
  ExportPayload, Assets, LoanData, Pension, HomeownerData, TransitionData,
  FixedExpense, Debt, DailyTransaction, TransactionTemplate, BalanceSnapshot,
  MonthlyPayslip, JobEntry, SalaryEntry, BonusEntry, OvertimeEntry, HoursSnapshot, Goal, Residence,
} from '../context/FinanceContext';
import type { CategoryRule } from './categorize';
import type { LabelRule } from './labelRules';
import type { TransferRule } from './transferRules';
import type { SecondHomeScenario } from './secondHome';

// ── Injection defaults for the registry. Recognizable (all-9s) so the reset
// test can assert a 'reset' object field dropped to exactly this value. ──
const defAssets: Assets = {
  portfolio: 9, unrealizedGain: 9, taxRate: 9, bsu: 9, savings: 0, savingsAccounts: [],
  houseValue: 9, houseDebt: 9, crypto: 9, cryptoUnrealizedGain: 9, cryptoTaxRate: 9, bufferAccount: 9,
};
const defLoan: LoanData = {
  arslonn: 9, eksisterendeGjeld: 9, egenkapital: 9, laanebelop: 9, rente: 9, nedbetalingstid: 9,
  termingebyr: 9, etableringsgebyr: 9, skattefradragssats: 9, betingetLaan: 9, kjoepesum: 9, gyldigTil: 'x',
};
const defPension: Pension = {
  otpBalance: 9, otpEmployerPct: 9, otpEmployeePct: 9, otpGrowthRate: 9,
  ipsBalance: 9, ipsAnnualContribution: 9, ipsGrowthRate: 9, birthYear: 9, retirementAge: 9,
};
const defHomeowner: HomeownerData = {
  currentMortgageBalance: 9, originalLoanAmount: 9, rente: 9, nedbetalingstid: 9, termingebyr: 9, skattefradragssats: 9,
};
const defTransition: TransitionData = {
  currentHouseValue: 9, currentMortgageBalance: 9, agentFeePercent: 9, documentFee: 9,
  otherSaleCosts: 9, bridgeMonths: 9, bridgeLoanRate: 9,
};
const defFixed: FixedExpense[] = [{ id: 'def-fx', name: 'Def', amount: 9, type: 'fixed' }];

const testDefaults: PayloadDefaults = {
  assets: defAssets, loan: defLoan, pension: defPension,
  homeowner: defHomeowner, transition: defTransition, fixedExpenses: defFixed,
};

const registry: PayloadRegistry = makePayloadRegistry(testDefaults);
const KEYS = persistedKeys(registry);

// ── A fully-populated, canonical payload: every persisted field carries a
// distinct non-default value, and the transform-bearing fields (assets,
// snapshots, dailyTransactions, merged configs) are already in the exact shape
// their read produces, so applyPayload→buildPayload is a pure identity. ──
const canonicalAssets: Assets = {
  portfolio: 111, unrealizedGain: 222, taxRate: 30, bsu: 333, savings: 0,
  savingsAccounts: [{ id: 'sav-1', name: 'Sparekonto', balance: 444 }],
  houseValue: 555, houseDebt: 666, crypto: 777, cryptoUnrealizedGain: 888, cryptoTaxRate: 20, bufferAccount: 999,
};
const canonicalLoan: LoanData = {
  arslonn: 700000, eksisterendeGjeld: 1, egenkapital: 400000, laanebelop: 2500000, rente: 4.5, nedbetalingstid: 20,
  termingebyr: 60, etableringsgebyr: 2, skattefradragssats: 21, betingetLaan: 2000000, kjoepesum: 3000000, gyldigTil: '1. jan 2030',
};
const canonicalPension: Pension = {
  otpBalance: 100, otpEmployerPct: 6, otpEmployeePct: 1, otpGrowthRate: 4,
  ipsBalance: 200, ipsAnnualContribution: 300, ipsGrowthRate: 6, birthYear: 1988, retirementAge: 68,
};
const canonicalHomeowner: HomeownerData = {
  currentMortgageBalance: 2000000, originalLoanAmount: 2600000, rente: 5, nedbetalingstid: 22, termingebyr: 55, skattefradragssats: 23,
};
const canonicalTransition: TransitionData = {
  currentHouseValue: 5000000, currentMortgageBalance: 2000000, agentFeePercent: 2.5, documentFee: 8000,
  otherSaleCosts: 100, bridgeMonths: 3, bridgeLoanRate: 6,
};
const canonicalSnapshot: BalanceSnapshot = {
  assets: { ...canonicalAssets, savings: 0, savingsAccounts: [{ id: 'sav-s1', name: 'S', balance: 1000 }] },
  loan: canonicalLoan, pension: canonicalPension, homeowner: canonicalHomeowner,
  transition: canonicalTransition, housingMode: 'homeowner',
  debts: [{ id: 'snap-debt-1', name: 'D', type: 'consumer', balance: 5000, rate: 10, minPayment: 500 }],
  v: 2,
  source: 'auto',
  fixedExpenses: [{ id: 'snap-fx-1', name: 'Huslån', amount: 16500, type: 'fixed' }],
  assumptions: { savingsTargetPercent: 20, growthReturnRate: 7, houseGrowthRate: 3 },
  categoryBudgets: { groceries: 4000 },
};
const canonicalTx: DailyTransaction[] = [
  { id: 'tx-1', date: '2026-01-05', description: 'A', amount: 100, category: 'groceries', categorySource: 'auto' },
  { id: 'tx-2', date: '2026-01-06', description: 'B', amount: 200, kind: 'expense' },
];
const canonicalDebts: Debt[] = [{ id: 'debt-1', name: 'Studielån', type: 'student', balance: 200000, rate: 4.9, minPayment: 3000 }];
const canonicalTemplates: TransactionTemplate[] = [{ id: 'rt-1', description: 'Kaffe', amount: 49, category: 'dining' }];
const canonicalCategoryRules: CategoryRule[] = [{ id: 'cr-1', match: 'rema', category: 'groceries' }];
const canonicalLabelRules: LabelRule[] = [{ id: 'lr-1', match: 'rema', label: 'Rema 1000' }];
const canonicalTransferRules: TransferRule[] = [{ id: 'tr-1', match: 'morrow bank' }];
const canonicalPayslips: Record<string, MonthlyPayslip> = { '2026-01': { gross: 60000, net: 42000, tax: 18000, base: 58000 } };
const canonicalJobs: JobEntry[] = [{ id: 'job-1', startDate: '2024-01', endDate: null, employer: 'E', role: 'R', contractedHoursPerWeek: 37.5 }];
const canonicalSalaries: SalaryEntry[] = [{ id: 'sal-1', jobId: 'job-1', effectiveDate: '2024-01', grossAnnual: 700000, changeType: 'initial' }];
const canonicalBonuses: BonusEntry[] = [{ id: 'bon-1', date: '2026-01-01', amount: 40000, type: 'annual' }];
const canonicalOvertime: OvertimeEntry[] = [{ id: 'ot-1', date: '2026-01-02', hours: 10, amount: 5000 }];
const canonicalHours: HoursSnapshot[] = [{ id: 'hs-1', periodMonth: '2026-01', actualHoursPerWeek: 40 }];
const canonicalGoals: Goal[] = [{ id: 'goal-1', name: 'Buffer', target: 100000, source: 'bufferAccount' }];
const canonicalResidences: Residence[] = [{ id: 'res-1', address: 'Storgata 1', propertyType: 'borettslag', purchasePrice: 3800000, purchaseCosts: 12000, jointDebtShare: 350000, moveInDate: '2021-03', moveOutDate: null, salePrice: null, notes: '2-roms' }];
const canonicalSecondHome: SecondHomeScenario[] = [{
  id: 'sh-1', name: 'Utleie', strategy: 'rent',
  purchasePrice: 4000000, dokumentavgiftPct: 2.5, tinglysingsgebyr: 585, otherPurchaseCosts: 0,
  equityShare: 0.25, mortgageRatePct: 5.5, termYears: 25,
  monthlyRent: 15000, vacancyPct: 5, monthlyOperatingCosts: 3000, deductibleCostsAnnual: 36000,
  renovationCost: 0, afterRepairValue: 4000000, refinanceLtvPct: 75,
  holdYears: 10, annualAppreciationPct: 3, saleAgentFeePct: 3, documentedImprovements: 0,
  marginalWealthTaxPct: 0.85,
}];

function fullPayload(): ExportPayload {
  return {
    income: 62000,
    monthlyIncomes: { '2026-01': 61000 },
    payslips: canonicalPayslips,
    netWorthHistory: { '2026-01': 1234567 },
    balanceSnapshots: { '2026-01': canonicalSnapshot },
    fixedExpenses: [{ id: 'fx-1', name: 'Huslån', amount: 16500, type: 'fixed' }],
    dailyTransactions: canonicalTx,
    deletedBankIds: ['eb-old-1'],
    accountLabels: { 'ab12:u1': 'My Card' },
    categoryRules: canonicalCategoryRules,
    labelRules: canonicalLabelRules,
    transferRules: canonicalTransferRules,
    categoryBudgets: { groceries: 4000 },
    debts: canonicalDebts,
    assets: canonicalAssets,
    loan: canonicalLoan,
    pension: canonicalPension,
    recurringTemplates: canonicalTemplates,
    housingMode: 'homeowner',
    homeowner: canonicalHomeowner,
    transition: canonicalTransition,
    lang: 'en',
    savingsTargetPercent: 25,
    growthReturnRate: 8,
    forecastAssumptions: {
      a: { raisePct: 5, savingsPct: 30, returnPct: 7, inflationPct: 3, years: 20, extraMonthly: 4000 },
      b: { raisePct: null, savingsPct: null, returnPct: 9, inflationPct: null, years: null, extraMonthly: null },
      compareOn: true,
    },
    houseGrowthRate: 4,
    cashGrowthRate: 2,
    cryptoGrowthRate: 1,
    displayCurrency: 'USD',
    nokToUsd: 0.095,
    customCurrencyCode: 'SEK',
    customCurrencyRate: 1.05,
    jobs: canonicalJobs,
    salaries: canonicalSalaries,
    residences: canonicalResidences,
    secondHomeScenarios: canonicalSecondHome,
    bonuses: canonicalBonuses,
    overtime: canonicalOvertime,
    hoursSnapshots: canonicalHours,
    goals: canonicalGoals,
    region: 'generic',
    customTaxRatePct: 28,
    employerCostConfig: { ...DEFAULT_EMPLOYER_COST_CONFIG },
    billingConfig: { ...DEFAULT_BILLING_CONFIG },
    hiddenNavItems: ['forecast'],
    onboardingCompleted: true,
    assumptionsNudgeDismissed: true,
    incomeReminderDismissedMonth: '2026-01',
    conservativeNudgeDismissedMonth: '2026-01',
    payday: 25,
  };
}

// Run a blob through the registry (apply → derive) over a mutable state store,
// exactly as FinanceContext does with the React setters bound instead.
function roundTrip(data: Partial<ExportPayload>, resetMissing: boolean, seed: Partial<Record<PersistedKey, unknown>> = {}) {
  const state: Record<string, unknown> = { ...seed };
  const setters = Object.fromEntries(
    KEYS.map((k) => [k, (v: unknown) => { state[k] = v; }]),
  ) as unknown as PayloadSetters;
  applyPersistedFields(registry, setters, data, resetMissing);
  return state;
}

describe('payloadRegistry — exhaustiveness', () => {
  it('registers exactly the 50 persisted fields (currentMonth excluded)', () => {
    expect(KEYS).toHaveLength(50);
    expect(KEYS).not.toContain('currentMonth');
  });

  it('partitions every field into reset (28) or preserve (22)', () => {
    const reset = KEYS.filter((k) => registry[k].group === 'reset');
    const preserve = KEYS.filter((k) => registry[k].group === 'preserve');
    expect(reset).toHaveLength(28);
    expect(preserve).toHaveLength(22);
    // The load/import distinction, locked field-for-field.
    expect(new Set(preserve)).toEqual(new Set([
      'lang', 'savingsTargetPercent', 'growthReturnRate', 'forecastAssumptions', 'houseGrowthRate',
      'cashGrowthRate', 'cryptoGrowthRate', 'displayCurrency', 'nokToUsd', 'customCurrencyCode',
      'customCurrencyRate', 'jobs', 'salaries', 'residences', 'secondHomeScenarios', 'bonuses', 'overtime', 'hoursSnapshots', 'goals', 'region',
      'customTaxRatePct', 'hiddenNavItems',
    ]));
  });

  it('every reset field has a default; no preserve field does', () => {
    for (const k of KEYS) {
      if (registry[k].group === 'reset') expect(registry[k].default, k).not.toBeUndefined();
      else expect(registry[k].default, k).toBeUndefined();
    }
  });
});

describe('payloadRegistry — round-trip (apply → derive is identity)', () => {
  it('preserves every field of a fully-populated payload, byte-for-byte', () => {
    const input = fullPayload();
    const state = roundTrip(input, false);
    const built = derivePayload(registry, state as BuiltPayload);
    expect(built).toEqual(input);
    // Nothing extra, nothing missing.
    expect(Object.keys(built).sort()).toEqual(Object.keys(input).sort());
  });

  it('is identical whether loaded (resetMissing) or imported when the blob is complete', () => {
    const input = fullPayload();
    const loaded = derivePayload(registry, roundTrip(input, true) as BuiltPayload);
    const imported = derivePayload(registry, roundTrip(input, false) as BuiltPayload);
    expect(loaded).toEqual(imported);
    expect(loaded).toEqual(input);
  });
});

describe('payloadRegistry — resetMissing semantics', () => {
  const seed: Record<PersistedKey, unknown> = Object.fromEntries(
    KEYS.map((k) => [k, `SEED_${k}`]),
  ) as Record<PersistedKey, unknown>;

  it('load (resetMissing=true) drops absent reset fields to their default, leaves preserve fields', () => {
    const state = roundTrip({}, true, seed);
    // reset fields → their registry default
    expect(state.income).toBe(55000);
    expect(state.housingMode).toBe('first_buyer');
    expect(state.onboardingCompleted).toBe(true);
    expect(state.assumptionsNudgeDismissed).toBe(false);
    expect(state.incomeReminderDismissedMonth).toBe('');
    expect(state.assets).toBe(defAssets);
    expect(state.loan).toBe(defLoan);
    expect(state.pension).toBe(defPension);
    expect(state.fixedExpenses).toBe(defFixed);
    expect(state.debts).toEqual([]);
    expect(state.employerCostConfig).toBe(DEFAULT_EMPLOYER_COST_CONFIG);
    // preserve fields → untouched (kept the seed)
    for (const k of KEYS) {
      if (registry[k].group === 'preserve') expect(state[k], k).toBe(`SEED_${k}`);
    }
  });

  it('import (resetMissing=false) leaves ALL absent fields untouched', () => {
    const state = roundTrip({}, false, seed);
    for (const k of KEYS) expect(state[k], k).toBe(`SEED_${k}`);
  });

  it('a single missing reset field resets on load but is preserved on import', () => {
    const input: Partial<ExportPayload> = { ...fullPayload() };
    delete input.income;
    expect(roundTrip(input, true, seed).income).toBe(55000);
    expect(roundTrip(input, false, seed).income).toBe('SEED_income');
  });

  it('a missing preserve field is never reset, on either path', () => {
    const input: Partial<ExportPayload> = { ...fullPayload() };
    delete input.savingsTargetPercent;
    expect(roundTrip(input, true, seed).savingsTargetPercent).toBe('SEED_savingsTargetPercent');
    expect(roundTrip(input, false, seed).savingsTargetPercent).toBe('SEED_savingsTargetPercent');
  });
});

describe('payloadRegistry — special-case reads preserved', () => {
  it('assets: zeroes the legacy savings scalar and migrates savingsAccounts', () => {
    const state = roundTrip({ assets: { ...canonicalAssets, savings: 12345, savingsAccounts: [] } }, false);
    const a = state.assets as Assets;
    expect(a.savings).toBe(0);
    // empty array + nonzero scalar → one migrated account
    expect(a.savingsAccounts).toEqual([{ id: expect.any(String), name: 'Sparekonto', balance: 12345 }]);
  });

  it('pension/homeowner/transition merge over their default (missing keys filled)', () => {
    // A partial pension keeps the default for keys it omits.
    const state = roundTrip({ pension: { otpBalance: 500 } as Pension }, false);
    expect(state.pension).toEqual({ ...defPension, otpBalance: 500 });
  });

  it('region only accepts the allow-list', () => {
    expect(roundTrip({ region: 'no' }, false).region).toBe('no');
    expect(roundTrip({ region: 'generic' }, false).region).toBe('generic');
    // an invalid region is ignored (field never set)
    expect('region' in roundTrip({ region: 'xx' as 'no' }, false)).toBe(false);
  });

  // HISTORY_PLAN §7 downgrade safety: snapshots are stored/re-applied as whole
  // objects (never field-projected), so a field a *newer* client added survives a
  // round-trip through an older reader. Simulate that with an unknown future field.
  it('passes unknown/future snapshot fields through verbatim (downgrade safety)', () => {
    const future = { ...canonicalSnapshot, v: 99, futureField: { nested: 1 } } as unknown as BalanceSnapshot;
    const state = roundTrip({ balanceSnapshots: { '2026-01': future } }, false);
    const out = (state.balanceSnapshots as Record<string, Record<string, unknown>>)['2026-01'];
    expect(out.v).toBe(99);
    expect(out.futureField).toEqual({ nested: 1 });
    // v2 fields survive too.
    expect(out.assumptions).toEqual(canonicalSnapshot.assumptions);
    expect(out.fixedExpenses).toEqual(canonicalSnapshot.fixedExpenses);
  });
});

describe('payloadRegistry — demo coverage (finding 2.5)', () => {
  it('getDemoData sets every personal field and no preference field', () => {
    const demoKeys = new Set(Object.keys(getDemoData()));
    for (const k of KEYS) {
      if (registry[k].demo === 'personal') {
        expect(demoKeys.has(k), `demo must set personal field '${k}'`).toBe(true);
      } else {
        expect(demoKeys.has(k), `demo must NOT set preference field '${k}'`).toBe(false);
      }
    }
  });
});

describe('payloadRegistry — read combinators', () => {
  const d = (v: unknown): Partial<ExportPayload> => ({ income: v as number });
  it('whenDefined: present unless undefined (0 and null count as present)', () => {
    expect(whenDefined('income')(d(0))).toBe(0);
    expect(whenDefined('income')(d(undefined))).toBe(ABSENT);
    expect(whenDefined('income')({})).toBe(ABSENT);
  });
  it('whenTruthy: falsy is absent, but a non-empty/empty array is truthy', () => {
    expect(whenTruthy('debts')({ debts: [] })).toEqual([]);
    expect(whenTruthy('fixedExpenses')({ fixedExpenses: undefined })).toBe(ABSENT);
    expect(whenTruthy('lang')({ lang: '' as 'en' })).toBe(ABSENT);
  });
  it('whenBoolean / whenString / whenNumber gate on typeof', () => {
    expect(whenBoolean('onboardingCompleted')({ onboardingCompleted: false })).toBe(false);
    expect(whenBoolean('onboardingCompleted')({ onboardingCompleted: 1 as unknown as boolean })).toBe(ABSENT);
    expect(whenString('incomeReminderDismissedMonth')({ incomeReminderDismissedMonth: '' })).toBe('');
    expect(whenNumber('customTaxRatePct')({ customTaxRatePct: 0 })).toBe(0);
    expect(whenNumber('customTaxRatePct')({ customTaxRatePct: '5' as unknown as number })).toBe(ABSENT);
  });
  it('whenArray gates on Array.isArray', () => {
    expect(whenArray('jobs')({ jobs: [] })).toEqual([]);
    expect(whenArray('jobs')({ jobs: {} as unknown as [] })).toBe(ABSENT);
  });
  it('whenOneOf accepts only allow-listed values', () => {
    expect(whenOneOf('region', ['no', 'generic'])({ region: 'no' })).toBe('no');
    expect(whenOneOf('region', ['no', 'generic'])({ region: 'xx' as 'no' })).toBe(ABSENT);
  });
  it('mergedWith spreads the value over the base, absent when falsy', () => {
    expect(mergedWith('pension', defPension)({ pension: { otpBalance: 5 } as Pension }))
      .toEqual({ ...defPension, otpBalance: 5 });
    expect(mergedWith('pension', defPension)({})).toBe(ABSENT);
  });
});
