// A near-complete ExportPayload with EVERY persisted top-level field populated.
// The data-safety fleet writes to one slice and asserts every other field here
// survives byte-for-byte, so a mutation that silently drops any field fails a test.
//
// Kept merge-stable through the server: no `eb-`-prefixed bank rows (so
// reconcileBankTransactions is identity) and all user-preserved fields present
// (so preserveUserFields is identity). A POST of this blob round-trips unchanged.

import type {
  ExportPayload,
  Assets,
  LoanData,
  HomeownerData,
  TransitionData,
  Pension,
} from '../src/context/FinanceContext';

const ASSETS: Assets = {
  portfolio: 500000,
  unrealizedGain: 100000,
  taxRate: 37.84,
  crypto: 50000,
  cryptoUnrealizedGain: 10000,
  cryptoTaxRate: 37.84,
  bsu: 30000,
  savings: 0,
  savingsAccounts: [{ id: 's1', name: 'Rainy day', balance: 80000 }],
  houseValue: 4000000,
  houseDebt: 2500000,
  bufferAccount: 120000,
};

const LOAN: LoanData = {
  arslonn: 720000, eksisterendeGjeld: 0, egenkapital: 800000, laanebelop: 2500000,
  rente: 5.5, nedbetalingstid: 25, termingebyr: 65, etableringsgebyr: 5000,
  skattefradragssats: 22, betingetLaan: 0, kjoepesum: 4000000, gyldigTil: '2026-12',
};

const HOMEOWNER: HomeownerData = {
  currentMortgageBalance: 2500000, originalLoanAmount: 3000000, rente: 5.5,
  nedbetalingstid: 25, termingebyr: 65, skattefradragssats: 22, accountLabel: 'Boliglån',
  startDate: '2020-01', notifiedRate: 5.7, notifiedRateFrom: '2026-08',
};

const TRANSITION: TransitionData = {
  currentHouseValue: 4000000, currentMortgageBalance: 2500000, agentFeePercent: 1.5,
  documentFee: 12000, otherSaleCosts: 20000, bridgeMonths: 3, bridgeLoanRate: 6.5,
};

const PENSION: Pension = {
  otpBalance: 250000, otpEmployerPct: 5, otpEmployeePct: 0, otpGrowthRate: 5,
  ipsBalance: 40000, ipsAnnualContribution: 15000, ipsGrowthRate: 5, birthYear: 1990, retirementAge: 67,
};

export function fullFixture(): ExportPayload {
  return {
    // --- budget / income ---
    income: 60000,
    monthlyIncomes: { '2026-05': 61000, '2026-06': 60000 },
    payslips: {
      '2026-06': { gross: 78000, net: 52000, tax: 26000, base: 78000, holidayPay: 0 },
    },
    payday: 25,

    // --- budget / spending ---
    fixedExpenses: [
      { id: 'f1', name: 'Mortgage', amount: 14000, type: 'fixed' },
      { id: 'f2', name: 'Streaming', amount: 150, type: 'subscription' },
      { id: 'f3', name: 'Insurance', amount: 1200, type: 'insurance' },
      { id: 'f4', name: 'Groceries envelope', amount: 6000, type: 'variable', category: 'groceries' },
    ],
    dailyTransactions: [
      { id: 't1', date: '2026-06-03', description: 'Grocery store', amount: 5000, category: 'groceries', kind: 'expense' },
      { id: 't2', date: '2026-06-10', description: 'Restaurant', amount: 2000, category: 'dining', kind: 'expense' },
      { id: 't3', date: '2026-05-04', description: 'Grocery store', amount: 4500, category: 'groceries', kind: 'expense' },
    ],
    deletedBankIds: ['eb-old-1'],
    categoryBudgets: { groceries: 6000, dining: 2500 },
    recurringTemplates: [{ id: 'rt1', description: 'Coffee', amount: 45, category: 'dining' }],
    accountLabels: { '1234.56.78901': 'Everyday account' },
    categoryRules: [{ id: 'cr1', match: 'REMA', category: 'groceries' }],
    labelRules: [{ id: 'lr1', match: 'FORE', label: 'Foreningen' }],
    transferRules: [{ id: 'tr1', match: 'Overføring egen konto' }],

    // --- assets / debt ---
    assets: structuredClone(ASSETS),
    debts: [
      { id: 'd1', name: 'Student loan', type: 'student', balance: 200000, rate: 0, minPayment: 2000, interestFreeUntil: '2027-01' },
      { id: 'd2', name: 'Credit card', type: 'credit_card', balance: 40000, rate: 20, minPayment: 1500, revolving: true },
    ],

    // --- housing ---
    housingMode: 'homeowner',
    loan: structuredClone(LOAN),
    homeowner: structuredClone(HOMEOWNER),
    transition: structuredClone(TRANSITION),
    residences: [
      { id: 'r1', address: 'Storgata 1', purchasePrice: 3200000, moveInDate: '2020-01', moveOutDate: null },
    ],
    secondHomeScenarios: [
      {
        id: 'sh1', name: 'Rental flat', strategy: 'rent', purchasePrice: 3000000, dokumentavgiftPct: 2.5,
        tinglysingsgebyr: 585, otherPurchaseCosts: 15000, equityShare: 0.25, mortgageRatePct: 6,
        termYears: 25, monthlyRent: 15000, vacancyPct: 5, monthlyOperatingCosts: 2000,
        deductibleCostsAnnual: 12000, renovationCost: 0, afterRepairValue: 3000000, refinanceLtvPct: 75,
        holdYears: 10, annualAppreciationPct: 3, saleAgentFeePct: 1.5, documentedImprovements: 0,
        marginalWealthTaxPct: 1, committed: true,
      },
    ],

    // --- pension ---
    pension: structuredClone(PENSION),

    // --- salary tracker ---
    jobs: [{ id: 'j1', startDate: '2020-01', endDate: null, employer: 'Acme', role: 'Engineer', contractedHoursPerWeek: 37.5, onCallAnnual: 0 }],
    salaries: [{ id: 'sal1', jobId: 'j1', effectiveDate: '2020-01', grossAnnual: 720000, changeType: 'initial' }],
    bonuses: [{ id: 'b1', date: '2026-03-15', amount: 30000, type: 'annual', jobId: 'j1', includeInBudget: false }],
    overtime: [{ id: 'ot1', date: '2026-06-01', hours: 10, amount: 5000, jobId: 'j1', includeInBudget: false }],
    hoursSnapshots: [{ id: 'hs1', periodMonth: '2026-06', actualHoursPerWeek: 40, jobId: 'j1' }],

    // --- consulting ---
    employerCostConfig: { feriepengesatsPct: 12, payrollTaxPct: 14.1, overheadAnnual: 50000, overheadPct: 0 },
    billingConfig: { workHoursPerYear: 1950, utilizationPct: 80, billableHoursOverride: null, targetMarginPct: 20, hoursPerDay: 7.5 },

    // --- profile ---
    profile: { name: 'Alex Doe', birthDate: '1990-05-01' },

    // --- goals ---
    goals: [
      { id: 'g1', name: 'Down payment', target: 600000, source: 'bufferAccount' },
      { id: 'g2', name: 'Emergency fund', target: 200000, source: 'manual', manualCurrent: 120000, deadline: '2027-06' },
    ],

    // --- history ---
    netWorthHistory: { '2026-04': 2100000, '2026-05': 2130000, '2026-06': 2152160 },
    balanceSnapshots: {
      '2026-06': {
        assets: structuredClone(ASSETS),
        loan: structuredClone(LOAN),
        pension: structuredClone(PENSION),
        homeowner: structuredClone(HOMEOWNER),
        transition: structuredClone(TRANSITION),
        housingMode: 'homeowner',
        source: 'manual',
      },
    },

    // --- forecast / assumptions ---
    forecastAssumptions: {
      a: { raisePct: 3, savingsPct: 25, returnPct: 7, inflationPct: 3, years: 20, extraMonthly: 0 },
      b: { raisePct: null, savingsPct: null, returnPct: null, inflationPct: null, years: null, extraMonthly: null },
      compareOn: false,
    },
    savingsTargetPercent: 25,
    growthReturnRate: 7,
    houseGrowthRate: 3,
    cashGrowthRate: 1,
    cryptoGrowthRate: 0,

    // --- settings / preferences ---
    lang: 'nb',
    region: 'no',
    customTaxRatePct: 37.84,
    displayCurrency: 'NOK',
    nokToUsd: 0.095,
    customCurrencyCode: 'EUR',
    customCurrencyRate: 0.086,
    hiddenNavItems: [],
    aiContext: 'Plan: go independent in ~2 years; keeping a 12-month buffer until then.',
    onboardingCompleted: true,
    assumptionsNudgeDismissed: false,
    incomeReminderDismissedMonth: '2026-05',
    conservativeNudgeDismissedMonth: '2026-04',
  } as ExportPayload;
}

/** Top-level keys present in the full fixture — used to assert preservation. */
export function topLevelKeys(): string[] {
  return Object.keys(fullFixture());
}
