import type { ExportPayload, BalanceSnapshot, Assets, Debt, Pension } from '../context/FinanceContext';
import { computeEquityBreakdown } from './equity';
import { DEFAULT_EMPLOYER_COST_CONFIG, DEFAULT_BILLING_CONFIG } from './employerCost';
import { DEFAULT_BOLIG_ASSUMPTIONS } from './secondHome';

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
  // A dated day inside a past month, for entries that carry 'YYYY-MM-DD'
  // (bonuses, overtime). Capped at 28 so it is a valid date in every month.
  const dayMonthsAgo = (n: number, day: number) =>
    `${monthsAgo(n)}-${String(Math.min(day, 28)).padStart(2, '0')}`;
  const daysAgo = (n: number) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
    return `${ym(d)}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const demoAssets: Assets = {
    portfolio: 285000,
    unrealizedGain: 62000,
    taxRate: 37.84,
    bsu: 33000,
    bsuAnnualContribution: 27500,
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
    accountLabel: 'Boliglån ung',
    startDate: monthsAgo(48),
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
    folketrygdBeholdning: 950000,
    folketrygdSingle: true,
    pensionPayoutYears: 10,
    afpEligible: true,
    // Contribution automation on, stamped to the current month so the demo shows
    // the feature switched on without opening a catch-up prompt on first view.
    otpAutoPost: true,
    ipsAutoPost: true,
    otpLastPostedMonth: ym(now),
    ipsLastPostedMonth: ym(now),
  };
  const demoDebts: Debt[] = [
    { id: 'demo-debt-1', name: 'Studielån (Lånekassen)', type: 'student', balance: 284000, rate: 4.9, minPayment: 3200 },
    { id: 'demo-debt-2', name: 'Kredittkort', type: 'credit_card', balance: 24500, rate: 22.9, minPayment: 1500, creditLimit: 75000 },
    { id: 'demo-debt-3', name: 'Forbrukslån', type: 'consumer', balance: 55000, rate: 12.5, minPayment: 2500 },
    { id: 'demo-debt-4', name: 'Kredittkort (betales månedlig)', type: 'credit_card', balance: 18000, rate: 0, minPayment: 0, revolving: true, creditLimit: 50000 },
  ];
  const demoFixedExpenses: ExportPayload['fixedExpenses'] = [
    { id: 'demo-fx-1', name: 'Huslån', amount: 16500, type: 'fixed' },
    { id: 'demo-fx-2', name: 'Felleskostnader', amount: 3400, type: 'fixed' },
    { id: 'demo-fx-3', name: 'Strøm', amount: 1300, type: 'fixed' },
    { id: 'demo-fx-4', name: 'Forsikring', amount: 650, type: 'insurance' },
    { id: 'demo-fx-5', name: 'Mobil/Internett', amount: 800, type: 'subscription' },
    { id: 'demo-fx-6', name: 'Trening', amount: 500, type: 'subscription' },
    // Linked to a tracked category, which makes it an envelope: grocery
    // transactions draw this down instead of also hitting the daily budget.
    // Shows the envelope feature in its resolved state, while the unlinked
    // 'Strøm' above still demonstrates the double-counting suggestion.
    { id: 'demo-fx-7', name: 'Mat', amount: 6500, type: 'variable', category: 'groceries' },
  ];
  // Savings are their own record, not fixed expenses — one of each sizing mode,
  // so the demo shows what "follows the income" and "takes the rest" look like
  // in the list rather than only in the dialog.
  const demoSavings: ExportPayload['savings'] = [
    { id: 'demo-sv-1', name: 'Bufferkonto', amount: 2000, mode: 'amount', destinationKind: 'bufferAccount' },
    { id: 'demo-sv-2', name: 'Aksjesparing', amount: 3000, mode: 'rest', destinationKind: 'portfolio' },
  ];
  // Two fictional accounts, so the per-account badge, the account filter and the
  // custom-name ("merge") feature all have something to act on.
  const ACCT_DAILY = 'demo-acct-daily';
  const ACCT_CARD = 'demo-acct-card';

  // A repeating weekly rhythm plus monthly bills over the last ~13 weeks.
  //
  // Dates are RELATIVE (daysAgo) rather than fixed days of the month. The old
  // fixed-day approach clamped every row to "today" via dayThisMonth, so on the
  // 4th of a month the whole ledger collapsed onto one date and the Budget page
  // looked empty. Relative dates mean the current month is always populated up
  // to today, the previous months are complete, and nothing is ever dated in the
  // future — whatever day the demo is opened.
  const WEEKLY: [offset: number, description: string, amount: number, category: string, account: string][] = [
    [0, 'Rema 1000', 742, 'groceries', ACCT_DAILY],
    [1, 'Ruter', 42, 'transport', ACCT_DAILY],
    [2, 'Kaffebrenneriet', 49, 'dining', ACCT_CARD],
    [3, 'Kiwi', 388, 'groceries', ACCT_DAILY],
    [4, 'Lunsjbaren', 129, 'dining', ACCT_CARD],
    [5, 'Coop Extra', 512, 'groceries', ACCT_DAILY],
    [6, 'Restaurant Fjord', 640, 'dining', ACCT_CARD],
  ];
  // Day-of-month bills and occasional spending, cycled across the horizon.
  const MONTHLY: [dayOfMonth: number, description: string, amount: number, category: string, account: string][] = [
    [3, 'Strøm', 1290, 'utilities', ACCT_DAILY],
    [5, 'Mobil og internett', 799, 'subscriptions', ACCT_DAILY],
    [6, 'Ruter månedskort', 850, 'transport', ACCT_DAILY],
    [8, 'Treningssenter', 499, 'subscriptions', ACCT_DAILY],
    [11, 'Strømmetjeneste', 199, 'subscriptions', ACCT_CARD],
    [13, 'Apotek', 310, 'health', ACCT_CARD],
    [16, 'Vinmonopolet', 389, 'entertainment', ACCT_CARD],
    [18, 'Sparekonto', 4000, 'transfers', ACCT_DAILY],
    [19, 'Klesbutikk', 899, 'shopping', ACCT_CARD],
    [22, 'Kino', 220, 'entertainment', ACCT_CARD],
    [24, 'Bensin', 780, 'transport', ACCT_CARD],
    [26, 'Legetime', 375, 'health', ACCT_CARD],
  ];

  // ~6.3 months, so the six-month spending-trend chart and the per-account
  // monthly table are full rather than starting mid-range with blank columns.
  // Matches the six months of balanceSnapshots built below.
  const HORIZON_DAYS = 190;
  const demoTransactions: ExportPayload['dailyTransactions'] = [];
  for (let d = 0; d <= HORIZON_DAYS; d++) {
    const date = daysAgo(d);
    const dayOfMonth = Number(date.slice(8, 10));
    // Weekly rhythm: one row per day, cycling through WEEKLY.
    const w = WEEKLY[d % WEEKLY.length];
    // Vary the amount a little so charts aren't perfectly flat lines. Derived
    // from the index, never Math.random — the dataset must be deterministic or
    // the tests below (and any screenshot) would drift between runs.
    const wobble = 1 + ((d * 37) % 23) / 100 - 0.11;
    demoTransactions.push({
      id: `demo-tx-w${d}`, date, description: w[1],
      amount: Math.round(w[2] * wobble), category: w[3], categorySource: 'auto',
      account: w[4], accountName: w[4] === ACCT_DAILY ? 'Brukskonto' : 'Kredittkort', bank: 'Demo Bank',
    });
    for (const [dom, description, amount, category, account] of MONTHLY) {
      if (dom !== dayOfMonth) continue;
      demoTransactions.push({
        id: `demo-tx-m${d}-${dom}`, date, description, amount, category, categorySource: 'auto',
        account, accountName: account === ACCT_DAILY ? 'Brukskonto' : 'Kredittkort', bank: 'Demo Bank',
      });
    }
  }
  // A couple of money-in rows so the income/expense split is visible. Kept small
  // and clearly incidental — the salary itself comes from the salary tracker, so
  // depositing it here too would double-count the month's income.
  demoTransactions.push(
    { id: 'demo-tx-in-1', date: daysAgo(9), description: 'Refusjon reiseutgifter', amount: 1450, kind: 'income', category: 'income', categorySource: 'auto', account: ACCT_DAILY, accountName: 'Brukskonto', bank: 'Demo Bank' },
    { id: 'demo-tx-in-2', date: daysAgo(38), description: 'Salg brukt sykkel', amount: 2800, kind: 'income', category: 'income', categorySource: 'auto', account: ACCT_DAILY, accountName: 'Brukskonto', bank: 'Demo Bank' },
  );

  // Budgets sized against the generated rhythm above: groceries and dining land
  // close to their budget, transport and entertainment run a little over, so the
  // Budget page shows both the healthy and the over-budget state.
  const demoCategoryBudgets: ExportPayload['categoryBudgets'] = {
    groceries: 7000,
    dining: 3600,
    transport: 1900,
    entertainment: 800,
    subscriptions: 1600,
    health: 800,
    shopping: 1000,
    utilities: 1500,
  };
  // Forward assumptions in force during the demo history (constant across months).
  const demoAssumptions = { savingsTargetPercent: 20, growthReturnRate: 7, houseGrowthRate: 3 };

  // Build a believable 6-month back-history so demo mode can showcase the balance
  // time machine and the net-worth chart. k=0 is the current month; older months
  // taper growable balances down and leave the mortgage and other debts slightly higher.
  const snapshotFor = (k: number): BalanceSnapshot => ({
    v: 3,
    source: 'auto',
    fixedExpenses: demoFixedExpenses,
    savings: demoSavings,
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
    profile: { name: 'Alex Doe', birthDate: '1990-05-01' },
    // Demo shows the auto-derived figures, so no manual override is set.
    capacityOverrides: { arslonn: null, gjeld: null, egenkapital: null },
    employerSalaryOverride: null,
    aiContext:
      'Long-term: want to go independent and start my own consultancy in ~3 years, so keeping a bigger cash buffer than usual. Hoping to buy a rental flat once the mortgage is under 60% LTV.',
    // Three imported payslips, as if the presenter started importing PDFs a few
    // months ago: the recent months show real gross/tax/net from the payslip,
    // the older ones stay on the app's tax-estimated figure. Both states are
    // worth seeing. Base is 744 000 / 12 = 62 000, plus 2 000/mo on-call and any
    // overtime paid that month (matching the overtime rows above).
    monthlyIncomes: {
      [monthsAgo(0)]: 43840,
      [monthsAgo(1)]: 48500,
      [monthsAgo(2)]: 47000,
    },
    payslips: {
      [monthsAgo(0)]: { gross: 64000, net: 43840, tax: 20160, base: 62000, holidayPay: 7680 },
      [monthsAgo(1)]: { gross: 71800, net: 48500, tax: 23300, base: 62000, holidayPay: 8616 },
      [monthsAgo(2)]: { gross: 69200, net: 47000, tax: 22200, base: 62000, holidayPay: 8304 },
    },
    netWorthHistory,
    balanceSnapshots,
    savingsTargetPercent: 20,

    // These must be SET (not omitted) or the presenter's real account names and
    // merchant rules would show through — importAll leaves omitted fields alone.
    // Fictional values satisfy that just as well as empty ones and let the rules
    // features actually be seen working.
    accountLabels: {
      [ACCT_DAILY]: 'Daglig',
      [ACCT_CARD]: 'Kredittkort',
    },
    categoryRules: [
      { id: 'demo-cr-1', match: 'kaffebrenneriet', category: 'dining' },
      { id: 'demo-cr-2', match: 'lunsjbaren', category: 'dining' },
      { id: 'demo-cr-3', match: 'treningssenter', category: 'subscriptions' },
      { id: 'demo-cr-4', match: 'legetime', category: 'health' },
    ],
    labelRules: [
      { id: 'demo-lr-1', match: 'kaffebrenneriet', label: 'Morgenkaffe' },
      { id: 'demo-lr-2', match: 'ruter', label: 'Kollektivtransport' },
    ],
    transferRules: [
      // Moving money to your own savings isn't spending — this is what stops it
      // being counted as such.
      { id: 'demo-tr-1', match: 'sparekonto' },
    ],
    employerCostConfig: DEFAULT_EMPLOYER_COST_CONFIG,
    billingConfig: DEFAULT_BILLING_CONFIG,

    fixedExpenses: demoFixedExpenses,

    savings: demoSavings,

    debts: demoDebts,

    dailyTransactions: demoTransactions,

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

    residences: [
      {
        id: 'demo-res-1', address: 'Storgata 12, Oslo', propertyType: 'borettslag',
        dwellingType: 'leilighet', rooms: 3, sizeSqm: 68, postalCode: '0575',
        purchasePrice: 3800000, purchaseCosts: 12000, jointDebtShare: 350000,
        moveInDate: monthsAgo(48), moveOutDate: null, notes: '2-roms',
      },
      {
        id: 'demo-res-2', address: 'Parkveien 3, Bergen', propertyType: 'selveier',
        dwellingType: 'enebolig', rooms: 5, sizeSqm: 140,
        purchasePrice: 2600000, purchaseCosts: 65000,
        moveInDate: monthsAgo(120), moveOutDate: monthsAgo(48), salePrice: 3100000,
      },
    ],

    pension: demoPension,

    // An ~11-year career across three employers, so the salary history, the
    // progression chart and the per-job breakdown all have something to show.
    //
    // Handoffs are deliberately one month apart (a job ends the month BEFORE the
    // next begins): activeJobBreakdown treats `endDate` as inclusive, so ending
    // and starting in the same month would count both jobs and double the gross
    // for that month. Only the current job has no end date, so today's figures
    // are unchanged: 744 000 base + 24 000 on-call.
    jobs: [
      {
        id: 'demo-job-1',
        startDate: monthsAgo(138),
        endDate: monthsAgo(97),
        employer: 'Nordvik Systemer AS',
        role: 'Utvikler',
        contractedHoursPerWeek: 37.5,
      },
      {
        id: 'demo-job-2',
        startDate: monthsAgo(96),
        endDate: monthsAgo(31),
        employer: 'Fjordkraft Digital AS',
        role: 'Software Engineer',
        contractedHoursPerWeek: 37.5,
      },
      {
        id: 'demo-job-3',
        startDate: monthsAgo(30),
        endDate: null,
        employer: 'Demo Consulting AS',
        role: 'Senior Engineer',
        contractedHoursPerWeek: 37.5,
        onCallAnnual: 24000,
      },
    ],
    // 455k → 744k over the three jobs. `role` lives on the job, so an in-role
    // step up is recorded as a promotion entry with a note rather than a new job.
    salaries: [
      { id: 'demo-sal-1', jobId: 'demo-job-1', effectiveDate: monthsAgo(138), grossAnnual: 455000, changeType: 'initial' },
      { id: 'demo-sal-2', jobId: 'demo-job-1', effectiveDate: monthsAgo(126), grossAnnual: 478000, changeType: 'raise' },
      { id: 'demo-sal-3', jobId: 'demo-job-1', effectiveDate: monthsAgo(114), grossAnnual: 496000, changeType: 'raise' },

      { id: 'demo-sal-4', jobId: 'demo-job-2', effectiveDate: monthsAgo(96), grossAnnual: 545000, changeType: 'job_change' },
      { id: 'demo-sal-5', jobId: 'demo-job-2', effectiveDate: monthsAgo(84), grossAnnual: 568000, changeType: 'raise' },
      { id: 'demo-sal-6', jobId: 'demo-job-2', effectiveDate: monthsAgo(72), grossAnnual: 610000, changeType: 'promotion', notes: 'Teamlead' },
      { id: 'demo-sal-7', jobId: 'demo-job-2', effectiveDate: monthsAgo(60), grossAnnual: 632000, changeType: 'raise' },
      { id: 'demo-sal-8', jobId: 'demo-job-2', effectiveDate: monthsAgo(42), grossAnnual: 655000, changeType: 'adjustment' },

      { id: 'demo-sal-9', jobId: 'demo-job-3', effectiveDate: monthsAgo(30), grossAnnual: 690000, changeType: 'job_change' },
      { id: 'demo-sal-10', jobId: 'demo-job-3', effectiveDate: monthsAgo(18), grossAnnual: 715000, changeType: 'raise' },
      { id: 'demo-sal-11', jobId: 'demo-job-3', effectiveDate: monthsAgo(6), grossAnnual: 744000, changeType: 'raise' },
    ],
    // Left out of the budget (no includeInBudget) so these enrich the salary
    // views without quietly inflating the demo's monthly income.
    bonuses: [
      { id: 'demo-bon-1', date: dayThisMonth(1), amount: 40000, type: 'annual', jobId: 'demo-job-3' },
      { id: 'demo-bon-2', date: dayMonthsAgo(7, 12), amount: 18500, type: 'holiday_pay', jobId: 'demo-job-3' },
      { id: 'demo-bon-3', date: dayMonthsAgo(12, 15), amount: 35000, type: 'annual', jobId: 'demo-job-3' },
      { id: 'demo-bon-4', date: dayMonthsAgo(24, 10), amount: 28000, type: 'performance', jobId: 'demo-job-3' },
      { id: 'demo-bon-5', date: dayMonthsAgo(30, 5), amount: 25000, type: 'signing', jobId: 'demo-job-3' },
      { id: 'demo-bon-6', date: dayMonthsAgo(45, 14), amount: 22000, type: 'annual', jobId: 'demo-job-2' },
    ],
    overtime: [
      { id: 'demo-ot-1', date: dayMonthsAgo(1, 20), hours: 12, amount: 7800, jobId: 'demo-job-3' },
      { id: 'demo-ot-2', date: dayMonthsAgo(2, 18), hours: 8, amount: 5200, jobId: 'demo-job-3' },
      { id: 'demo-ot-3', date: dayMonthsAgo(4, 22), hours: 16, amount: 10400, jobId: 'demo-job-3', notes: 'Produksjonsinsident' },
      { id: 'demo-ot-4', date: dayMonthsAgo(6, 9), hours: 6, amount: 3900, jobId: 'demo-job-3' },
      { id: 'demo-ot-5', date: dayMonthsAgo(9, 25), hours: 10, amount: 6500, jobId: 'demo-job-3' },
    ],
    // Actual hours worked against the 37.5 contracted, so the hours-vs-contract
    // comparison has a real spread instead of a single flat month.
    hoursSnapshots: [
      { id: 'demo-hs-1', periodMonth: monthsAgo(0), actualHoursPerWeek: 39.5, jobId: 'demo-job-3' },
      { id: 'demo-hs-2', periodMonth: monthsAgo(1), actualHoursPerWeek: 41, jobId: 'demo-job-3' },
      { id: 'demo-hs-3', periodMonth: monthsAgo(2), actualHoursPerWeek: 38, jobId: 'demo-job-3' },
      { id: 'demo-hs-4', periodMonth: monthsAgo(3), actualHoursPerWeek: 37.5, jobId: 'demo-job-3' },
      { id: 'demo-hs-5', periodMonth: monthsAgo(4), actualHoursPerWeek: 40, jobId: 'demo-job-3' },
      { id: 'demo-hs-6', periodMonth: monthsAgo(5), actualHoursPerWeek: 36, jobId: 'demo-job-3' },
    ],

    goals: [
      { id: 'demo-goal-1', name: 'Bufferkonto', target: 100000, source: 'bufferAccount' },
      { id: 'demo-goal-2', name: 'Oppussing', target: 150000, source: 'manual', manualCurrent: 40000 },
      { id: 'demo-goal-3', name: 'Sommerferie', target: 50000, source: 'savingsAccount', savingsAccountId: 'demo-sav-2' },
    ],

    savingsAllocations: [
      { id: 'demo-alloc-1', percent: 40, destinationKind: 'portfolio' },
      { id: 'demo-alloc-2', percent: 25, destinationKind: 'bufferAccount' },
      { id: 'demo-alloc-3', percent: 25, destinationKind: 'mortgage' },
      { id: 'demo-alloc-4', percent: 10, destinationKind: 'savingsAccount', savingsAccountId: 'demo-sav-2' },
    ],

    secondHomeScenarios: [
      {
        id: 'demo-sh-1', name: 'Utleieleilighet', strategy: 'rent',
        purchasePrice: 3800000, dokumentavgiftPct: 2.5, tinglysingsgebyr: 585, otherPurchaseCosts: 0,
        equityShare: 0.25, mortgageRatePct: 5.5, termYears: 25,
        monthlyRent: 14500, vacancyPct: 5, monthlyOperatingCosts: 2800, deductibleCostsAnnual: 33600,
        renovationCost: 0, afterRepairValue: 3800000, refinanceLtvPct: 75,
        holdYears: 10, annualAppreciationPct: 3, saleAgentFeePct: 3, documentedImprovements: 0,
        marginalWealthTaxPct: 0.85, committed: true,
      },
      {
        id: 'demo-sh-2', name: 'Oppussingsprosjekt', strategy: 'brrr',
        purchasePrice: 2600000, dokumentavgiftPct: 2.5, tinglysingsgebyr: 585, otherPurchaseCosts: 0,
        equityShare: 0.25, mortgageRatePct: 5.7, termYears: 25,
        monthlyRent: 12000, vacancyPct: 5, monthlyOperatingCosts: 2200, deductibleCostsAnnual: 26400,
        renovationCost: 400000, afterRepairValue: 3400000, refinanceLtvPct: 75,
        holdYears: 8, annualAppreciationPct: 3, saleAgentFeePct: 3, documentedImprovements: 400000,
        marginalWealthTaxPct: 0.85, committed: false,
      },
    ],
    boligAssumptions: DEFAULT_BOLIG_ASSUMPTIONS,
  };
}
