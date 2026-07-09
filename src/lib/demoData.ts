import type { ExportPayload, BalanceSnapshot, Assets, Debt, Pension } from '../context/FinanceContext';
import { computeEquityBreakdown } from './equity';
import { DEFAULT_EMPLOYER_COST_CONFIG, DEFAULT_BILLING_CONFIG } from './employerCost';

/**
 * A believable but entirely fictional dataset used by demo mode, so the app can
 * be shown to others without exposing the user's real finances.
 *
 * IMPORTANT: this must set EVERY field that can hold personal data (even to empty
 * values). Demo mode applies it via importAll, which only overwrites fields that
 * are present — any field omitted here would leak the user's real value into the
 * demo view. Display preferences (lang, currency, region, nav visibility) are
 * deliberately NOT set, so the presenter keeps their chosen language/layout.
 */
export function getDemoData(): Partial<ExportPayload> {
  const now = new Date();
  const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const dayThisMonth = (day: number) =>
    `${ym(now)}-${String(Math.min(day, now.getDate())).padStart(2, '0')}`;
  const monthsAgo = (n: number) => {
    const d = new Date(now.getFullYear(), now.getMonth() - n, 1);
    return ym(d);
  };

  const demoAssets: Assets = {
    portfolio: 285000,
    unrealizedGain: 62000,
    taxRate: 37.84,
    bsu: 33000,
    savingsAccounts: [
      { id: 'demo-sav-1', name: 'Sparekonto', balance: 60000 },
      { id: 'demo-sav-2', name: 'Feriekonto', balance: 35000 },
    ],
    houseValue: 4200000,
    houseDebt: 2950000,
    crypto: 48000,
    cryptoUnrealizedGain: 15000,
    cryptoTaxRate: 22,
    bufferAccount: 60000,
  };
  const demoHomeowner = {
    currentMortgageBalance: 2950000,
    originalLoanAmount: 3400000,
    rente: 5.5,
    nedbetalingstid: 25,
    termingebyr: 50,
    skattefradragssats: 22,
  };
  const demoTransition = {
    currentHouseValue: 4200000,
    currentMortgageBalance: 2950000,
    agentFeePercent: 3,
    documentFee: 7500,
    otherSaleCosts: 0,
    bridgeMonths: 2,
    bridgeLoanRate: 6.5,
  };
  const demoLoan = {
    arslonn: 744000,
    eksisterendeGjeld: 0,
    egenkapital: 500000,
    laanebelop: 3000000,
    rente: 5.5,
    nedbetalingstid: 25,
    termingebyr: 50,
    etableringsgebyr: 0,
    skattefradragssats: 22,
    betingetLaan: 2500000,
    kjoepesum: 3500000,
    gyldigTil: '',
  };
  const demoPension: Pension = {
    otpBalance: 210000,
    otpEmployerPct: 5,
    otpEmployeePct: 0,
    otpGrowthRate: 5,
    ipsBalance: 48000,
    ipsAnnualContribution: 15000,
    ipsGrowthRate: 7,
    birthYear: 1990,
    retirementAge: 67,
  };
  const demoDebts: Debt[] = [
    { id: 'demo-debt-1', name: 'Studielån (Lånekassen)', type: 'student', balance: 284000, rate: 4.9, minPayment: 3200 },
    { id: 'demo-debt-2', name: 'Kredittkort', type: 'credit_card', balance: 24500, rate: 22.9, minPayment: 1500 },
    { id: 'demo-debt-3', name: 'Forbrukslån', type: 'consumer', balance: 55000, rate: 12.5, minPayment: 2500 },
    { id: 'demo-debt-4', name: 'Kredittkort (betales månedlig)', type: 'credit_card', balance: 18000, rate: 0, minPayment: 0, revolving: true },
  ];
  const demoFixedExpenses: ExportPayload['fixedExpenses'] = [
    { id: 'demo-fx-1', name: 'Huslån', amount: 16500, type: 'fixed' },
    { id: 'demo-fx-2', name: 'Felleskostnader', amount: 3400, type: 'fixed' },
    { id: 'demo-fx-3', name: 'Strøm', amount: 1300, type: 'fixed' },
    { id: 'demo-fx-4', name: 'Forsikring', amount: 650, type: 'insurance' },
    { id: 'demo-fx-5', name: 'Mobil/Internett', amount: 800, type: 'subscription' },
    { id: 'demo-fx-6', name: 'Trening', amount: 500, type: 'subscription' },
    { id: 'demo-fx-7', name: 'Mat', amount: 6500, type: 'variable' },
  ];
  const demoCategoryBudgets: ExportPayload['categoryBudgets'] = {
    groceries: 4000,   // 742 spent — comfortably under
    transport: 800,    // 850 spent — just over
    dining: 700,       // 640 spent — under
    entertainment: 500, // 609 spent — over
    health: 500,       // 310 spent — under
  };
  // Forward assumptions in force during the demo history (constant across months).
  const demoAssumptions = { savingsTargetPercent: 20, growthReturnRate: 7, houseGrowthRate: 3 };

  // Build a believable 6-month back-history so demo mode can showcase the balance
  // time machine and the net-worth chart. k=0 is the current month; older months
  // taper growable balances down and leave the mortgage and other debts slightly higher.
  const snapshotFor = (k: number): BalanceSnapshot => ({
    v: 2,
    source: 'auto',
    fixedExpenses: demoFixedExpenses,
    assumptions: demoAssumptions,
    categoryBudgets: demoCategoryBudgets,
    housingMode: 'homeowner',
    loan: demoLoan,
    transition: demoTransition,
    homeowner: { ...demoHomeowner, currentMortgageBalance: demoHomeowner.currentMortgageBalance + 8000 * k },
    assets: {
      ...demoAssets,
      portfolio: Math.round(demoAssets.portfolio * (1 - 0.012 * k)),
      unrealizedGain: Math.round(demoAssets.unrealizedGain * (1 - 0.03 * k)),
      houseValue: Math.round(demoAssets.houseValue * (1 - 0.004 * k)),
      houseDebt: demoAssets.houseDebt + 8000 * k,
      crypto: Math.round(demoAssets.crypto * (1 - 0.02 * k)),
      savingsAccounts: demoAssets.savingsAccounts?.map(s => ({ ...s, balance: Math.round(s.balance * (1 - 0.015 * k)) })),
      bufferAccount: Math.round(demoAssets.bufferAccount * (1 - 0.01 * k)),
    },
    pension: {
      ...demoPension,
      otpBalance: Math.round(demoPension.otpBalance * (1 - 0.02 * k)),
      ipsBalance: Math.round(demoPension.ipsBalance * (1 - 0.02 * k)),
    },
    debts: demoDebts.map(d => (d.revolving ? d : { ...d, balance: d.balance + d.minPayment * k })),
  });

  const balanceSnapshots: Record<string, BalanceSnapshot> = {};
  const netWorthHistory: Record<string, number> = {};
  for (let k = 0; k <= 5; k++) {
    const snap = snapshotFor(k);
    balanceSnapshots[monthsAgo(k)] = snap;
    const snapDebt = (snap.debts ?? []).reduce((s, d) => s + Math.max(0, d.balance), 0);
    netWorthHistory[monthsAgo(k)] = Math.round(computeEquityBreakdown(snap.assets).totalEquity - snapDebt);
  }

  return {
    income: 62000,
    monthlyIncomes: {},
    payslips: {},
    netWorthHistory,
    balanceSnapshots,
    savingsTargetPercent: 20,

    // Personal-data fields with no demo counterpart: set to empty/default so the
    // user's real account names, merchant rules and billing rates never render
    // during a demo (importAll leaves omitted fields untouched).
    accountLabels: {},
    categoryRules: [],
    labelRules: [],
    employerCostConfig: DEFAULT_EMPLOYER_COST_CONFIG,
    billingConfig: DEFAULT_BILLING_CONFIG,

    fixedExpenses: demoFixedExpenses,

    debts: demoDebts,

    dailyTransactions: [
      { id: 'demo-tx-1', date: dayThisMonth(3), description: 'Rema 1000', amount: 742, category: 'groceries', categorySource: 'auto' },
      { id: 'demo-tx-2', date: dayThisMonth(6), description: 'Vinmonopolet', amount: 389, category: 'entertainment', categorySource: 'auto' },
      { id: 'demo-tx-3', date: dayThisMonth(9), description: 'Ruter månedskort', amount: 850, category: 'transport', categorySource: 'auto' },
      { id: 'demo-tx-4', date: dayThisMonth(12), description: 'Restaurant', amount: 640, category: 'dining', categorySource: 'auto' },
      { id: 'demo-tx-5', date: dayThisMonth(15), description: 'Kino', amount: 220, category: 'entertainment', categorySource: 'auto' },
      { id: 'demo-tx-6', date: dayThisMonth(18), description: 'Apotek', amount: 310, category: 'health', categorySource: 'auto' },
    ],

    categoryBudgets: demoCategoryBudgets,

    recurringTemplates: [
      { id: 'demo-rt-1', description: 'Kaffe', amount: 49, category: 'dining' },
      { id: 'demo-rt-2', description: 'Lunsj', amount: 129, category: 'dining' },
    ],

    assets: demoAssets,

    housingMode: 'homeowner',
    homeowner: demoHomeowner,
    transition: demoTransition,
    loan: demoLoan,

    pension: demoPension,

    jobs: [
      {
        id: 'demo-job-1',
        startDate: monthsAgo(30),
        endDate: null,
        employer: 'Demo Consulting AS',
        role: 'Senior Engineer',
        contractedHoursPerWeek: 37.5,
        onCallAnnual: 24000,
      },
    ],
    salaries: [
      { id: 'demo-sal-1', jobId: 'demo-job-1', effectiveDate: monthsAgo(30), grossAnnual: 690000, changeType: 'initial' },
      { id: 'demo-sal-2', jobId: 'demo-job-1', effectiveDate: monthsAgo(6), grossAnnual: 744000, changeType: 'raise' },
    ],
    bonuses: [
      { id: 'demo-bon-1', date: dayThisMonth(1), amount: 40000, type: 'annual', jobId: 'demo-job-1' },
    ],
    overtime: [],
    hoursSnapshots: [],

    goals: [
      { id: 'demo-goal-1', name: 'Bufferkonto', target: 100000, source: 'bufferAccount' },
      { id: 'demo-goal-2', name: 'Oppussing', target: 150000, source: 'manual', manualCurrent: 40000 },
      { id: 'demo-goal-3', name: 'Sommerferie', target: 50000, source: 'savingsAccount', savingsAccountId: 'demo-sav-2' },
    ],
  };
}
