import { createContext, useContext, useState, useEffect, useRef, useMemo, type ReactNode } from 'react';
import {
  getDaysInMonth,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  parseISO,
  format,
  subMonths
} from 'date-fns';
import { calcRecommendations } from '../lib/calculations';

// --- Types ---

export interface FixedExpense {
  id: string;
  name: string;
  amount: number;
}

export interface DailyTransaction {
  id: string;
  date: string; // ISO string
  description: string;
  amount: number;
  category?: string;
}

export interface TransactionTemplate {
  id: string;
  description: string;
  amount: number;
  category?: string;
}

export interface Assets {
  portfolio: number;
  unrealizedGain: number;
  taxRate: number;
  bsu: number;
  savings: number;
  houseValue: number;
  houseDebt: number;
  crypto: number;
  cryptoUnrealizedGain: number;
  cryptoTaxRate: number;
  bufferAccount: number;
}

export interface LoanData {
  arslonn: number;
  eksisterendeGjeld: number;
  egenkapital: number;
  laanebelop: number;
  rente: number;
  nedbetalingstid: number;
  termingebyr: number;
  etableringsgebyr: number;
  skattefradragssats: number;
  betingetLaan: number;
  kjoepesum: number;
  gyldigTil: string;
}

export type Language = 'en' | 'nb';

export type HousingMode = 'first_buyer' | 'homeowner' | 'transitioning';

export interface HomeownerData {
  currentMortgageBalance: number;
  originalLoanAmount: number;
  rente: number;
  nedbetalingstid: number;
  termingebyr: number;
  skattefradragssats: number;
}

export interface TransitionData {
  currentHouseValue: number;
  currentMortgageBalance: number;
  agentFeePercent: number;
  documentFee: number;
  otherSaleCosts: number;
  bridgeMonths: number;
  bridgeLoanRate: number;
}

// --- Translations ---

export const translations = {
  nb: {
    title: 'Headroom',
    subtitle: 'Administrer din personlige økonomi',
    systemActive: 'System Aktiv // Overvåker Portefølje',
    monthlyIncome: 'Månedsinntekt',
    totalEquity: 'Total Egenkapital',
    monthlyBudget: 'Budsjett / Måned',
    dailyBudget: 'Budsjett / Dag',
    assetInventory: 'Formuesoversikt',
    marketPositions: 'Markedsposisjoner',
    realEstate: 'Boligverdier',
    cashReserves: 'Likviditetsreserver',
    portfolio: 'Investeringsportefølje',
    unrealizedGain: 'Urealisert gevinst',
    taxRate: 'Skattesats',
    liabilityReserve: 'Latent Skatt (Beregnet)',
    netLiquidity: 'Netto Likviditetsposisjon',
    houseValue: 'Boligverdi',
    houseDebt: 'Boliggjeld',
    propertyEquity: 'Boligegenkapital',
    bsu: 'BSU-konto',
    savings: 'Sparekonto',
    trueNetEquity: 'Faktisk Egenkapital etter Skatt',
    grossAssets: 'Brutto Formue',
    liabilities: 'Gjeld & Skatt',
    fixedCosts: 'Faste Utgifter',
    distributionAnalysis: 'Fordelingsanalyse',
    operationalLog: 'Forbrukslogg',
    timestamp: 'Tidspunkt',
    transactionDetails: 'Transaksjonsdetaljer',
    impact: 'Effekt',
    runningBalance: 'Budsjettbalanse',
    endPeriodSurplus: 'Overskudd ved periodeslutt',
    aggregate: 'Totalt',
    allocation: 'Allokering',
    editIncome: 'Sett månedsinntekt:',
    newExpenseName: 'Navn på utgift:',
    newAmount: 'Beløp:',
    editName: 'Nytt navn:',
    editAmount: 'Nytt beløp:',
    editDescription: 'Ny beskrivelse:',
    days: ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'],
    cancel: 'Avbryt',
    save: 'Lagre',
    delete: 'Slett',
    confirmDelete: 'Bekreft sletting',
    confirmDeleteExpenseMsg: 'Er du sikker på at du vil slette denne utgiften?',
    confirmDeleteTransactionMsg: 'Er du sikker på at du vil slette denne transaksjonen?',
    templates: 'Maler',
    addTemplate: 'Ny mal',
    exportCSV: 'Eksporter CSV',
    category: 'Kategori',
    uncategorized: 'Ukategorisert',
    growthProjection: 'Vekstprognose',
    annualReturn: 'Forventet avkastning (% p.a.)',
    projectedNetWorth: 'Beregnet formue',
    amortizationSchedule: 'Nedbetalingsplan',
    year: 'År',
    annualPayment: 'Årsbeløp',
    principalPayment: 'Avdrag',
    interestPayment: 'Renter',
    remainingBalance: 'Restgjeld',
    showSchedule: 'Vis nedbetalingsplan',
    hideSchedule: 'Skjul plan',
    monthSpent: 'Brukt denne måneden',
    remainingBudget: 'Gjenstående budsjett',
    loanCapacity: 'Låneevne',
    overviewTitle: 'Oversikt',
    budgetHealth: 'Budsjettfordeling',
    assetAllocation: 'Formuesfordeling',
    recentTransactions: 'Siste transaksjoner',
    noTransactions: 'Ingen transaksjoner denne måneden',
    investmentNet: 'Investering (netto)',
    propertyEquityShort: 'Boligegenkapital',
    cashTotal: 'Kontanter',
    importExportTitle: 'Import / Eksport',
    exportSection: 'Eksport',
    exportDesc: 'Last ned alle dataene dine som en JSON-fil for sikkerhetskopiering eller migrering.',
    importSection: 'Import',
    importDesc: 'Gjenopprett data fra en tidligere eksportert JSON-fil.',
    importWarning: 'Dette vil erstatte alle eksisterende data.',
    downloadJSON: 'Last ned JSON',
    chooseFile: 'Slipp JSON-fil her eller klikk for å bla',
    replaceData: 'Erstatt alle data',
    importReadyTitle: 'Klar til import',
    invalidFile: 'Ugyldig fil — forventet en budget-eksport JSON.',
    crypto: 'Kryptoaktiva',
    cryptoPortfolio: 'Kryptoportefølje',
    cryptoGain: 'Urealisert gevinst (krypto)',
    cryptoTaxRate: 'Skattesats (krypto)',
    cryptoTaxLabel: 'Latent skatt (krypto)',
    netCrypto: 'Netto krypto',
    bufferAccount: 'Bufferkonto',
    smartRecommendations: 'Smarte anbefalinger',
    canSpend: 'Kan bruke',
    shouldInvest: 'Investering',
    avgIncome: 'Snittinntekt',
    conservativeWarning: 'Inntekt under snitt — sparemål økt med 10%',
    spentOfRecommended: 'av anbefalt',
    savingsTarget: 'Sparemål',
    funBudget: 'Morsomme penger',
    funBudgetAllocated: 'Budsjett',
    funBudgetSpent: 'Brukt',
    funBudgetRemaining: 'Igjen',
    funBudgetOverspent: 'Overskredet med',
    residual: 'Budsjettbalanse',
    housingModeFirstBuyer: 'Førstegangskjøper',
    housingModeHomeowner: 'Boligeier',
    housingModeTransitioning: 'Kjøpe & selge',
    currentMortgageBalance: 'Restgjeld',
    originalLoanAmount: 'Opprinnelig lånebeløp',
    yearsRemaining: 'Gjenværende år',
    monthlyPaymentCalc: 'Månedlig betaling',
    equityPercent: 'Egenkapitalprosent',
    editInAssets: '→ Rediger i Formue',
    annualTaxBenefit: 'Skattelettelse per år',
    currentHouseValue: 'Antatt salgsverdi',
    agentFeePercent: 'Meglerprovisjon (%)',
    documentFee: 'Tinglysingsgebyr',
    otherSaleCosts: 'Andre salgskostnader',
    agentCost: 'Meglerkostnad',
    netSaleProceeds: 'Netto salgsproveny',
    bridgeMonths: 'Mellomfinansieringsperiode (mnd)',
    bridgeLoanRate: 'Rente mellomfinansiering (%)',
    bridgeCost: 'Mellomfinansieringskostnad',
    equityFromSale: 'Egenkapital fra salg',
    additionalEquity: 'Ekstra egenkapital',
    totalEquityNew: 'Total egenkapital',
    newLoanNeeded: 'Nytt lånebehov',
    newMonthlyPayment: 'Ny månedlig betaling',
    totalTransactionCosts: 'Totale transaksjonskostnader',
    saleCard: 'Salg av nåværende bolig',
    bridgeCard: 'Mellomfinansieringsperiode',
    newHouseCard: 'Ny bolig – lånekalkulator',
    summaryCard: 'Transaksjonsoppsummering',
    netWorthHistory: 'Formuesutvikling',
    vsLastMonth: 'vs. forrige mnd',
    buildingHistory: 'Samler formuesdata...',
    nav: {
      budget: 'Budsjett',
      assets: 'Formue',
      loan: 'Boliglån',
      dashboard: 'Oversikt',
    }
  },
  en: {
    title: 'Headroom',
    subtitle: 'Manage your personal finances',
    systemActive: 'System Active // Monitoring Portfolio',
    monthlyIncome: 'Monthly Income',
    totalEquity: 'Total Net Equity',
    monthlyBudget: 'Budget / Month',
    dailyBudget: 'Budget / Day',
    assetInventory: 'Asset Inventory',
    marketPositions: 'Market Positions',
    realEstate: 'Real Estate Assets',
    cashReserves: 'Cash Reserves',
    portfolio: 'Investment Portfolio',
    unrealizedGain: 'Unrealized Gain',
    taxRate: 'Tax Rate',
    liabilityReserve: 'Liability Reserve (Tax)',
    netLiquidity: 'Net Liquidity Position',
    houseValue: 'Property Value',
    houseDebt: 'Mortgage Debt',
    propertyEquity: 'Property Equity',
    bsu: 'BSU Account',
    savings: 'Savings Account',
    trueNetEquity: 'True Net Equity Post-Tax',
    grossAssets: 'Gross Assets',
    liabilities: 'Liabilities & Tax',
    fixedCosts: 'Fixed Costs',
    distributionAnalysis: 'Distribution Analysis',
    operationalLog: 'Spending Log',
    timestamp: 'Timestamp',
    transactionDetails: 'Transaction Details',
    impact: 'Impact',
    runningBalance: 'Running Balance',
    endPeriodSurplus: 'End of Period Surplus',
    aggregate: 'Aggregate',
    allocation: 'Allocation',
    editIncome: 'Set monthly income:',
    newExpenseName: 'Expense name:',
    newAmount: 'Amount:',
    editName: 'New name:',
    editAmount: 'New amount:',
    editDescription: 'New description:',
    days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    confirmDelete: 'Confirm Delete',
    confirmDeleteExpenseMsg: 'Are you sure you want to delete this expense?',
    confirmDeleteTransactionMsg: 'Are you sure you want to delete this transaction?',
    templates: 'Templates',
    addTemplate: 'New Template',
    exportCSV: 'Export CSV',
    category: 'Category',
    uncategorized: 'Uncategorized',
    growthProjection: 'Growth Projection',
    annualReturn: 'Expected Return (% p.a.)',
    projectedNetWorth: 'Projected Net Worth',
    amortizationSchedule: 'Amortization Schedule',
    year: 'Year',
    annualPayment: 'Annual Payment',
    principalPayment: 'Principal',
    interestPayment: 'Interest',
    remainingBalance: 'Remaining Balance',
    showSchedule: 'Show schedule',
    hideSchedule: 'Hide schedule',
    monthSpent: 'Spent This Month',
    remainingBudget: 'Remaining Budget',
    loanCapacity: 'Loan Capacity',
    overviewTitle: 'Overview',
    budgetHealth: 'Budget Breakdown',
    assetAllocation: 'Asset Allocation',
    recentTransactions: 'Recent Transactions',
    noTransactions: 'No transactions this month',
    investmentNet: 'Investment (net)',
    propertyEquityShort: 'Property Equity',
    cashTotal: 'Cash',
    importExportTitle: 'Import / Export',
    exportSection: 'Export',
    exportDesc: 'Download all your data as a JSON file for backup or migration.',
    importSection: 'Import',
    importDesc: 'Restore data from a previously exported JSON file.',
    importWarning: 'This will replace all current data.',
    downloadJSON: 'Download JSON',
    chooseFile: 'Drop JSON file here or click to browse',
    replaceData: 'Replace All Data',
    importReadyTitle: 'Ready to import',
    invalidFile: 'Invalid file — expected a budget export JSON.',
    crypto: 'Crypto Assets',
    cryptoPortfolio: 'Crypto Portfolio',
    cryptoGain: 'Unrealized Gain (crypto)',
    cryptoTaxRate: 'Tax Rate (crypto)',
    cryptoTaxLabel: 'Deferred Tax (crypto)',
    netCrypto: 'Net Crypto',
    bufferAccount: 'Buffer Account',
    smartRecommendations: 'Smart Recommendations',
    canSpend: 'Can Spend',
    shouldInvest: 'Investment',
    avgIncome: 'Avg Income',
    conservativeWarning: 'Income below average — savings target increased by 10%',
    spentOfRecommended: 'of recommended',
    savingsTarget: 'Savings Target',
    funBudget: 'Fun Budget',
    funBudgetAllocated: 'Budget',
    funBudgetSpent: 'Spent',
    funBudgetRemaining: 'Remaining',
    funBudgetOverspent: 'Over budget by',
    residual: 'Budget Balance',
    housingModeFirstBuyer: 'First-time Buyer',
    housingModeHomeowner: 'Homeowner',
    housingModeTransitioning: 'Buy & Sell',
    currentMortgageBalance: 'Current Mortgage Balance',
    originalLoanAmount: 'Original Loan Amount',
    yearsRemaining: 'Years Remaining',
    monthlyPaymentCalc: 'Monthly Payment',
    equityPercent: 'Equity Percentage',
    editInAssets: '→ Edit in Assets',
    annualTaxBenefit: 'Annual Tax Benefit',
    currentHouseValue: 'Estimated Sale Price',
    agentFeePercent: 'Agent Fee (%)',
    documentFee: 'Document Fee',
    otherSaleCosts: 'Other Sale Costs',
    agentCost: 'Agent Cost',
    netSaleProceeds: 'Net Sale Proceeds',
    bridgeMonths: 'Bridge Loan Duration (months)',
    bridgeLoanRate: 'Bridge Loan Rate (%)',
    bridgeCost: 'Bridge Loan Cost',
    equityFromSale: 'Equity from Sale',
    additionalEquity: 'Additional Equity',
    totalEquityNew: 'Total Equity',
    newLoanNeeded: 'New Loan Required',
    newMonthlyPayment: 'New Monthly Payment',
    totalTransactionCosts: 'Total Transaction Costs',
    saleCard: 'Selling Current Property',
    bridgeCard: 'Bridge Financing Period',
    newHouseCard: 'New Property – Calculator',
    summaryCard: 'Transaction Summary',
    netWorthHistory: 'Net Worth History',
    vsLastMonth: 'vs. last month',
    buildingHistory: 'Building history...',
    nav: {
      budget: 'Budget',
      assets: 'Assets',
      loan: 'Loan',
      dashboard: 'Overview',
    }
  }
};

const DEFAULT_FIXED_EXPENSES: FixedExpense[] = [
  { id: '1', name: 'Huslån',          amount: 12000 },
  { id: '2', name: 'Felleskostnader', amount: 3000  },
  { id: '3', name: 'Forsikring',      amount: 400   },
  { id: '4', name: 'Strøm',           amount: 1000  },
  { id: '5', name: 'Trening',         amount: 500   },
  { id: '6', name: 'Mobil',           amount: 400   },
  { id: '7', name: 'Mat',             amount: 5000  },
  { id: '8', name: 'Sparing',         amount: 5000  },
];

const DEFAULT_ASSETS: Assets = {
  portfolio: 0,
  unrealizedGain: 0,
  taxRate: 37.84,
  bsu: 0,
  savings: 0,
  houseValue: 0,
  houseDebt: 0,
  crypto: 0,
  cryptoUnrealizedGain: 0,
  cryptoTaxRate: 22,
  bufferAccount: 0,
};

const DEFAULT_HOMEOWNER: HomeownerData = {
  currentMortgageBalance: 3000000,
  originalLoanAmount: 3500000,
  rente: 5.5,
  nedbetalingstid: 25,
  termingebyr: 50,
  skattefradragssats: 22,
};

const DEFAULT_TRANSITION: TransitionData = {
  currentHouseValue: 4500000,
  currentMortgageBalance: 3000000,
  agentFeePercent: 3,
  documentFee: 7500,
  otherSaleCosts: 0,
  bridgeMonths: 2,
  bridgeLoanRate: 6.5,
};

const DEFAULT_LOAN: LoanData = {
  arslonn: 600000,
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
  gyldigTil: '1. jan 2027',
};

// --- Context ---

interface FinanceContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: typeof translations.nb;
  displayCurrency: 'NOK' | 'USD' | 'custom';
  setDisplayCurrency: (c: 'NOK' | 'USD' | 'custom') => void;
  nokToUsd: number;
  setNokToUsd: (rate: number) => void;
  customCurrencyCode: string;
  setCustomCurrencyCode: (code: string) => void;
  customCurrencyRate: number;
  setCustomCurrencyRate: (rate: number) => void;
  isDarkMode: boolean;
  setIsDarkMode: (val: boolean) => void;
  currentMonth: Date;
  setCurrentMonth: (date: Date) => void;
  income: number;
  setIncome: (val: number) => void;
  monthlyIncomes: Record<string, number>;
  setMonthlyIncomeForMonth: (monthKey: string, amount: number) => void;
  netWorthHistory: Record<string, number>;
  prevMonthIncome: number;
  prevMonthSpending: number;
  effectiveIncome: number;
  averageIncome: number;
  savingsTargetPercent: number;
  setSavingsTargetPercent: (val: number) => void;
  recommendedSpending: number;
  recommendedInvestment: number;
  conservativeMode: boolean;
  fixedExpenses: FixedExpense[];
  setFixedExpenses: (val: FixedExpense[]) => void;
  dailyTransactions: DailyTransaction[];
  setDailyTransactions: (val: DailyTransaction[]) => void;
  recurringTemplates: TransactionTemplate[];
  setRecurringTemplates: (val: TransactionTemplate[]) => void;
  assets: Assets;
  updateAsset: (key: keyof Assets, value: number) => void;
  loan: LoanData;
  updateLoan: (key: keyof LoanData, value: number | string) => void;
  housingMode: HousingMode;
  setHousingMode: (mode: HousingMode) => void;
  homeowner: HomeownerData;
  updateHomeowner: (key: keyof HomeownerData, value: number) => void;
  transition: TransitionData;
  updateTransition: (key: keyof TransitionData, value: number) => void;
  growthReturnRate: number;
  setGrowthReturnRate: (val: number) => void;
  totalResidual: number;
  totalFixedExpenses: number;
  monthlyBudget: number;
  dailyBudget: number;
  dailyData: DailyDataEntry[];
  totalEquity: number;
  taxOnGain: number;
  netInvestment: number;
  houseEquity: number;
  cryptoTaxOnGain: number;
  netCrypto: number;
  formatCurrency: (val: number) => string;
  importAll: (data: Partial<ExportPayload>) => void;
}

export interface ExportPayload {
  income: number;
  fixedExpenses: FixedExpense[];
  dailyTransactions: DailyTransaction[];
  assets: Assets;
  loan: LoanData;
  recurringTemplates: TransactionTemplate[];
  monthlyIncomes?: Record<string, number>;
  netWorthHistory?: Record<string, number>;
  housingMode?: HousingMode;
  homeowner?: HomeownerData;
  transition?: TransitionData;
  lang?: Language;
  isDarkMode?: boolean;
  currentMonth?: string;
  savingsTargetPercent?: number;
  growthReturnRate?: number;
  displayCurrency?: 'NOK' | 'USD' | 'custom';
  nokToUsd?: number;
  customCurrencyCode?: string;
  customCurrencyRate?: number;
}

export interface DailyDataEntry {
  date: Date;
  dateStr: string;
  spent: number;
  balance: number;
  transactions: DailyTransaction[];
}

const FinanceContext = createContext<FinanceContextType | undefined>(undefined);

export function FinanceProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>('nb');
  const [displayCurrency, setDisplayCurrency] = useState<'NOK' | 'USD' | 'custom'>('NOK');
  const [nokToUsd, setNokToUsdState] = useState<number>(0.093);
  const [customCurrencyCode, setCustomCurrencyCode] = useState<string>('');
  const [customCurrencyRate, setCustomCurrencyRate] = useState<number>(1);

  const setNokToUsd = (rate: number) => setNokToUsdState(rate);

  const t = translations[lang];

  const [currentMonth, setCurrentMonth] = useState<Date>(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });

  const [income, setIncome] = useState<number>(55000);
  const [monthlyIncomes, setMonthlyIncomes] = useState<Record<string, number>>({});
  const [netWorthHistory, setNetWorthHistory] = useState<Record<string, number>>({});
  const [savingsTargetPercent, setSavingsTargetPercent] = useState<number>(20);
  const [fixedExpenses, setFixedExpenses] = useState<FixedExpense[]>(DEFAULT_FIXED_EXPENSES);
  const [dailyTransactions, setDailyTransactions] = useState<DailyTransaction[]>([]);
  const [recurringTemplates, setRecurringTemplates] = useState<TransactionTemplate[]>([]);
  const [assets, setAssets] = useState<Assets>(DEFAULT_ASSETS);
  const [loan, setLoan] = useState<LoanData>(DEFAULT_LOAN);
  const [housingMode, setHousingMode] = useState<HousingMode>('first_buyer');
  const [homeowner, setHomeowner] = useState<HomeownerData>(DEFAULT_HOMEOWNER);
  const [transition, setTransition] = useState<TransitionData>(DEFAULT_TRANSITION);
  const [growthReturnRate, setGrowthReturnRate] = useState<number>(7);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);

  const loaded = useRef(false);

  useEffect(() => {
    fetch('/api/data')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setIncome(data.income ?? 55000);
          setMonthlyIncomes(data.monthlyIncomes ?? {});
          setNetWorthHistory(data.netWorthHistory ?? {});
          setFixedExpenses(data.fixedExpenses ?? DEFAULT_FIXED_EXPENSES);
          setDailyTransactions(data.dailyTransactions ?? []);
          setAssets({ ...DEFAULT_ASSETS, ...(data.assets ?? {}) });
          setLoan(data.loan ?? DEFAULT_LOAN);
          setRecurringTemplates(data.recurringTemplates ?? []);
          setHousingMode(data.housingMode ?? 'first_buyer');
          setHomeowner({ ...DEFAULT_HOMEOWNER, ...(data.homeowner ?? {}) });
          setTransition({ ...DEFAULT_TRANSITION, ...(data.transition ?? {}) });
          if (data.lang) setLang(data.lang);
          if (data.isDarkMode !== undefined) setIsDarkMode(data.isDarkMode);
          if (data.currentMonth) {
            const [y, m] = data.currentMonth.split('-').map(Number);
            if (!isNaN(y) && !isNaN(m)) setCurrentMonth(new Date(y, m - 1, 1));
          }
          if (data.savingsTargetPercent !== undefined) setSavingsTargetPercent(data.savingsTargetPercent);
          if (data.growthReturnRate !== undefined) setGrowthReturnRate(data.growthReturnRate);
          if (data.displayCurrency) setDisplayCurrency(data.displayCurrency);
          if (data.nokToUsd !== undefined) setNokToUsdState(data.nokToUsd);
          if (data.customCurrencyCode !== undefined) setCustomCurrencyCode(data.customCurrencyCode);
          if (data.customCurrencyRate !== undefined) setCustomCurrencyRate(data.customCurrencyRate);
        }
      })
      .catch(() => {})
      .finally(() => { loaded.current = true; });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    const payload = {
      income, monthlyIncomes, netWorthHistory, fixedExpenses, dailyTransactions,
      assets, loan, recurringTemplates, housingMode, homeowner, transition,
      lang, isDarkMode, currentMonth: format(currentMonth, 'yyyy-MM'),
      savingsTargetPercent, growthReturnRate, displayCurrency, nokToUsd,
      customCurrencyCode, customCurrencyRate,
    };
    fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }, [income, monthlyIncomes, netWorthHistory, fixedExpenses, dailyTransactions, assets, loan, recurringTemplates, housingMode, homeowner, transition, lang, isDarkMode, currentMonth, savingsTargetPercent, growthReturnRate, displayCurrency, nokToUsd, customCurrencyCode, customCurrencyRate]);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // --- Calculations ---

  const totalFixedExpenses = useMemo(() =>
    fixedExpenses.reduce((sum, item) => sum + item.amount, 0),
  [fixedExpenses]);

  const monthKey = format(currentMonth, 'yyyy-MM');
  const prevMonthKey = format(subMonths(currentMonth, 1), 'yyyy-MM');
  const prevMonthIncome = monthlyIncomes[prevMonthKey] ?? 0;
  const prevMonthSpending = useMemo(() =>
    dailyTransactions
      .filter(t => t.date.startsWith(prevMonthKey))
      .reduce((sum, t) => sum + t.amount, 0),
  [dailyTransactions, prevMonthKey]);

  const effectiveIncome = useMemo(() =>
    monthlyIncomes[monthKey] ?? income,
  [monthlyIncomes, monthKey, income]);

  const averageIncome = useMemo(() => {
    const values = Object.values(monthlyIncomes);
    if (values.length === 0) return income;
    return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
  }, [monthlyIncomes, income]);

  const incomeVolatility = useMemo(() => {
    const values = Object.values(monthlyIncomes);
    if (values.length < 2) return 0;
    const mean = averageIncome;
    const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
    return Math.sqrt(variance) / mean;
  }, [monthlyIncomes, averageIncome]);

  const { recommendedSpending, recommendedInvestment, conservativeMode } = useMemo(() =>
    calcRecommendations(effectiveIncome, averageIncome, totalFixedExpenses, incomeVolatility, savingsTargetPercent),
  [effectiveIncome, averageIncome, totalFixedExpenses, incomeVolatility, savingsTargetPercent]);

  const setMonthlyIncomeForMonth = (key: string, amount: number) => {
    setMonthlyIncomes(prev => ({ ...prev, [key]: amount }));
  };

  const totalResidual = effectiveIncome - totalFixedExpenses;
  const monthlyBudget = recommendedSpending;
  const daysInMonth = getDaysInMonth(currentMonth);
  const dailyBudget = monthlyBudget / daysInMonth;

  const monthInterval = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const transactionsForMonth = useMemo(() => {
    return dailyTransactions.filter(t => {
      const date = parseISO(t.date);
      return date >= startOfMonth(currentMonth) && date <= endOfMonth(currentMonth);
    });
  }, [dailyTransactions, currentMonth]);

  const dailyData: DailyDataEntry[] = useMemo(() => {
    let runningBalance = 0;
    return monthInterval.map((day) => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const dayTransactions = transactionsForMonth.filter(t => t.date === dateStr);
      const totalSpentToday = dayTransactions.reduce((sum, t) => sum + t.amount, 0);
      runningBalance += dailyBudget - totalSpentToday;
      return {
        date: day,
        dateStr,
        spent: totalSpentToday,
        balance: runningBalance,
        transactions: dayTransactions
      };
    });
  }, [monthInterval, transactionsForMonth, dailyBudget]);

  const taxOnGain = (assets.unrealizedGain * assets.taxRate) / 100;
  const netInvestment = assets.portfolio - taxOnGain;
  const houseEquity = assets.houseValue - assets.houseDebt;
  const cryptoTaxOnGain = (assets.cryptoUnrealizedGain * assets.cryptoTaxRate) / 100;
  const netCrypto = assets.crypto - cryptoTaxOnGain;
  const totalEquity = netInvestment + netCrypto + assets.bsu + assets.savings + assets.bufferAccount + houseEquity;

  // Snapshot current month's net worth whenever equity changes (only for the current real month)
  useEffect(() => {
    if (!loaded.current) return;
    if (monthKey !== format(new Date(), 'yyyy-MM')) return;
    setNetWorthHistory(prev => ({ ...prev, [monthKey]: Math.round(totalEquity) }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalEquity]);

  const updateAsset = (key: keyof Assets, value: number) => {
    setAssets(prev => ({ ...prev, [key]: value }));
  };

  const updateLoan = (key: keyof LoanData, value: number | string) => {
    setLoan(prev => ({ ...prev, [key]: value }));
  };

  const updateHomeowner = (key: keyof HomeownerData, value: number) => {
    setHomeowner(prev => ({ ...prev, [key]: value }));
  };

  const updateTransition = (key: keyof TransitionData, value: number) => {
    setTransition(prev => ({ ...prev, [key]: value }));
  };

  const importAll = (data: Partial<ExportPayload>) => {
    if (data.income !== undefined) setIncome(data.income);
    if (data.monthlyIncomes !== undefined) setMonthlyIncomes(data.monthlyIncomes);
    if (data.netWorthHistory !== undefined) setNetWorthHistory(data.netWorthHistory);
    if (data.fixedExpenses) setFixedExpenses(data.fixedExpenses);
    if (data.dailyTransactions) setDailyTransactions(data.dailyTransactions);
    if (data.assets) setAssets({ ...DEFAULT_ASSETS, ...data.assets });
    if (data.loan) setLoan(data.loan);
    if (data.recurringTemplates !== undefined) setRecurringTemplates(data.recurringTemplates);
    if (data.housingMode !== undefined) setHousingMode(data.housingMode);
    if (data.homeowner) setHomeowner({ ...DEFAULT_HOMEOWNER, ...data.homeowner });
    if (data.transition) setTransition({ ...DEFAULT_TRANSITION, ...data.transition });
    if (data.lang) setLang(data.lang);
    if (data.isDarkMode !== undefined) setIsDarkMode(data.isDarkMode);
    if (data.currentMonth) {
      const [y, m] = data.currentMonth.split('-').map(Number);
      if (!isNaN(y) && !isNaN(m)) setCurrentMonth(new Date(y, m - 1, 1));
    }
    if (data.savingsTargetPercent !== undefined) setSavingsTargetPercent(data.savingsTargetPercent);
    if (data.growthReturnRate !== undefined) setGrowthReturnRate(data.growthReturnRate);
    if (data.displayCurrency) setDisplayCurrency(data.displayCurrency);
    if (data.nokToUsd !== undefined) setNokToUsdState(data.nokToUsd);
    if (data.customCurrencyCode !== undefined) setCustomCurrencyCode(data.customCurrencyCode);
    if (data.customCurrencyRate !== undefined) setCustomCurrencyRate(data.customCurrencyRate);
  };

  const formatCurrency = (val: number) => {
    if (displayCurrency === 'USD') {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format(val * nokToUsd);
    }
    if (displayCurrency === 'custom' && customCurrencyCode) {
      const converted = val * customCurrencyRate;
      try {
        return new Intl.NumberFormat('en', {
          style: 'currency',
          currency: customCurrencyCode.toUpperCase(),
        }).format(converted);
      } catch {
        return `${customCurrencyCode.toUpperCase()} ${converted.toFixed(2)}`;
      }
    }
    return new Intl.NumberFormat(lang === 'nb' ? 'nb-NO' : 'en-US', {
      style: 'currency',
      currency: 'NOK',
    }).format(val);
  };

  return (
    <FinanceContext.Provider value={{
      lang, setLang, t, displayCurrency, setDisplayCurrency, nokToUsd, setNokToUsd,
      customCurrencyCode, setCustomCurrencyCode, customCurrencyRate, setCustomCurrencyRate,
      isDarkMode, setIsDarkMode,
      currentMonth, setCurrentMonth, income, setIncome,
      monthlyIncomes, setMonthlyIncomeForMonth,
      netWorthHistory, prevMonthIncome, prevMonthSpending,
      effectiveIncome, averageIncome,
      savingsTargetPercent, setSavingsTargetPercent,
      recommendedSpending, recommendedInvestment, conservativeMode,
      fixedExpenses, setFixedExpenses, dailyTransactions, setDailyTransactions,
      recurringTemplates, setRecurringTemplates,
      assets, updateAsset, loan, updateLoan,
      housingMode, setHousingMode, homeowner, updateHomeowner, transition, updateTransition,
      growthReturnRate, setGrowthReturnRate,
      totalResidual,
      totalFixedExpenses, monthlyBudget, dailyBudget,
      dailyData, totalEquity, taxOnGain, netInvestment, houseEquity, cryptoTaxOnGain, netCrypto,
      formatCurrency, importAll
    }}>
      {children}
    </FinanceContext.Provider>
  );
}

export function useFinance() {
  const context = useContext(FinanceContext);
  if (context === undefined) {
    throw new Error('useFinance must be used within a FinanceProvider');
  }
  return context;
}
