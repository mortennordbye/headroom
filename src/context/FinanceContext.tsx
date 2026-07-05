import { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from 'react';
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
import type { ConservativeReason } from '../lib/calculations';
import { computeEquityBreakdown } from '../lib/equity';
import { calcTaxByRegion } from '../lib/norwegianTax';
import { getDemoData } from '../lib/demoData';
import {
  type EmployerCostConfig,
  type BillingRateConfig,
  DEFAULT_EMPLOYER_COST_CONFIG,
  DEFAULT_BILLING_CONFIG,
} from '../lib/employerCost';

// --- Types ---

// Category of a fixed expense — drives its colour role in the budget charts.
export type ExpenseType = 'fixed' | 'variable' | 'subscription' | 'insurance';

export interface FixedExpense {
  id: string;
  name: string;
  amount: number;
  type?: ExpenseType; // optional for back-compat with older stored/imported data
}

// Non-mortgage debts (studielån, forbrukslån, kredittkort, …). Modeled separately
// from the mortgage (which lives in Assets.houseDebt) and reduce net worth.
export type DebtType = 'student' | 'consumer' | 'credit_card' | 'other';

export interface Debt {
  id: string;
  name: string;
  type: DebtType;
  balance: number;      // current outstanding principal
  rate: number;         // annual nominal interest rate, %
  minPayment: number;   // normal monthly payment
}

export interface DailyTransaction {
  id: string;
  date: string; // ISO string
  description: string;
  amount: number;
  category?: string;
  /**
   * Whether this row is money out ('expense') or money in ('income'). Income is
   * excluded from "spent" / burn-rate / category charts and instead adds to the
   * running balance. Missing on legacy rows — treat undefined as 'expense'.
   */
  kind?: 'income' | 'expense';
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

export interface Pension {
  otpBalance: number;                  // OTP (employer-mandated) current balance in kr
  otpEmployerPct: number;              // % of gross salary employer pays (typ 2–7)
  otpEmployeePct: number;              // optional employee top-up % (0 default)
  otpGrowthRate: number;               // annual return % (default 5%)
  ipsBalance: number;                  // IPS (voluntary) current balance in kr
  ipsAnnualContribution: number;       // kr/year (NAV cap 15 000 in 2025)
  ipsGrowthRate: number;               // annual return % (default 7%)
  birthYear: number;                   // 0 = unset
  retirementAge: number;               // default 67
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

export type Region = 'no' | 'generic';

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

// --- Salary tracker types ---

export interface JobEntry {
  id: string;
  startDate: string;              // 'YYYY-MM'
  endDate: string | null;         // null = current
  employer: string;
  role: string;
  contractedHoursPerWeek: number; // e.g. 37.5
  onCallAnnual?: number | null;   // extra gross income per year from on-call rotation
  notes?: string;
}

export type SalaryChangeType = 'initial' | 'raise' | 'promotion' | 'job_change' | 'adjustment';

export interface SalaryEntry {
  id: string;
  jobId: string;
  effectiveDate: string;          // 'YYYY-MM'
  grossAnnual: number;            // NOK
  changeType: SalaryChangeType;
  notes?: string;
}

/**
 * Total gross annual employment income (base + on-call) active in a given month.
 * Picks the latest applicable salary PER job (so salary history works) and SUMS
 * across all jobs that are still active that month (so concurrent jobs count).
 * Must aggregate before tax — progressive brackets apply to combined income.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function calcActiveGrossAnnual(
  salaries: SalaryEntry[],
  jobs: JobEntry[],
  monthKey: string,
): number {
  const eligible = salaries.filter(s => s.effectiveDate <= monthKey);
  if (eligible.length === 0) return 0;
  const latestPerJob = new Map<string, SalaryEntry>();
  for (const s of eligible) {
    const cur = latestPerJob.get(s.jobId);
    if (!cur || s.effectiveDate > cur.effectiveDate) latestPerJob.set(s.jobId, s);
  }
  let total = 0;
  for (const [jobId, sal] of latestPerJob) {
    const job = jobs.find(j => j.id === jobId);
    if (job?.endDate && job.endDate < monthKey) continue; // skip jobs that ended before this month
    total += sal.grossAnnual + (job?.onCallAnnual ?? 0);
  }
  return total;
}

export type BonusType = 'annual' | 'performance' | 'signing' | 'holiday_pay' | 'profit_share' | 'other';

export interface BonusEntry {
  id: string;
  date: string;                   // 'YYYY-MM-DD'
  amount: number;                 // gross NOK
  type: BonusType;
  jobId?: string;                 // optional FK to JobEntry — undefined = unassigned
  notes?: string;
}

export interface OvertimeEntry {
  id: string;
  date: string;                   // 'YYYY-MM-DD'
  hours: number;
  amount: number;                 // gross NOK paid
  jobId?: string;                 // optional FK to JobEntry — undefined = unassigned
  notes?: string;
}

export interface HoursSnapshot {
  id: string;
  periodMonth: string;            // 'YYYY-MM'
  actualHoursPerWeek: number;
  jobId?: string;                 // optional FK to JobEntry — undefined = unassigned
  notes?: string;
}

/**
 * A payslip's actual figures for one month, imported from a PDF and stored
 * per month (keyed 'YYYY-MM') to give the budget real numbers instead of
 * tax-estimated ones. `net` also drives that month's budget income (via a
 * matching monthly-income override set at import time).
 */
export interface MonthlyPayslip {
  gross: number;        // period gross pay (Bruttolønn)
  net: number;          // period net pay (Netto til utbetaling)
  tax: number;          // period tax withheld (Forskuddstrekk), positive
  base: number;         // base monthly salary (Månedslønn)
  holidayPay?: number;  // holiday pay accrued this year (period column)
}

export interface InflationPoint {
  month: string;                  // 'YYYY-MM'
  cpiIndex: number;
  yoyPercent: number;
}

export type GoalSource = 'manual' | 'bsu' | 'savings' | 'totalEquity' | 'portfolio' | 'bufferAccount';

export interface Goal {
  id: string;
  name: string;
  target: number;                 // NOK
  source: GoalSource;
  manualCurrent?: number;         // used when source === 'manual'
  deadline?: string;              // optional 'YYYY-MM'
  notes?: string;
}

export interface WageStatPoint {
  year: number;
  median: number;                 // gross annual NOK, national median for full-time employees
}

// --- Translations ---

// This module deliberately co-locates the provider, the useFinance hook, types
// and the translations table; splitting them out is not worth the churn, so
// Fast Refresh's component-only export rule is disabled for these exports.
// eslint-disable-next-line react-refresh/only-export-components
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
    expenseTypeLabel: 'Type:',
    expenseType: { fixed: 'Fast', variable: 'Variabel', subscription: 'Abonnement', insurance: 'Forsikring' },
    debt: {
      title: 'Gjeld', add: 'Legg til gjeld', none: 'Ingen gjeld registrert.',
      name: 'Navn:', balance: 'Saldo:', rate: 'Rente (% p.a.):', minPayment: 'Månedlig betaling:', typeLabel: 'Type:',
      sum: 'Sum gjeld', payoffIn: 'Nedbetalt om', interestLabel: 'renter', never: 'Dekker ikke renten',
      planner: 'Nedbetalingsplan', strategy: 'Strategi', avalanche: 'Høyest rente først', snowball: 'Minst saldo først',
      extra: 'Ekstra per måned', debtFree: 'Gjeldfri om', totalInterest: 'Totale renter',
      interestSaved: 'Spart i renter', vsMinimum: 'vs. kun minstebetaling',
      types: { student: 'Studielån', consumer: 'Forbrukslån', credit_card: 'Kredittkort', other: 'Annet' },
    },
    editName: 'Nytt navn:',
    editAmount: 'Nytt beløp:',
    editDescription: 'Ny beskrivelse:',
    days: ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'],
    cancel: 'Avbryt',
    save: 'Lagre',
    delete: 'Slett',
    add: 'Legg til',
    edit: 'Rediger',
    txKind: 'Type',
    txIncome: 'Inntekt',
    txExpense: 'Utgift',
    charts: {
      income: 'Inntekt', expenses: 'Utgifter', net: 'Netto',
      cash: 'Kontanter', stocks: 'Aksjer', house: 'Bolig', crypto: 'Krypto', pension: 'Pensjon',
      netTakeHome: 'Netto', incomeTax: 'Inntektsskatt', bracketTax: 'Trinnskatt', socialSecurity: 'Trygdeavgift', tax: 'Skatt', effectiveRate: 'eff. skatt',
      covered: 'dekket', target: 'Mål', savingsRate: 'Spareandel', less: 'mindre', more: 'mer',
      ltv: 'Belåningsgrad', ltvCap: 'Maks 85 %',
      gross: 'Bruttolønn', savings: 'Sparing', discretionary: 'Fritt forbruk', fixedExpenses: 'Faste utgifter',
      buildsOverTime: 'Bygges opp etter hvert som du legger inn data.',
      cashflowTitle: 'Kontantstrøm', cashflowSub: 'Inn vs ut siste 12 måneder',
      compositionTitle: 'Formuessammensetning', compositionSub: 'Fordeling over tid',
      taxBreakdownTitle: 'Skattefordeling', taxBreakdownSub: 'Hvor bruttolønnen din går',
      emergencyFundTitle: 'Bufferkonto', emergencyFundSub: 'Måneder dekket',
      savingsRateTitle: 'Spareandel', savingsRateSub: 'Andel av inntekt igjen etter utgifter',
      heatmapTitle: 'Forbruksmønster', heatmapSub: 'Daglig forbruk denne måneden',
      ltvTitle: 'Belåningsgrad over tid', ltvSub: 'Synker når lånet nedbetales og boligen stiger i verdi',
      moneyFlowTitle: 'Pengestrøm', moneyFlowSub: 'Hvor månedslønnen går',
      allocationTitle: 'Formuesfordeling', allocationSub: 'Sammensetning akkurat nå', allocationCenter: 'Totalt',
      liquid: 'Tilgjengelig', locked: 'Bundet',
      liquidSub: 'Aksjer, kontanter, krypto', lockedSub: 'Boligegenkapital + pensjon',
      liquidLockedTitle: 'Tilgjengelig vs bundet', liquidLockedSub: 'Hvor mye du faktisk har tilgang til',
      debtPayoffTitle: 'Nedbetaling av lån', debtPayoffSub: 'Boliglånet ned mot null',
      debtFree: 'Gjeldfri på boligen — ingen boliglån å nedbetale.',
      mortgageToday: 'Boliglån i dag', debtFreeYear: 'Gjeldfri',
      plusOtherDebt: '+ {amount} annen gjeld (studielån/forbruk) — se oversikten over.',
    },
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
    bucketStocks: 'Aksjer',
    bucketCrypto: 'Krypto',
    bucketCash: 'Kontant/BSU',
    bucketHouse: 'Boligformue',
    pension: 'Pensjon',
    pensionWealth: 'Pensjonsformue',
    otpBalance: 'OTP-saldo',
    otpEmployerPct: 'OTP arbeidsgiver %',
    otpEmployeePct: 'OTP egen %',
    ipsBalance: 'IPS-saldo',
    ipsAnnualContribution: 'IPS årlig innskudd',
    ipsHint: 'Maks 15 000 kr/år gir skattefradrag (~22%).',
    retirementAge: 'Pensjonsalder',
    birthYear: 'Fødselsår',
    yearsToRetirement: 'år til pensjon',
    pensionAtRetirement: 'Pensjonsformue ved pensjon',
    otpGrowthRate: 'OTP-avkastning',
    ipsGrowthRate: 'IPS-avkastning',
    setBirthYearHint: 'Sett fødselsår i Innstillinger',
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
    conservativeWarning: 'Inntekt under snitt — vurder å spare 10% mer',
    volatileIncomeWarning: 'Uregelmessig inntekt — vurder å spare 10% mer',
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
      settings: 'Innstillinger',
      salary: 'Lønn',
      forecast: 'Prognose',
      pension: 'Pensjon',
      employerCost: 'Lønnskostnad',
      more: 'Mer',
    },
    employerCost: {
      heroLabel: 'Lønnskostnad',
      subtitle: 'Se hva du faktisk koster arbeidsgiveren — og hvilken timepris en bedrift må ta for å dekke deg.',
      grossSalary: 'Brutto årslønn',
      totalCost: 'Total arbeidsgiverkostnad',
      loading: 'Påslag over lønn',
      targetRate: 'Måltimepris',
      salaryInput: 'Årslønn',
      salaryHint: 'Hentes fra Lønn-siden. Overstyr for å regne på en hypotetisk lønn.',
      costBreakdown: 'Kostnadsoppbygging',
      gross: 'Brutto lønn',
      feriepenger: 'Feriepenger',
      benefitsLeave: 'Goder / fri',
      employerPension: 'OTP (arbeidsgiver)',
      employerPensionGeneric: 'Arbeidsgiverpensjon',
      employerPensionHint: 'Settes på Pensjon-siden (OTP arbeidsgiver %).',
      payrollTax: 'Arbeidsgiveravgift',
      payrollTaxGeneric: 'Lønnsskatt',
      payrollTaxBase: 'Grunnlag for avgift',
      overheadFlat: 'Faste kostnader (kr/år)',
      overheadPct: 'Faste kostnader (% av lønn)',
      overheadHint: 'Standardestimat: kontorplass, utstyr, programvare og forsikring. Juster etter din situasjon.',
      total: 'Total kostnad',
      billingTitle: 'Timepris for konsulent',
      billingSubtitle: 'For konsulenter / frilansere',
      workHoursPerYear: 'Arbeidstimer per år',
      utilization: 'Fakturerbar andel',
      billableHours: 'Fakturerbare timer/år',
      billableOverride: 'Overstyr fakturerbare timer',
      breakEven: 'Dekningspris (timepris)',
      targetMargin: 'Målmargin (av omsetning)',
      markupOnCost: 'påslag på kostnad',
      targetHourly: 'Måltimepris',
      dailyRate: 'Dagsrate',
      hoursPerDay: 'Timer per dag',
      annualRevenue: 'Årlig omsetning',
      annualProfit: 'Årlig fortjeneste',
      caveat: 'Estimat: feriepenger opptjenes i år og utbetales neste år, og arbeidsgiveravgiften varierer med sone. Tallene er en god pekepinn, ikke en lønnskjøring.',
    },
    dataLoadError: 'Kunne ikke laste dataene dine. Sjekk tilkoblingen.',
    retry: 'Last på nytt',
    saveError: 'Endringene dine ble ikke lagret. Prøver på nytt …',
    saveRetry: 'Prøv igjen',
    today: 'I dag',
    viewingPast: 'Historisk måned',
    viewingFuture: 'Fremtidig måned',
    viewingCurrent: 'Denne måneden',
    asOfToday: 'Per i dag',
    asOfTodayHint: 'Denne siden viser tall per i dag – ikke påvirket av månedsvelgeren.',
    provenance: {
      default: 'Standard',
      custom: 'Ditt',
      estimate: 'Estimert',
      defaultHint: 'Standardverdi – du har ikke endret denne ennå.',
      customHint: 'Du har satt denne verdien selv.',
      estimateHint: 'Beregnet fra dine data.',
    },
    netWorthEditor: {
      edit: 'Rediger historikk',
      title: 'Formueshistorikk',
      desc: 'Legg inn din faktiske nettoformue for tidligere måneder. Måneder du fyller inn blir ekte datapunkter; resten estimeres til du fyller dem inn.',
      live: 'Live',
      liveHint: 'Denne måneden oppdateres automatisk fra din nåværende egenkapital.',
      placeholderEstimate: 'estimat',
      reset: 'Nullstill',
      done: 'Ferdig',
      snapshotSaved: 'Full tilstand lagret – tilgjengelig for tidsmaskin senere',
    },
    timeMachine: {
      viewing: 'Viser',
      liveLabel: 'I dag (live)',
      readOnly: 'Skrivebeskyttet historikk – gå til i dag for å redigere',
      backToToday: 'Tilbake til i dag',
    },
    salary: {
      importPayslip: {
        button: 'Importer lønnsslipp',
        title: 'Importer fra lønnsslipp',
        intro: 'Velg en PDF-lønnsslipp. Filen leses lokalt i nettleseren og lagres aldri – kun tallene under hentes ut og lagres for måneden.',
        chooseFile: 'Velg PDF',
        parsing: 'Leser lønnsslipp…',
        parseError: 'Fant ingen gjenkjennelig lønnsslipp i denne PDF-en.',
        readError: 'Kunne ikke lese PDF-filen.',
        period: 'Periode',
        payDate: 'Utbetalt',
        month: 'Måned',
        setsIncome: 'Nettolønn settes som månedsinntekt',
        storedLabel: 'Lagres for måneden',
        extraBase: 'Månedslønn',
        extraGross: 'Bruttolønn',
        extraNet: 'Nettolønn',
        extraTax: 'Forskuddstrekk',
        extraHolidayPay: 'Feriepenger (i år)',
        overwriteNote: 'Erstatter lønnsslippen som allerede er lagret for denne måneden.',
        importAction: 'Importer',
        noNetFound: 'Fant ingen nettolønn i lønnsslippen.',
        savedTitle: 'Lønnsslipp for måneden',
        remove: 'Fjern',
        preview: 'Forhåndsvisning',
        clickToEnlarge: 'Klikk for å forstørre',
        closePreview: 'Lukk',
        supports: 'Støtter Visma-lønnsslipper – én måned eller alle på én gang.',
        payslipsFound: 'lønnsslipper funnet',
        view: 'Vis',
        selectAll: 'Velg alle',
        deselectAll: 'Fjern alle',
        loadingPreview: 'Gjengir side…',
        providerLabel: 'Lønnssystem',
        moreProviders: 'Flere leverandører kommer',
      },
      title: 'Lønn',
      heroLabel: 'Lønn',
      heroTitlePre: 'Lønn over',
      heroTitleEm: 'tid',
      subtitle: 'Spor lønnsutvikling, bonus og faktiske arbeidstimer. Sammenlign med inflasjon (KPI) fra SSB for å se hva du egentlig sitter igjen med.',
      currentSalary: 'Total årslønn',
      cumulativeGrowth: 'Vekst totalt',
      yoyVsInflation: 'År-over-år vs KPI',
      effectiveHourly: 'Effektiv timelønn',
      nextReviewTitle: 'Neste lønnsforhandling',
      nextReviewDesc: 'Hva «bare inflasjon» betyr, og hva et reelt løft krever.',
      lastRaiseLabel: 'Lønnsgrunnlag',
      timeSinceLabel: 'Tid siden',
      cpiSinceLabel: 'KPI siden den gang',
      cpiRolling12Label: 'KPI siste 12 mnd',
      inflationOnlyTarget: 'Inflasjonsnøytral lønn',
      inflationOnlyTargetDesc: 'Beløpet som tilsvarer akkurat KPI siden forrige økning.',
      proposedSalaryLabel: 'Foreslått ny lønn',
      proposedSalaryHint: 'Skriv inn tilbudet for å se reell økning.',
      proposedIncreaseLabel: 'Økning',
      realRaiseSinceLabel: 'Reelt løft (vs KPI siden sist)',
      realRaiseRollingLabel: 'Reelt løft (vs siste 12 mnd KPI)',
      monthsAgo: 'mnd siden',
      vsCpi: 'vs KPI',
      noPriorRaise: 'Ingen tidligere lønnsøkning registrert.',
      realHourlyRate: 'Reell timelønn',
      realHourlyRateDesc: 'Nominell vs inflasjonsjustert timelønn over tid.',
      nominal: 'Nominell',
      real: 'Inflasjonsjustert',
      salaryTimeline: 'Lønnsutvikling',
      salaryTimelineDesc: 'Hver endring (lønnsøkning, forfremmelse eller jobbytte) er en markør.',
      yoyChart: 'År-over-år: lønn vs inflasjon',
      yoyChartDesc: 'Stolpe per år. Grønn betyr at lønnen slo KPI.',
      totalCompChart: 'Total godtgjørelse per år',
      totalCompChartDesc: 'Grunnlønn, vakt, bonus og overtid stablet.',
      hoursVsComp: 'Timer vs timelønn',
      hoursVsCompDesc: 'Når timene øker raskere enn lønnen, går effektiv timelønn ned.',
      jobs: 'Jobber',
      addJob: 'Ny jobb',
      employer: 'Arbeidsgiver',
      role: 'Stilling',
      startDate: 'Startdato (YYYY-MM)',
      endDate: 'Sluttdato (YYYY-MM, tom = nåværende)',
      contractedHours: 'Avtalte timer/uke',
      initialSalary: 'Startlønn (brutto/år, valgfri)',
      initialSalaryHint: 'Lag startlønn-oppføring automatisk.',
      onCallAnnual: 'Vakttillegg (kr/år)',
      onCallHint: 'La stå tom om du ikke har vaktordning.',
      onCallLabel: 'Vakt',
      onCallShort: 'vakt',
      salaries: 'Lønnsendringer',
      addSalary: 'Ny lønnsendring',
      effectiveDate: 'Gjelder fra (YYYY-MM)',
      grossAnnual: 'Brutto årslønn',
      changeType: 'Type endring',
      changeTypeInitial: 'Startlønn',
      changeTypeRaise: 'Lønnsøkning',
      changeTypePromotion: 'Forfremmelse',
      changeTypeJobChange: 'Jobbytte',
      changeTypeAdjustment: 'Justering',
      job: 'Jobb',
      bonuses: 'Bonuser',
      addBonus: 'Ny bonus',
      bonusAmount: 'Beløp (brutto)',
      bonusType: 'Type',
      bonusDate: 'Dato (YYYY-MM-DD)',
      bonusTypeAnnual: 'Årsbonus',
      bonusTypePerformance: 'Ytelsesbonus',
      bonusTypeSigning: 'Signeringsbonus',
      bonusTypeHolidayPay: 'Feriepenger',
      bonusTypeProfitShare: 'Overskuddsdeling',
      bonusTypeOther: 'Annet',
      overtime: 'Overtid',
      addOvertime: 'Ny overtid',
      overtimeHours: 'Timer',
      overtimeAmount: 'Beløp (brutto)',
      overtimeDate: 'Dato (YYYY-MM-DD)',
      hoursSnapshots: 'Faktiske timer',
      addHoursSnapshot: 'Ny timeregistrering',
      actualHours: 'Faktiske timer/uke',
      periodMonth: 'Måned (YYYY-MM)',
      notes: 'Notater',
      noEntries: 'Ingen oppføringer enda.',
      noJobsHint: 'Legg til en jobb først, så kan du registrere lønnsendringer.',
      allJobs: 'Alle jobber',
      unassigned: 'Uten jobb',
      updateBudgetTitle: 'Oppdater budsjettinntekt?',
      updateBudgetMsg: 'Vil du oppdatere månedsinntekten i budsjettet basert på den nye lønnen? Gjelder fra angitt måned og fremover.',
      updateBudgetConfirm: 'Oppdater inntekt',
      updateBudgetKeep: 'Behold som er',
      incomeAuto: 'auto fra lønn',
      incomeOverride: 'manuelt overstyrt',
      incomeResetAuto: 'Bruk auto',
      growthSinceFirst: 'siden start',
      beatsCpi: 'slår KPI',
      losesCpi: 'under KPI',
      inflationSource: 'Inflasjonsdata: SSB tabell 03013 (KPI). Oppdateres månedlig.',
      inflationOffline: 'Inflasjonsdata utilgjengelig — kunne ikke nå SSB.',
      nationalMedian: 'Nasjonal median',
      vsNationalMedian: 'vs nasjonal median',
    },
    forecast: {
      title: 'Prognose',
      heroLabel: 'Prognose',
      heroTitlePre: 'Hva hvis',
      heroTitleEm: '...',
      subtitle: 'Juster forutsetningene — se hvordan formue, takehome og gjeld endrer seg over tid.',
      raiseAssumption: 'Årlig lønnsøkning',
      savingsRateAssumption: 'Sparing av netto',
      returnAssumption: 'Forventet realavkastning',
      years: 'Antall år',
      inflationAssumption: 'Forventet inflasjon',
      summaryNow: 'Nå',
      summaryEnd: 'Etter',
      grossSalary: 'Bruttolønn',
      netTakeHome: 'Netto takehome',
      netWorthProjected: 'Beregnet formue',
      mortgageRemaining: 'Restgjeld',
      realGrowth: 'Reell vekst',
      forecastChart: 'Formuesutvikling',
      forecastChartDesc: 'Beregnet formue per år gitt valgte forutsetninger.',
      salaryChart: 'Lønn over tid',
      salaryChartDesc: 'Bruttolønn og netto takehome år for år.',
      year: 'År',
    },
    goals: {
      title: 'Mål',
      subtitle: 'Spar mot konkrete mål med synlig fremgang.',
      empty: 'Ingen mål enda. Legg til ditt første sparemål for å se fremgang.',
      addGoal: 'Nytt mål',
      name: 'Navn',
      target: 'Målbeløp',
      source: 'Kilde',
      manualCurrent: 'Nåværende beløp',
      deadline: 'Frist (YYYY-MM, valgfri)',
      notes: 'Notater',
      sourceManual: 'Manuelt registrert',
      sourceBsu: 'BSU-konto',
      sourceSavings: 'Sparekonto',
      sourceTotalEquity: 'Total egenkapital',
      sourcePortfolio: 'Aksjeportefølje',
      sourceBufferAccount: 'Bufferkonto',
      progress: 'Fremgang',
      remaining: 'Gjenstår',
      completed: 'Fullført',
      monthsLeft: 'mnd igjen',
      overdue: 'Frist passert',
    },
    settings: {
      title: 'Innstillinger',
      subtitle: 'Tilpass Headroom og administrer dataene dine.',
      currency: 'Valuta',
      currencyDesc: 'Velg hvilken valuta som vises i hele appen.',
      language: 'Språk',
      languageDesc: 'Velg språk for hele grensesnittet.',
      display: 'Visningsinnstillinger',
      displayDesc: 'Juster sparemål og forventet vekst.',
      savingsTargetPct: 'Sparemål',
      growthReturnRate: 'Aksjeavkastning',
      houseGrowthRate: 'Boligpris-vekst',
      cashGrowthRate: 'Kontant/BSU-rente',
      cryptoGrowthRate: 'Krypto-avkastning',
      growthRatesDesc: 'Egne vekstrater per aktivaklasse. Aksjer brukes kun på aksjeporteføljen — bolig, kontant og krypto vokser med egne rater.',
      restoreDefaults: 'Tilbakestill til standard',
      demoTitle: 'Demomodus',
      demoDesc: 'Bytt ut tallene dine med eksempeldata, slik at du kan vise appen uten å avsløre din egen økonomi. Dine ekte data lagres trygt og hentes tilbake når du slår av.',
      demoActivate: 'Aktiver demomodus',
      demoDeactivate: 'Avslutt demomodus — gjenopprett mine data',
      demoActive: 'Demomodus er på',
      demoBanner: 'Demomodus — viser eksempeldata, ikke din egen økonomi.',
      demoExit: 'Avslutt',
      dataManagement: 'Datahåndtering',
      dataDesc: 'Eksporter eller importer alle dataene dine som JSON.',
      about: 'Om Headroom',
      aboutDesc: 'Selvhostet personlig økonomi. Alle data lagres lokalt i SQLite på din egen server.',
      version: 'Versjon',
      storage: 'Lagring',
      rateNokToUsd: 'Kurs NOK → USD',
      customCurrencyLabel: 'Egendefinert valuta',
      customCurrencyHint: '3-bokstavs kode (f.eks. EUR). Kurs er antall enheter per 1 NOK.',
      currencyCode: 'Kode',
      currencyRate: 'Kurs',
      english: 'Engelsk',
      norwegian: 'Norsk',
      region: 'Region',
      regionDesc: 'Norge bruker SSB-data og norsk skattemodell. "Generisk" skjuler norsk-spesifikke funksjoner.',
      navVisibility: 'Navigasjon',
      navVisibilityDesc: 'Velg hvilke sider som vises i menyen. Innstillinger vises alltid.',
      regionNorway: 'Norge',
      regionGeneric: 'Generisk',
      customTaxRate: 'Effektiv skatteprosent',
      customTaxRateDesc: 'Brukes i Generisk-modus i stedet for trinnskatt + trygdeavgift.',
      exportData: 'Eksporter alle data',
      importData: 'Importer data',
      replaceWarning: 'Dette vil erstatte alle eksisterende data.',
      replaceConfirm: 'Erstatt alle data',
      dropZone: 'Slipp JSON-filen her',
      browseFile: 'eller klikk for å bla',
      importReady: 'Klar til import',
      importDone: 'Data importert.',
      resetTitle: 'Tilbakestill alle data',
      resetDesc: 'Nullstill all økonomisk data. Innstillinger som språk, valuta og region beholdes.',
      resetButton: 'Tilbakestill alle data',
      resetWarning: 'Dette kan ikke angres. Alle inntekter, utgifter, transaksjoner, aktiva, lån, jobber og mål slettes.',
      resetConfirm: 'Ja, slett alt',
      resetCancel: 'Avbryt',
      resetDone: 'Alle data ble tilbakestilt.',
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
    expenseTypeLabel: 'Type:',
    expenseType: { fixed: 'Fixed', variable: 'Variable', subscription: 'Subscription', insurance: 'Insurance' },
    debt: {
      title: 'Debt', add: 'Add debt', none: 'No debt recorded.',
      name: 'Name:', balance: 'Balance:', rate: 'Rate (% p.a.):', minPayment: 'Monthly payment:', typeLabel: 'Type:',
      sum: 'Total debt', payoffIn: 'Paid off in', interestLabel: 'interest', never: "Doesn't cover interest",
      planner: 'Payoff plan', strategy: 'Strategy', avalanche: 'Highest rate first', snowball: 'Smallest balance first',
      extra: 'Extra per month', debtFree: 'Debt-free in', totalInterest: 'Total interest',
      interestSaved: 'Interest saved', vsMinimum: 'vs. minimums only',
      types: { student: 'Student loan', consumer: 'Consumer loan', credit_card: 'Credit card', other: 'Other' },
    },
    editName: 'New name:',
    editAmount: 'New amount:',
    editDescription: 'New description:',
    days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    add: 'Add',
    edit: 'Edit',
    txKind: 'Type',
    txIncome: 'Income',
    txExpense: 'Expense',
    charts: {
      income: 'Income', expenses: 'Expenses', net: 'Net',
      cash: 'Cash', stocks: 'Stocks', house: 'House', crypto: 'Crypto', pension: 'Pension',
      netTakeHome: 'Take-home', incomeTax: 'Income tax', bracketTax: 'Bracket tax', socialSecurity: 'Social security', tax: 'Tax', effectiveRate: 'eff. rate',
      covered: 'covered', target: 'Target', savingsRate: 'Savings rate', less: 'less', more: 'more',
      ltv: 'LTV', ltvCap: 'Cap 85%',
      gross: 'Gross', savings: 'Savings', discretionary: 'Discretionary', fixedExpenses: 'Fixed expenses',
      buildsOverTime: 'Builds up as you add data over time.',
      cashflowTitle: 'Cashflow', cashflowSub: 'Money in vs out, last 12 months',
      compositionTitle: 'Net-worth composition', compositionSub: 'Mix over time',
      taxBreakdownTitle: 'Tax breakdown', taxBreakdownSub: 'Where your gross salary goes',
      emergencyFundTitle: 'Emergency fund', emergencyFundSub: 'Months covered',
      savingsRateTitle: 'Savings rate', savingsRateSub: 'Share of income left after expenses',
      heatmapTitle: 'Spending pattern', heatmapSub: 'Daily spend this month',
      ltvTitle: 'Loan-to-value over time', ltvSub: 'Falls as the loan amortizes and the home appreciates',
      moneyFlowTitle: 'Money flow', moneyFlowSub: 'Where your monthly salary goes',
      allocationTitle: 'Asset allocation', allocationSub: 'Your mix right now', allocationCenter: 'Total',
      liquid: 'Liquid', locked: 'Locked',
      liquidSub: 'Stocks, cash, crypto', lockedSub: 'Property equity + pension',
      liquidLockedTitle: 'Liquid vs locked', liquidLockedSub: 'How much you can actually reach',
      debtPayoffTitle: 'Debt payoff', debtPayoffSub: 'Mortgage balance down toward zero',
      debtFree: 'Debt-free on your home — no mortgage to pay down.',
      mortgageToday: 'Mortgage today', debtFreeYear: 'Debt-free',
      plusOtherDebt: '+ {amount} other debt (student/consumer) — see the section above.',
    },
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
    bucketStocks: 'Stocks',
    bucketCrypto: 'Crypto',
    bucketCash: 'Cash/BSU',
    bucketHouse: 'House equity',
    pension: 'Pension',
    pensionWealth: 'Pension wealth',
    otpBalance: 'OTP balance',
    otpEmployerPct: 'OTP employer %',
    otpEmployeePct: 'OTP self %',
    ipsBalance: 'IPS balance',
    ipsAnnualContribution: 'IPS annual contribution',
    ipsHint: 'Max 15 000 NOK/yr is tax-deductible (~22%).',
    retirementAge: 'Retirement age',
    birthYear: 'Birth year',
    yearsToRetirement: 'years to retirement',
    pensionAtRetirement: 'Pension wealth at retirement',
    otpGrowthRate: 'OTP return',
    ipsGrowthRate: 'IPS return',
    setBirthYearHint: 'Set birth year in Settings',
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
    conservativeWarning: 'Income below average — consider saving 10% more',
    volatileIncomeWarning: 'Irregular income — consider saving 10% more',
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
      settings: 'Settings',
      salary: 'Salary',
      forecast: 'Forecast',
      pension: 'Pension',
      employerCost: 'Cost & rate',
      more: 'More',
    },
    employerCost: {
      heroLabel: 'Cost & rate',
      subtitle: 'See what you actually cost your employer — and the hourly rate a company must charge to cover you.',
      grossSalary: 'Gross annual salary',
      totalCost: 'Total employer cost',
      loading: 'Loading over salary',
      targetRate: 'Target hourly rate',
      salaryInput: 'Annual salary',
      salaryHint: 'Pulled from the Salary page. Override to model a hypothetical salary.',
      costBreakdown: 'Cost breakdown',
      gross: 'Gross salary',
      feriepenger: 'Holiday pay',
      benefitsLeave: 'Benefits / leave',
      employerPension: 'Employer pension (OTP)',
      employerPensionGeneric: 'Employer pension',
      employerPensionHint: 'Set on the Pension page (employer OTP %).',
      payrollTax: 'Employer national insurance',
      payrollTaxGeneric: 'Payroll tax',
      payrollTaxBase: 'Payroll tax base',
      overheadFlat: 'Overhead (kr/yr)',
      overheadPct: 'Overhead (% of salary)',
      overheadHint: 'Default estimate: office, equipment, software and insurance. Adjust to your situation.',
      total: 'Total cost',
      billingTitle: 'Consultant billing rate',
      billingSubtitle: 'For consultants / freelancers',
      workHoursPerYear: 'Work hours per year',
      utilization: 'Billable share',
      billableHours: 'Billable hours/yr',
      billableOverride: 'Override billable hours',
      breakEven: 'Break-even (hourly)',
      targetMargin: 'Target margin (of revenue)',
      markupOnCost: 'markup on cost',
      targetHourly: 'Target hourly',
      dailyRate: 'Day rate',
      hoursPerDay: 'Hours per day',
      annualRevenue: 'Annual revenue',
      annualProfit: 'Annual profit',
      caveat: 'Estimate: holiday pay is accrued this year and paid next, and employer national insurance varies by zone. A solid guide, not a payroll run.',
    },
    dataLoadError: 'Could not load your data. Check your connection.',
    retry: 'Reload',
    saveError: 'Your changes weren’t saved. Retrying …',
    saveRetry: 'Try again',
    today: 'Today',
    viewingPast: 'Past month',
    viewingFuture: 'Future month',
    viewingCurrent: 'Current month',
    asOfToday: 'As of today',
    asOfTodayHint: 'This page shows values as of today — not affected by the month picker.',
    provenance: {
      default: 'Default',
      custom: 'Yours',
      estimate: 'Estimate',
      defaultHint: "Default value — you haven't changed this yet.",
      customHint: 'You set this value.',
      estimateHint: 'Calculated from your data.',
    },
    netWorthEditor: {
      edit: 'Edit history',
      title: 'Net worth history',
      desc: 'Enter your actual net worth for past months. Months you fill in become real data points; the rest stay estimated until you do.',
      live: 'Live',
      liveHint: 'This month updates automatically from your current equity.',
      placeholderEstimate: 'estimate',
      reset: 'Reset',
      done: 'Done',
      snapshotSaved: 'Full state saved — available for the time machine later',
    },
    timeMachine: {
      viewing: 'Viewing',
      liveLabel: 'Today (live)',
      readOnly: 'Read-only history — go to today to edit',
      backToToday: 'Back to today',
    },
    salary: {
      importPayslip: {
        button: 'Import payslip',
        title: 'Import from payslip',
        intro: 'Choose a PDF payslip. The file is read locally in your browser and never stored — only the figures below are extracted and saved for the month.',
        chooseFile: 'Choose PDF',
        parsing: 'Reading payslip…',
        parseError: 'Couldn’t find a recognisable payslip in this PDF.',
        readError: 'Could not read the PDF file.',
        period: 'Period',
        payDate: 'Paid',
        month: 'Month',
        setsIncome: 'Net pay becomes this month’s income',
        storedLabel: 'Saved for the month',
        extraBase: 'Monthly salary',
        extraGross: 'Gross',
        extraNet: 'Net',
        extraTax: 'Tax withheld',
        extraHolidayPay: 'Holiday pay (this year)',
        overwriteNote: 'Replaces the payslip already saved for this month.',
        importAction: 'Import',
        noNetFound: 'No net pay found in the payslip.',
        savedTitle: 'Payslip for the month',
        remove: 'Remove',
        preview: 'Preview',
        clickToEnlarge: 'Click to enlarge',
        closePreview: 'Close',
        supports: 'Supports Visma payslips — one month or all at once.',
        payslipsFound: 'payslips found',
        view: 'View',
        selectAll: 'Select all',
        deselectAll: 'Clear all',
        loadingPreview: 'Rendering page…',
        providerLabel: 'Payroll system',
        moreProviders: 'More providers coming',
      },
      title: 'Salary',
      heroLabel: 'Salary',
      heroTitlePre: 'Pay over',
      heroTitleEm: 'time',
      subtitle: 'Track salary changes, bonuses and the hours you actually work. Compared against Norwegian CPI (SSB) so you see what raises really buy you.',
      currentSalary: 'Total annual gross',
      cumulativeGrowth: 'Cumulative growth',
      yoyVsInflation: 'YoY vs CPI',
      effectiveHourly: 'Effective hourly',
      nextReviewTitle: 'Next salary review',
      nextReviewDesc: 'What "just inflation" looks like, and what a real raise takes.',
      lastRaiseLabel: 'Salary baseline',
      timeSinceLabel: 'Time since',
      cpiSinceLabel: 'CPI since then',
      cpiRolling12Label: 'Rolling 12-mo CPI',
      inflationOnlyTarget: 'Inflation-only salary',
      inflationOnlyTargetDesc: 'The amount that just matches CPI since your last raise.',
      proposedSalaryLabel: 'Proposed new salary',
      proposedSalaryHint: 'Type the offer to see the real raise.',
      proposedIncreaseLabel: 'Increase',
      realRaiseSinceLabel: 'Real raise (vs CPI since last)',
      realRaiseRollingLabel: 'Real raise (vs rolling 12-mo CPI)',
      monthsAgo: 'mo ago',
      vsCpi: 'vs CPI',
      noPriorRaise: 'No prior raise on record.',
      realHourlyRate: 'Real hourly rate',
      realHourlyRateDesc: 'Nominal vs inflation-adjusted hourly rate over time.',
      nominal: 'Nominal',
      real: 'Inflation-adjusted',
      salaryTimeline: 'Salary timeline',
      salaryTimelineDesc: 'Each change (raise, promotion or job switch) is a marker.',
      yoyChart: 'YoY: salary vs inflation',
      yoyChartDesc: 'One bar per year. Green means you beat CPI.',
      totalCompChart: 'Total comp by year',
      totalCompChartDesc: 'Base salary, on-call, bonus and overtime stacked.',
      hoursVsComp: 'Hours vs hourly rate',
      hoursVsCompDesc: 'When hours rise faster than pay, your effective rate falls.',
      jobs: 'Jobs',
      addJob: 'Add job',
      employer: 'Employer',
      role: 'Role',
      startDate: 'Start date (YYYY-MM)',
      endDate: 'End date (YYYY-MM, blank = current)',
      contractedHours: 'Contracted hours/week',
      initialSalary: 'Starting salary (gross/year, optional)',
      initialSalaryHint: 'Auto-creates an initial salary entry.',
      onCallAnnual: 'On-call pay (annual)',
      onCallHint: 'Leave blank if you have no on-call rotation.',
      onCallLabel: 'On-call',
      onCallShort: 'on-call',
      salaries: 'Salary changes',
      addSalary: 'Add salary change',
      effectiveDate: 'Effective date (YYYY-MM)',
      grossAnnual: 'Gross annual',
      changeType: 'Change type',
      changeTypeInitial: 'Initial salary',
      changeTypeRaise: 'Raise',
      changeTypePromotion: 'Promotion',
      changeTypeJobChange: 'Job change',
      changeTypeAdjustment: 'Adjustment',
      job: 'Job',
      bonuses: 'Bonuses',
      addBonus: 'Add bonus',
      bonusAmount: 'Amount (gross)',
      bonusType: 'Type',
      bonusDate: 'Date (YYYY-MM-DD)',
      bonusTypeAnnual: 'Annual bonus',
      bonusTypePerformance: 'Performance',
      bonusTypeSigning: 'Signing',
      bonusTypeHolidayPay: 'Holiday pay',
      bonusTypeProfitShare: 'Profit share',
      bonusTypeOther: 'Other',
      overtime: 'Overtime',
      addOvertime: 'Add overtime',
      overtimeHours: 'Hours',
      overtimeAmount: 'Amount (gross)',
      overtimeDate: 'Date (YYYY-MM-DD)',
      hoursSnapshots: 'Actual hours',
      addHoursSnapshot: 'Add hours snapshot',
      actualHours: 'Actual hours/week',
      periodMonth: 'Month (YYYY-MM)',
      notes: 'Notes',
      noEntries: 'No entries yet.',
      noJobsHint: 'Add a job first, then you can record salary changes.',
      allJobs: 'All jobs',
      unassigned: 'Unassigned',
      updateBudgetTitle: 'Update budget income?',
      updateBudgetMsg: 'Update the monthly budget income based on this new salary? Applies from the effective month onwards.',
      updateBudgetConfirm: 'Update income',
      updateBudgetKeep: 'Keep as-is',
      incomeAuto: 'auto from salary',
      incomeOverride: 'manual override',
      incomeResetAuto: 'Use auto',
      growthSinceFirst: 'since start',
      beatsCpi: 'beats CPI',
      losesCpi: 'below CPI',
      inflationSource: 'Inflation data: SSB table 03013 (CPI). Refreshed monthly.',
      inflationOffline: 'Inflation data unavailable — could not reach SSB.',
      nationalMedian: 'National median',
      vsNationalMedian: 'vs national median',
    },
    forecast: {
      title: 'Forecast',
      heroLabel: 'Forecast',
      heroTitlePre: 'What if',
      heroTitleEm: '...',
      subtitle: 'Tune the assumptions — see how net worth, take-home and debt evolve over time.',
      raiseAssumption: 'Annual raise',
      savingsRateAssumption: 'Saved from net',
      returnAssumption: 'Expected real return',
      years: 'Years',
      inflationAssumption: 'Expected inflation',
      summaryNow: 'Now',
      summaryEnd: 'After',
      grossSalary: 'Gross salary',
      netTakeHome: 'Net take-home',
      netWorthProjected: 'Projected net worth',
      mortgageRemaining: 'Mortgage balance',
      realGrowth: 'Real growth',
      forecastChart: 'Net worth projection',
      forecastChartDesc: 'Projected net worth per year given chosen assumptions.',
      salaryChart: 'Salary over time',
      salaryChartDesc: 'Gross salary and net take-home year by year.',
      year: 'Year',
    },
    goals: {
      title: 'Goals',
      subtitle: 'Save toward concrete targets with visible progress.',
      empty: 'No goals yet. Add your first savings goal to track progress.',
      addGoal: 'Add goal',
      name: 'Name',
      target: 'Target amount',
      source: 'Source',
      manualCurrent: 'Current amount',
      deadline: 'Deadline (YYYY-MM, optional)',
      notes: 'Notes',
      sourceManual: 'Manual entry',
      sourceBsu: 'BSU account',
      sourceSavings: 'Savings account',
      sourceTotalEquity: 'Total net equity',
      sourcePortfolio: 'Investment portfolio',
      sourceBufferAccount: 'Buffer account',
      progress: 'Progress',
      remaining: 'Remaining',
      completed: 'Completed',
      monthsLeft: 'months left',
      overdue: 'Overdue',
    },
    settings: {
      title: 'Settings',
      subtitle: 'Customize Headroom and manage your data.',
      currency: 'Currency',
      currencyDesc: 'Choose which currency is shown across the app.',
      language: 'Language',
      languageDesc: 'Pick the interface language.',
      display: 'Display preferences',
      displayDesc: 'Tune your savings target and expected growth rate.',
      savingsTargetPct: 'Savings target',
      growthReturnRate: 'Stocks return',
      houseGrowthRate: 'House appreciation',
      cashGrowthRate: 'Cash/BSU rate',
      cryptoGrowthRate: 'Crypto return',
      growthRatesDesc: 'Each asset class grows at its own rate. The stocks rate applies only to your investment portfolio — house, cash, and crypto grow at their own rates.',
      restoreDefaults: 'Restore defaults',
      demoTitle: 'Demo mode',
      demoDesc: 'Replace your numbers with sample data so you can show the app without revealing your own finances. Your real data is kept safe and restored when you turn it off.',
      demoActivate: 'Enable demo mode',
      demoDeactivate: 'Exit demo mode — restore my data',
      demoActive: 'Demo mode is on',
      demoBanner: 'Demo mode — showing sample data, not your real finances.',
      demoExit: 'Exit',
      dataManagement: 'Data management',
      dataDesc: 'Export or import all your data as JSON.',
      about: 'About Headroom',
      aboutDesc: 'Self-hosted personal finance. All data lives in a SQLite file on your own server.',
      version: 'Version',
      storage: 'Storage',
      rateNokToUsd: 'NOK → USD rate',
      customCurrencyLabel: 'Custom currency',
      customCurrencyHint: '3-letter code (e.g. EUR). Rate is units per 1 NOK.',
      currencyCode: 'Code',
      currencyRate: 'Rate',
      english: 'English',
      norwegian: 'Norwegian',
      region: 'Region',
      regionDesc: 'Norway uses SSB data and Norwegian tax model. "Generic" hides Norway-specific features.',
      navVisibility: 'Navigation',
      navVisibilityDesc: 'Choose which pages appear in the menu. Settings is always shown.',
      regionNorway: 'Norway',
      regionGeneric: 'Generic',
      customTaxRate: 'Effective tax rate',
      customTaxRateDesc: 'Used in Generic mode instead of bracket tax + national insurance.',
      exportData: 'Export all data',
      importData: 'Import data',
      replaceWarning: 'This will replace all existing data.',
      replaceConfirm: 'Replace all data',
      dropZone: 'Drop your JSON file here',
      browseFile: 'or click to browse',
      importReady: 'Ready to import',
      importDone: 'Data imported.',
      resetTitle: 'Reset all data',
      resetDesc: 'Wipe all financial data. Settings like language, currency, and region are preserved.',
      resetButton: 'Reset all data',
      resetWarning: 'This cannot be undone. All incomes, expenses, transactions, assets, loans, jobs, and goals will be deleted.',
      resetConfirm: 'Yes, delete everything',
      resetCancel: 'Cancel',
      resetDone: 'All data has been reset.',
    }
  }
};

const DEFAULT_FIXED_EXPENSES: FixedExpense[] = [
  { id: '1', name: 'Huslån',          amount: 12000, type: 'fixed'        },
  { id: '2', name: 'Felleskostnader', amount: 3000,  type: 'fixed'        },
  { id: '3', name: 'Forsikring',      amount: 400,   type: 'insurance'    },
  { id: '4', name: 'Strøm',           amount: 1000,  type: 'fixed'        },
  { id: '5', name: 'Trening',         amount: 500,   type: 'subscription' },
  { id: '6', name: 'Mobil',           amount: 400,   type: 'subscription' },
  { id: '7', name: 'Mat',             amount: 5000,  type: 'variable'     },
  { id: '8', name: 'Sparing',         amount: 5000,  type: 'fixed'        },
];

// Data-based default assumptions. These are the researched starting points users
// can tune — and restore to via the per-section "restore defaults" controls.
// eslint-disable-next-line react-refresh/only-export-components -- shared default, single source of truth
export const DEFAULT_GROWTH_RATES = {
  growthReturnRate: 7,
  houseGrowthRate: 3,
  cashGrowthRate: 1,
  cryptoGrowthRate: 0,
};

// eslint-disable-next-line react-refresh/only-export-components -- shared default, single source of truth
export const DEFAULT_TAX_RATES = {
  stockTaxRate: 37.84,
  cryptoTaxRate: 22,
  customTaxRatePct: 30,
};

const DEFAULT_ASSETS: Assets = {
  portfolio: 0,
  unrealizedGain: 0,
  taxRate: DEFAULT_TAX_RATES.stockTaxRate,
  bsu: 0,
  savings: 0,
  houseValue: 0,
  houseDebt: 0,
  crypto: 0,
  cryptoUnrealizedGain: 0,
  cryptoTaxRate: DEFAULT_TAX_RATES.cryptoTaxRate,
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

// eslint-disable-next-line react-refresh/only-export-components -- shared default, single source of truth
export const DEFAULT_PENSION: Pension = {
  otpBalance: 0,
  otpEmployerPct: 5,
  otpEmployeePct: 0,
  otpGrowthRate: 5,
  ipsBalance: 0,
  ipsAnnualContribution: 0,
  ipsGrowthRate: 7,
  birthYear: 0,
  retirementAge: 67,
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
  currentMonth: Date;
  setCurrentMonth: (date: Date) => void;
  income: number;
  setIncome: (val: number) => void;
  monthlyIncomes: Record<string, number>;
  setMonthlyIncomeForMonth: (monthKey: string, amount: number) => void;
  clearMonthlyIncomeForMonth: (monthKey: string) => void;
  payslips: Record<string, MonthlyPayslip>;
  setPayslip: (monthKey: string, data: MonthlyPayslip) => void;
  removePayslip: (monthKey: string) => void;
  derivedMonthlyIncome: number;
  grossAnnualIncome: number;
  isMonthlyIncomeOverridden: boolean;
  netWorthHistory: Record<string, number>;
  setNetWorthForMonth: (monthKey: string, value: number) => void;
  clearNetWorthForMonth: (monthKey: string) => void;
  balanceSnapshots: Record<string, BalanceSnapshot>;
  prevMonthIncome: number;
  prevMonthSpending: number;
  effectiveIncome: number;
  averageIncome: number;
  savingsTargetPercent: number;
  setSavingsTargetPercent: (val: number) => void;
  recommendedSpending: number;
  recommendedInvestment: number;
  suggestedInvestment: number;
  conservativeMode: boolean;
  conservativeReason: ConservativeReason;
  fixedExpenses: FixedExpense[];
  setFixedExpenses: (val: FixedExpense[]) => void;
  debts: Debt[];
  setDebts: (val: Debt[]) => void;
  totalDebt: number;
  netWorth: number;
  dailyTransactions: DailyTransaction[];
  setDailyTransactions: (val: DailyTransaction[]) => void;
  recurringTemplates: TransactionTemplate[];
  setRecurringTemplates: (val: TransactionTemplate[]) => void;
  assets: Assets;
  updateAsset: (key: keyof Assets, value: number) => void;
  loan: LoanData;
  updateLoan: (key: keyof LoanData, value: number | string) => void;
  pension: Pension;
  updatePension: (key: keyof Pension, value: number) => void;
  housingMode: HousingMode;
  setHousingMode: (mode: HousingMode) => void;
  homeowner: HomeownerData;
  updateHomeowner: (key: keyof HomeownerData, value: number) => void;
  transition: TransitionData;
  updateTransition: (key: keyof TransitionData, value: number) => void;
  mortgageRate: number;
  mortgageTermYears: number;
  growthReturnRate: number;
  setGrowthReturnRate: (val: number) => void;
  houseGrowthRate: number;
  setHouseGrowthRate: (val: number) => void;
  cashGrowthRate: number;
  setCashGrowthRate: (val: number) => void;
  cryptoGrowthRate: number;
  setCryptoGrowthRate: (val: number) => void;
  jobs: JobEntry[];
  addJob: (job: Omit<JobEntry, 'id'>) => string;
  updateJob: (id: string, patch: Partial<Omit<JobEntry, 'id'>>) => void;
  removeJob: (id: string) => void;
  salaries: SalaryEntry[];
  addSalary: (entry: Omit<SalaryEntry, 'id'>) => string;
  updateSalary: (id: string, patch: Partial<Omit<SalaryEntry, 'id'>>) => void;
  removeSalary: (id: string) => void;
  bonuses: BonusEntry[];
  addBonus: (entry: Omit<BonusEntry, 'id'>) => void;
  updateBonus: (id: string, patch: Partial<Omit<BonusEntry, 'id'>>) => void;
  removeBonus: (id: string) => void;
  overtime: OvertimeEntry[];
  addOvertime: (entry: Omit<OvertimeEntry, 'id'>) => void;
  updateOvertime: (id: string, patch: Partial<Omit<OvertimeEntry, 'id'>>) => void;
  removeOvertime: (id: string) => void;
  hoursSnapshots: HoursSnapshot[];
  addHoursSnapshot: (entry: Omit<HoursSnapshot, 'id'>) => void;
  updateHoursSnapshot: (id: string, patch: Partial<Omit<HoursSnapshot, 'id'>>) => void;
  removeHoursSnapshot: (id: string) => void;
  goals: Goal[];
  addGoal: (g: Omit<Goal, 'id'>) => void;
  updateGoal: (id: string, patch: Partial<Omit<Goal, 'id'>>) => void;
  removeGoal: (id: string) => void;
  inflation: InflationPoint[];
  inflationStale: boolean;
  wageStats: WageStatPoint[];
  region: Region;
  setRegion: (r: Region) => void;
  customTaxRatePct: number;
  setCustomTaxRatePct: (v: number) => void;
  employerCostConfig: EmployerCostConfig;
  updateEmployerCostConfig: (key: keyof EmployerCostConfig, value: number) => void;
  billingConfig: BillingRateConfig;
  updateBillingConfig: (key: keyof BillingRateConfig, value: number | null) => void;
  hiddenNavItems: string[];
  toggleNavItem: (path: string) => void;
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
  formatCurrencyShort: (val: number) => string;
  importAll: (data: Partial<ExportPayload>) => void;
  resetAll: () => void;
  restoreGrowthRateDefaults: () => void;
  restoreAssetTaxDefaults: () => void;
  restoreCustomTaxRateDefault: () => void;
  restorePensionAssumptionDefaults: () => void;
  restoreEmployerCostDefaults: () => void;
  demoMode: boolean;
  toggleDemoMode: () => void;
  dataLoadFailed: boolean;
  /** True when the most recent save failed and changes are pending a retry. */
  saveFailed: boolean;
  /** Manually re-attempt a failed save (used by the "not saved" banner). */
  retrySave: () => void;
}

// A full capture of the balance-relevant state as of a given month, so the
// balance pages can be viewed historically once snapshots accumulate. Keyed by
// 'yyyy-MM'. Recorded automatically for the current calendar month.
export interface BalanceSnapshot {
  assets: Assets;
  loan: LoanData;
  pension: Pension;
  homeowner: HomeownerData;
  transition: TransitionData;
  housingMode: HousingMode;
}

export interface ExportPayload {
  income: number;
  fixedExpenses: FixedExpense[];
  dailyTransactions: DailyTransaction[];
  debts?: Debt[];
  assets: Assets;
  loan: LoanData;
  pension?: Pension;
  recurringTemplates: TransactionTemplate[];
  monthlyIncomes?: Record<string, number>;
  payslips?: Record<string, MonthlyPayslip>;
  netWorthHistory?: Record<string, number>;
  balanceSnapshots?: Record<string, BalanceSnapshot>;
  housingMode?: HousingMode;
  homeowner?: HomeownerData;
  transition?: TransitionData;
  lang?: Language;
  currentMonth?: string;
  savingsTargetPercent?: number;
  growthReturnRate?: number;
  houseGrowthRate?: number;
  cashGrowthRate?: number;
  cryptoGrowthRate?: number;
  displayCurrency?: 'NOK' | 'USD' | 'custom';
  nokToUsd?: number;
  customCurrencyCode?: string;
  customCurrencyRate?: number;
  jobs?: JobEntry[];
  salaries?: SalaryEntry[];
  bonuses?: BonusEntry[];
  overtime?: OvertimeEntry[];
  hoursSnapshots?: HoursSnapshot[];
  goals?: Goal[];
  region?: Region;
  customTaxRatePct?: number;
  employerCostConfig?: EmployerCostConfig;
  billingConfig?: BillingRateConfig;
  hiddenNavItems?: string[];
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
  const [payslips, setPayslips] = useState<Record<string, MonthlyPayslip>>({});
  const [netWorthHistory, setNetWorthHistory] = useState<Record<string, number>>({});
  const [balanceSnapshots, setBalanceSnapshots] = useState<Record<string, BalanceSnapshot>>({});
  const [savingsTargetPercent, setSavingsTargetPercent] = useState<number>(20);
  const [fixedExpenses, setFixedExpenses] = useState<FixedExpense[]>(DEFAULT_FIXED_EXPENSES);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [dailyTransactions, setDailyTransactions] = useState<DailyTransaction[]>([]);
  const [recurringTemplates, setRecurringTemplates] = useState<TransactionTemplate[]>([]);
  const [assets, setAssets] = useState<Assets>(DEFAULT_ASSETS);
  const [loan, setLoan] = useState<LoanData>(DEFAULT_LOAN);
  const [pension, setPension] = useState<Pension>(DEFAULT_PENSION);
  const [housingMode, setHousingMode] = useState<HousingMode>('first_buyer');
  const [homeowner, setHomeowner] = useState<HomeownerData>(DEFAULT_HOMEOWNER);
  const [transition, setTransition] = useState<TransitionData>(DEFAULT_TRANSITION);
  const [growthReturnRate, setGrowthReturnRate] = useState<number>(DEFAULT_GROWTH_RATES.growthReturnRate);
  const [houseGrowthRate, setHouseGrowthRate] = useState<number>(DEFAULT_GROWTH_RATES.houseGrowthRate);
  const [cashGrowthRate, setCashGrowthRate] = useState<number>(DEFAULT_GROWTH_RATES.cashGrowthRate);
  const [cryptoGrowthRate, setCryptoGrowthRate] = useState<number>(DEFAULT_GROWTH_RATES.cryptoGrowthRate);
  const [jobs, setJobs] = useState<JobEntry[]>([]);
  const [salaries, setSalaries] = useState<SalaryEntry[]>([]);
  const [bonuses, setBonuses] = useState<BonusEntry[]>([]);
  const [overtime, setOvertime] = useState<OvertimeEntry[]>([]);
  const [hoursSnapshots, setHoursSnapshots] = useState<HoursSnapshot[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [inflation, setInflation] = useState<InflationPoint[]>([]);
  const [inflationStale, setInflationStale] = useState<boolean>(false);
  const [wageStats, setWageStats] = useState<WageStatPoint[]>([]);
  const [region, setRegion] = useState<Region>('no');
  const [customTaxRatePct, setCustomTaxRatePct] = useState<number>(DEFAULT_TAX_RATES.customTaxRatePct);
  const [employerCostConfig, setEmployerCostConfig] = useState<EmployerCostConfig>(DEFAULT_EMPLOYER_COST_CONFIG);
  const [billingConfig, setBillingConfig] = useState<BillingRateConfig>(DEFAULT_BILLING_CONFIG);
  const [hiddenNavItems, setHiddenNavItems] = useState<string[]>([]);
  const [demoMode, setDemoMode] = useState(false);

  const loaded = useRef(false);
  // Holds the user's real data while demo mode is active, so it can be restored
  // on exit. In-memory only — a page reload exits demo mode and reloads the real
  // data from the backend (which demo mode never overwrites).
  const demoSnapshot = useRef<Partial<ExportPayload> | null>(null);
  const [dataLoadFailed, setDataLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ATTEMPTS = 3;

    const applyData = (data: Partial<ExportPayload> | null) => {
        if (data) {
          setIncome(data.income ?? 55000);
          setMonthlyIncomes(data.monthlyIncomes ?? {});
          setPayslips(data.payslips ?? {});
          setNetWorthHistory(data.netWorthHistory ?? {});
          setBalanceSnapshots(data.balanceSnapshots ?? {});
          setFixedExpenses(data.fixedExpenses ?? DEFAULT_FIXED_EXPENSES);
          setDebts(data.debts ?? []);
          setDailyTransactions(data.dailyTransactions ?? []);
          setAssets({ ...DEFAULT_ASSETS, ...(data.assets ?? {}) });
          setLoan(data.loan ?? DEFAULT_LOAN);
          setPension({ ...DEFAULT_PENSION, ...(data.pension ?? {}) });
          setRecurringTemplates(data.recurringTemplates ?? []);
          setHousingMode(data.housingMode ?? 'first_buyer');
          setHomeowner({ ...DEFAULT_HOMEOWNER, ...(data.homeowner ?? {}) });
          setTransition({ ...DEFAULT_TRANSITION, ...(data.transition ?? {}) });
          if (data.lang) setLang(data.lang);
          // `currentMonth` is view state, no longer persisted — ignore any value
          // in legacy blobs so each device opens on its own current month.
          if (data.savingsTargetPercent !== undefined) setSavingsTargetPercent(data.savingsTargetPercent);
          if (data.growthReturnRate !== undefined) setGrowthReturnRate(data.growthReturnRate);
          if (data.houseGrowthRate !== undefined) setHouseGrowthRate(data.houseGrowthRate);
          if (data.cashGrowthRate !== undefined) setCashGrowthRate(data.cashGrowthRate);
          if (data.cryptoGrowthRate !== undefined) setCryptoGrowthRate(data.cryptoGrowthRate);
          if (data.displayCurrency) setDisplayCurrency(data.displayCurrency);
          if (data.nokToUsd !== undefined) setNokToUsdState(data.nokToUsd);
          if (data.customCurrencyCode !== undefined) setCustomCurrencyCode(data.customCurrencyCode);
          if (data.customCurrencyRate !== undefined) setCustomCurrencyRate(data.customCurrencyRate);
          if (Array.isArray(data.jobs)) setJobs(data.jobs);
          if (Array.isArray(data.salaries)) setSalaries(data.salaries);
          if (Array.isArray(data.bonuses)) setBonuses(data.bonuses);
          if (Array.isArray(data.overtime)) setOvertime(data.overtime);
          if (Array.isArray(data.hoursSnapshots)) setHoursSnapshots(data.hoursSnapshots);
          if (Array.isArray(data.goals)) setGoals(data.goals);
          if (data.region === 'no' || data.region === 'generic') setRegion(data.region);
          if (typeof data.customTaxRatePct === 'number') setCustomTaxRatePct(data.customTaxRatePct);
          setEmployerCostConfig({ ...DEFAULT_EMPLOYER_COST_CONFIG, ...(data.employerCostConfig ?? {}) });
          setBillingConfig({ ...DEFAULT_BILLING_CONFIG, ...(data.billingConfig ?? {}) });
          if (Array.isArray(data.hiddenNavItems)) setHiddenNavItems(data.hiddenNavItems);
        }
    };

    // Retry the initial load a few times: a transient miss (e.g. a network
    // hiccup around service-worker activation) otherwise leaves the app showing
    // empty defaults until a manual refresh. Crucially, `loaded.current` is set
    // ONLY on a successful response — including a genuinely empty DB (data ===
    // null on first run, which should be allowed to seed). If every attempt
    // fails we leave it false so the auto-save effect can never overwrite the
    // stored data with empty defaults.
    const load = async () => {
      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        try {
          const r = await fetch('/api/data');
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = await r.json();
          if (cancelled) return;
          applyData(data);
          loaded.current = true;
          return;
        } catch {
          if (attempt < ATTEMPTS) {
            await new Promise(res => setTimeout(res, attempt * 400));
          }
        }
      }
      if (!cancelled) setDataLoadFailed(true);
    };

    load();
    return () => { cancelled = true; };
  }, []);

  // Fetch SSB wage statistics when region is Norway. Hidden in generic mode.
  useEffect(() => {
    if (region !== 'no') {
      // Intentional reset of fetched data when leaving Norway region.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWageStats([]);
      return;
    }
    fetch('/api/wage-stats')
      .then(r => r.ok ? r.json() : null)
      .then((data) => {
        if (data && Array.isArray(data.points)) setWageStats(data.points);
      })
      .catch(() => {});
  }, [region]);

  // Fetch SSB inflation data when region is Norway. In 'generic' mode we
  // don't have inflation source for the user's country, so we skip the call
  // and the UI hides inflation-dependent features.
  useEffect(() => {
    if (region !== 'no') {
      // Intentional reset of fetched data when leaving Norway region.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInflation([]);
      setInflationStale(false);
      return;
    }
    const now = new Date();
    const to = format(now, 'yyyy-MM');
    const from = format(new Date(now.getFullYear() - 12, now.getMonth(), 1), 'yyyy-MM');
    fetch(`/api/inflation?from=${from}&to=${to}`)
      .then(r => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) { setInflationStale(true); return; }
        if (Array.isArray(data.points)) setInflation(data.points);
        if (data.stale) setInflationStale(true);
      })
      .catch(() => setInflationStale(true));
  }, [region]);

  // Auto-save plumbing. The save is debounced (a slider drag or paging the month
  // picker would otherwise fire dozens of full-state POSTs), in-flight requests
  // are aborted so a slow save can't land after a newer one (last-write-wins with
  // a stale payload), failures surface a banner + retry with backoff, and pending
  // changes are flushed on tab hide/close so nothing is silently lost.
  const payloadRef = useRef<Record<string, unknown> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveAbort = useRef<AbortController | null>(null);
  const saveDirty = useRef(false);
  const saveRetries = useRef(0);
  // Lets the backoff retry re-invoke the latest doSave without the callback
  // referencing itself before it's declared.
  const doSaveRef = useRef<() => void>(() => {});

  const doSave = useCallback(async () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const payload = payloadRef.current;
    if (!payload) return;
    // Supersede any in-flight save so it can't complete after this one.
    saveAbort.current?.abort();
    const ctrl = new AbortController();
    saveAbort.current = ctrl;
    try {
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      saveDirty.current = false;
      saveRetries.current = 0;
      setSaveFailed(false);
    } catch {
      if (ctrl.signal.aborted) return; // replaced by a newer save — not a failure
      setSaveFailed(true);
      // Exponential backoff, capped at 30s. saveDirty stays true.
      saveRetries.current += 1;
      const delay = Math.min(30_000, 1_000 * 2 ** (saveRetries.current - 1));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { doSaveRef.current(); }, delay);
    }
  }, []);
  useEffect(() => { doSaveRef.current = doSave; }, [doSave]);

  // Manual retry from the banner.
  const retrySave = useCallback(() => { saveRetries.current = 0; void doSave(); }, [doSave]);

  useEffect(() => {
    if (!loaded.current) return;
    // Never persist while showing demo data — that would clobber the user's real
    // data on the backend. The real data stays safe in `demoSnapshot` until exit.
    if (demoMode) return;
    payloadRef.current = {
      income, monthlyIncomes, payslips, netWorthHistory, balanceSnapshots, fixedExpenses, dailyTransactions, debts,
      assets, loan, pension, recurringTemplates, housingMode, homeowner, transition,
      lang,
      savingsTargetPercent, growthReturnRate, houseGrowthRate, cashGrowthRate, cryptoGrowthRate, displayCurrency, nokToUsd,
      customCurrencyCode, customCurrencyRate,
      jobs, salaries, bonuses, overtime, hoursSnapshots, goals,
      region, customTaxRatePct, employerCostConfig, billingConfig, hiddenNavItems,
    };
    saveDirty.current = true;
    // Debounce: reschedule on every change; the trailing call flushes once quiet.
    saveRetries.current = 0;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void doSave(); }, 500);
    // NB: `currentMonth` is deliberately NOT persisted or in these deps — it's
    // view state, so paging the month picker must not fire saves, and two devices
    // shouldn't fight over which month is "current".
  }, [income, monthlyIncomes, payslips, netWorthHistory, balanceSnapshots, fixedExpenses, dailyTransactions, debts, assets, loan, pension, recurringTemplates, housingMode, homeowner, transition, lang, savingsTargetPercent, growthReturnRate, houseGrowthRate, cashGrowthRate, cryptoGrowthRate, displayCurrency, nokToUsd, customCurrencyCode, customCurrencyRate, jobs, salaries, bonuses, overtime, hoursSnapshots, goals, region, customTaxRatePct, employerCostConfig, billingConfig, hiddenNavItems, demoMode, doSave]);

  // Flush pending changes when the tab is hidden or closed. sendBeacon survives
  // page teardown where a normal fetch would be cancelled; the server accepts the
  // JSON blob the same as a normal POST.
  useEffect(() => {
    const flush = () => {
      if (!loaded.current || demoMode || !saveDirty.current || !payloadRef.current) return;
      const ok = navigator.sendBeacon?.(
        '/api/data',
        new Blob([JSON.stringify(payloadRef.current)], { type: 'application/json' }),
      );
      if (ok) saveDirty.current = false;
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // Only nag when a save is actually failing — a clean close flushes via the
      // beacon above, so we don't want to prompt on every debounced edit.
      if (saveFailed && saveDirty.current && !demoMode) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [demoMode, saveFailed]);

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

  // Derived monthly net income from the salary system (latest applicable salary + on-call → tax → net).
  // Falls back to the legacy static `income` when no salaries have been entered.
  // Net monthly income derived from the salary system for an arbitrary month
  // (falls back to the legacy static `income` when no salaries exist).
  const derivedNetMonthlyFor = useCallback((mKey: string): number => {
    if (salaries.length === 0) return income;
    const totalAnnual = calcActiveGrossAnnual(salaries, jobs, mKey);
    if (totalAnnual === 0) return income;
    return Math.round(calcTaxByRegion(totalAnnual, region, customTaxRatePct, pension.ipsAnnualContribution).netMonthly);
  }, [salaries, jobs, region, customTaxRatePct, income, pension.ipsAnnualContribution]);

  const derivedMonthlyIncome = useMemo(
    () => derivedNetMonthlyFor(monthKey),
    [derivedNetMonthlyFor, monthKey],
  );

  // Gross annual employment income active this month (before tax) — falls back to
  // the legacy static `income` annualised when no salaries have been entered.
  const grossAnnualIncome = useMemo(() => {
    const fromSalaries = calcActiveGrossAnnual(salaries, jobs, monthKey);
    if (fromSalaries > 0) return fromSalaries;
    return income * 12;
  }, [salaries, jobs, monthKey, income]);

  const isMonthlyIncomeOverridden = monthlyIncomes[monthKey] !== undefined;

  const effectiveIncome = useMemo(() =>
    monthlyIncomes[monthKey] ?? derivedMonthlyIncome,
  [monthlyIncomes, monthKey, derivedMonthlyIncome]);

  // Last-12-months income series (relative to the selected month): each month is
  // its manual override if set, otherwise the income derived for THAT month. This
  // reflects real income history — averaging only the overrides map (any months
  // ever set, including the future) badly skews the mean and volatility.
  const incomeSeries = useMemo(() => {
    const series: number[] = [];
    for (let i = 11; i >= 0; i--) {
      const mKey = format(subMonths(currentMonth, i), 'yyyy-MM');
      series.push(monthlyIncomes[mKey] ?? derivedNetMonthlyFor(mKey));
    }
    return series;
  }, [monthlyIncomes, currentMonth, derivedNetMonthlyFor]);

  const averageIncome = useMemo(
    () => Math.round(incomeSeries.reduce((s, v) => s + v, 0) / incomeSeries.length),
    [incomeSeries],
  );

  const incomeVolatility = useMemo(() => {
    // Divide by the EXACT mean (not the rounded averageIncome).
    const mean = incomeSeries.reduce((s, v) => s + v, 0) / incomeSeries.length;
    if (mean <= 0) return 0;
    const variance = incomeSeries.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / incomeSeries.length;
    return Math.sqrt(variance) / mean;
  }, [incomeSeries]);

  const { recommendedSpending, recommendedInvestment, suggestedInvestment, conservativeMode, conservativeReason } = useMemo(() =>
    calcRecommendations(effectiveIncome, averageIncome, totalFixedExpenses, incomeVolatility, savingsTargetPercent),
  [effectiveIncome, averageIncome, totalFixedExpenses, incomeVolatility, savingsTargetPercent]);

  const setMonthlyIncomeForMonth = (key: string, amount: number) => {
    setMonthlyIncomes(prev => ({ ...prev, [key]: amount }));
  };

  const clearMonthlyIncomeForMonth = (key: string) => {
    setMonthlyIncomes(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const setPayslip = (key: string, data: MonthlyPayslip) => {
    setPayslips(prev => ({ ...prev, [key]: data }));
  };

  const removePayslip = (key: string) => {
    setPayslips(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // Manually record (or correct) the net worth for a past month, so the history
  // chart reflects the user's real numbers instead of interpolated estimates.
  // The current real month is not edited here — it auto-snapshots from live equity.
  const setNetWorthForMonth = (key: string, value: number) => {
    setNetWorthHistory(prev => ({ ...prev, [key]: Math.round(value) }));
  };

  const clearNetWorthForMonth = (key: string) => {
    setNetWorthHistory(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
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
    const result: DailyDataEntry[] = [];
    let runningBalance = 0;
    for (const day of monthInterval) {
      const dateStr = format(day, 'yyyy-MM-dd');
      const dayTransactions = transactionsForMonth.filter(t => t.date === dateStr);
      // Only expenses count as "spent"; income (undefined kind = expense for
      // legacy rows) instead adds to the running balance.
      const spentToday = dayTransactions
        .filter(t => t.kind !== 'income')
        .reduce((sum, t) => sum + t.amount, 0);
      const incomeToday = dayTransactions
        .filter(t => t.kind === 'income')
        .reduce((sum, t) => sum + t.amount, 0);
      runningBalance += dailyBudget - spentToday + incomeToday;
      result.push({
        date: day,
        dateStr,
        spent: spentToday,
        balance: runningBalance,
        transactions: dayTransactions
      });
    }
    return result;
  }, [monthInterval, transactionsForMonth, dailyBudget]);

  // Latent tax floored at 0: a loss (negative gain) is not a liquid asset, so it
  // must not inflate net worth. The UI clamps inputs ≥0 but JSON import does not.
  const { taxOnGain, netInvestment, houseEquity, cryptoTaxOnGain, netCrypto, totalEquity } = computeEquityBreakdown(assets);
  // `totalEquity` is the asset-side figure (mortgage already netted in houseEquity).
  // Non-mortgage debts reduce it further to give true net worth.
  const totalDebt = debts.reduce((s, d) => s + Math.max(0, d.balance), 0);
  const netWorth = totalEquity - totalDebt;
  // Single source of truth for the mortgage rate/term used by net-worth projections,
  // selected by the active housing mode (first-buyer & transitioning use the `loan`
  // inputs; homeowner uses the `homeowner` inputs).
  const mortgageRate = housingMode === 'homeowner' ? homeowner.rente : loan.rente;
  const mortgageTermYears = housingMode === 'homeowner' ? homeowner.nedbetalingstid : loan.nedbetalingstid;

  // Snapshot current month's net worth whenever equity changes (only for the current real month)
  useEffect(() => {
    if (!loaded.current) return;
    if (monthKey !== format(new Date(), 'yyyy-MM')) return;
    // Deliberate: snapshot the current month's net worth into persisted state when equity changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNetWorthHistory(prev => ({ ...prev, [monthKey]: Math.round(totalEquity) }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalEquity]);

  // Capture the full balance state for the current calendar month whenever it
  // changes, so the balance pages can be viewed historically later. This state is
  // not month-scoped, so we always target the real current month regardless of the
  // selected month.
  useEffect(() => {
    if (!loaded.current) return;
    const nowKey = format(new Date(), 'yyyy-MM');
    setBalanceSnapshots(prev => ({
      ...prev,
      [nowKey]: { assets, loan, pension, homeowner, transition, housingMode },
    }));
  }, [assets, loan, pension, homeowner, transition, housingMode]);

  const updateAsset = (key: keyof Assets, value: number) => {
    setAssets(prev => ({ ...prev, [key]: value }));
    // In homeowner mode the mortgage is one real debt edited in two places
    // (assets.houseDebt drives net worth; homeowner.currentMortgageBalance drives
    // LTV/payment). Keep them in lockstep so the two views can't contradict.
    if (key === 'houseDebt' && housingMode === 'homeowner') {
      setHomeowner(prev => ({ ...prev, currentMortgageBalance: value }));
    }
  };

  const updateLoan = (key: keyof LoanData, value: number | string) => {
    setLoan(prev => ({ ...prev, [key]: value }));
  };

  const updatePension = (key: keyof Pension, value: number) => {
    setPension(prev => ({ ...prev, [key]: value }));
  };

  const updateEmployerCostConfig = (key: keyof EmployerCostConfig, value: number) => {
    setEmployerCostConfig(prev => ({ ...prev, [key]: value }));
  };

  const updateBillingConfig = (key: keyof BillingRateConfig, value: number | null) => {
    setBillingConfig(prev => ({ ...prev, [key]: value }));
  };

  const toggleNavItem = (path: string) => {
    setHiddenNavItems(prev => prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]);
  };

  const updateHomeowner = (key: keyof HomeownerData, value: number) => {
    setHomeowner(prev => ({ ...prev, [key]: value }));
    // Mirror the mortgage balance into assets.houseDebt (see updateAsset) so net
    // worth and the loan page never show contradictory debt in homeowner mode.
    if (key === 'currentMortgageBalance' && housingMode === 'homeowner') {
      setAssets(prev => ({ ...prev, houseDebt: value }));
    }
  };

  const updateTransition = (key: keyof TransitionData, value: number) => {
    setTransition(prev => ({ ...prev, [key]: value }));
  };

  // User-facing housing-mode switch. Entering homeowner mode reconciles any
  // pre-existing drift by treating currentMortgageBalance (the actively-
  // maintained real mortgage) as canonical for net worth. Internal load paths
  // use the raw setHousingMode so they don't trigger this side effect.
  const changeHousingMode = (mode: HousingMode) => {
    setHousingMode(mode);
    if (mode === 'homeowner') {
      setAssets(prev => ({ ...prev, houseDebt: homeowner.currentMortgageBalance }));
    }
  };

  const makeId = (prefix: string) =>
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  const addJob = (job: Omit<JobEntry, 'id'>): string => {
    const id = makeId('job');
    setJobs(prev => [...prev, { ...job, id }]);
    return id;
  };
  const updateJob = (id: string, patch: Partial<Omit<JobEntry, 'id'>>) => {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, ...patch } : j));
  };
  const removeJob = (id: string) => {
    setJobs(prev => prev.filter(j => j.id !== id));
    // Cascade: remove orphaned salaries
    setSalaries(prev => prev.filter(s => s.jobId !== id));
  };

  const addSalary = (entry: Omit<SalaryEntry, 'id'>): string => {
    const id = makeId('sal');
    setSalaries(prev => [...prev, { ...entry, id }]);
    return id;
  };
  const updateSalary = (id: string, patch: Partial<Omit<SalaryEntry, 'id'>>) => {
    setSalaries(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  };
  const removeSalary = (id: string) => {
    setSalaries(prev => prev.filter(s => s.id !== id));
  };

  const addBonus = (entry: Omit<BonusEntry, 'id'>) => {
    setBonuses(prev => [...prev, { ...entry, id: makeId('bon') }]);
  };
  const updateBonus = (id: string, patch: Partial<Omit<BonusEntry, 'id'>>) => {
    setBonuses(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
  };
  const removeBonus = (id: string) => {
    setBonuses(prev => prev.filter(b => b.id !== id));
  };

  const addOvertime = (entry: Omit<OvertimeEntry, 'id'>) => {
    setOvertime(prev => [...prev, { ...entry, id: makeId('ot') }]);
  };
  const updateOvertime = (id: string, patch: Partial<Omit<OvertimeEntry, 'id'>>) => {
    setOvertime(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o));
  };
  const removeOvertime = (id: string) => {
    setOvertime(prev => prev.filter(o => o.id !== id));
  };

  const addHoursSnapshot = (entry: Omit<HoursSnapshot, 'id'>) => {
    setHoursSnapshots(prev => [...prev, { ...entry, id: makeId('hrs') }]);
  };
  const updateHoursSnapshot = (id: string, patch: Partial<Omit<HoursSnapshot, 'id'>>) => {
    setHoursSnapshots(prev => prev.map(h => h.id === id ? { ...h, ...patch } : h));
  };
  const removeHoursSnapshot = (id: string) => {
    setHoursSnapshots(prev => prev.filter(h => h.id !== id));
  };

  const addGoal = (g: Omit<Goal, 'id'>) => {
    setGoals(prev => [...prev, { ...g, id: makeId('goal') }]);
  };
  const updateGoal = (id: string, patch: Partial<Omit<Goal, 'id'>>) => {
    setGoals(prev => prev.map(g => g.id === id ? { ...g, ...patch } : g));
  };
  const removeGoal = (id: string) => {
    setGoals(prev => prev.filter(g => g.id !== id));
  };

  const importAll = (data: Partial<ExportPayload>) => {
    if (data.income !== undefined) setIncome(data.income);
    if (data.monthlyIncomes !== undefined) setMonthlyIncomes(data.monthlyIncomes);
    if (data.payslips !== undefined) setPayslips(data.payslips);
    if (data.netWorthHistory !== undefined) setNetWorthHistory(data.netWorthHistory);
    if (data.balanceSnapshots !== undefined) setBalanceSnapshots(data.balanceSnapshots);
    if (data.fixedExpenses) setFixedExpenses(data.fixedExpenses);
    if (data.debts) setDebts(data.debts);
    if (data.dailyTransactions) setDailyTransactions(data.dailyTransactions);
    if (data.assets) setAssets({ ...DEFAULT_ASSETS, ...data.assets });
    if (data.pension) setPension({ ...DEFAULT_PENSION, ...data.pension });
    if (data.loan) setLoan(data.loan);
    if (data.recurringTemplates !== undefined) setRecurringTemplates(data.recurringTemplates);
    if (data.housingMode !== undefined) setHousingMode(data.housingMode);
    if (data.homeowner) setHomeowner({ ...DEFAULT_HOMEOWNER, ...data.homeowner });
    if (data.transition) setTransition({ ...DEFAULT_TRANSITION, ...data.transition });
    if (data.lang) setLang(data.lang);
    // `currentMonth` is view state, not persisted — ignore it on import too.
    if (data.savingsTargetPercent !== undefined) setSavingsTargetPercent(data.savingsTargetPercent);
    if (data.growthReturnRate !== undefined) setGrowthReturnRate(data.growthReturnRate);
    if (data.houseGrowthRate !== undefined) setHouseGrowthRate(data.houseGrowthRate);
    if (data.cashGrowthRate !== undefined) setCashGrowthRate(data.cashGrowthRate);
    if (data.cryptoGrowthRate !== undefined) setCryptoGrowthRate(data.cryptoGrowthRate);
    if (data.displayCurrency) setDisplayCurrency(data.displayCurrency);
    if (data.nokToUsd !== undefined) setNokToUsdState(data.nokToUsd);
    if (data.customCurrencyCode !== undefined) setCustomCurrencyCode(data.customCurrencyCode);
    if (data.customCurrencyRate !== undefined) setCustomCurrencyRate(data.customCurrencyRate);
    if (Array.isArray(data.jobs)) setJobs(data.jobs);
    if (Array.isArray(data.salaries)) setSalaries(data.salaries);
    if (Array.isArray(data.bonuses)) setBonuses(data.bonuses);
    if (Array.isArray(data.overtime)) setOvertime(data.overtime);
    if (Array.isArray(data.hoursSnapshots)) setHoursSnapshots(data.hoursSnapshots);
    if (Array.isArray(data.goals)) setGoals(data.goals);
    if (data.region === 'no' || data.region === 'generic') setRegion(data.region);
    if (typeof data.customTaxRatePct === 'number') setCustomTaxRatePct(data.customTaxRatePct);
    if (data.employerCostConfig) setEmployerCostConfig({ ...DEFAULT_EMPLOYER_COST_CONFIG, ...data.employerCostConfig });
    if (data.billingConfig) setBillingConfig({ ...DEFAULT_BILLING_CONFIG, ...data.billingConfig });
    if (Array.isArray(data.hiddenNavItems)) setHiddenNavItems(data.hiddenNavItems);
  };

  // --- Demo mode: swap real data for a fictional dataset, then restore it ---
  // The real data is held in `demoSnapshot` (memory) and the auto-save effect is
  // suspended while demoMode is true, so the backend keeps the real data intact.
  const enableDemoMode = () => {
    if (demoMode) return;
    demoSnapshot.current = {
      income, monthlyIncomes, payslips, netWorthHistory, balanceSnapshots, fixedExpenses, dailyTransactions, debts,
      assets, loan, pension, recurringTemplates, housingMode, homeowner, transition,
      lang, currentMonth: format(currentMonth, 'yyyy-MM'),
      savingsTargetPercent, growthReturnRate, houseGrowthRate, cashGrowthRate, cryptoGrowthRate,
      displayCurrency, nokToUsd, customCurrencyCode, customCurrencyRate,
      jobs, salaries, bonuses, overtime, hoursSnapshots, goals,
      region, customTaxRatePct, employerCostConfig, billingConfig, hiddenNavItems,
    };
    setDemoMode(true);
    importAll(getDemoData());
  };

  const disableDemoMode = () => {
    if (!demoMode) return;
    const snapshot = demoSnapshot.current;
    setDemoMode(false);
    if (snapshot) importAll(snapshot);
    demoSnapshot.current = null;
  };

  const toggleDemoMode = () => {
    if (demoMode) disableDemoMode();
    else enableDemoMode();
  };

  const resetAll = () => {
    setIncome(0);
    setMonthlyIncomes({});
    setNetWorthHistory({});
    setBalanceSnapshots({});
    setFixedExpenses([]);
    setDebts([]);
    setDailyTransactions([]);
    setRecurringTemplates([]);
    setAssets({
      portfolio: 0, unrealizedGain: 0, taxRate: 37.84,
      bsu: 0, savings: 0, houseValue: 0, houseDebt: 0,
      crypto: 0, cryptoUnrealizedGain: 0, cryptoTaxRate: 22,
      bufferAccount: 0,
    });
    setLoan({
      arslonn: 0, eksisterendeGjeld: 0, egenkapital: 0,
      laanebelop: 0, rente: 0, nedbetalingstid: 0, termingebyr: 0,
      etableringsgebyr: 0, skattefradragssats: 0,
      betingetLaan: 0, kjoepesum: 0, gyldigTil: '',
    });
    setHomeowner({
      currentMortgageBalance: 0, originalLoanAmount: 0,
      rente: 0, nedbetalingstid: 0, termingebyr: 0, skattefradragssats: 0,
    });
    setTransition({
      currentHouseValue: 0, currentMortgageBalance: 0,
      agentFeePercent: 0, documentFee: 0, otherSaleCosts: 0,
      bridgeMonths: 0, bridgeLoanRate: 0,
    });
    setPension({
      otpBalance: 0, otpEmployerPct: 0, otpEmployeePct: 0, otpGrowthRate: 5,
      ipsBalance: 0, ipsAnnualContribution: 0, ipsGrowthRate: 7,
      birthYear: 0, retirementAge: 67,
    });
    setJobs([]);
    setSalaries([]);
    setBonuses([]);
    setOvertime([]);
    setHoursSnapshots([]);
    setGoals([]);
    setEmployerCostConfig(DEFAULT_EMPLOYER_COST_CONFIG);
    setBillingConfig(DEFAULT_BILLING_CONFIG);
  };

  // --- Restore data-based defaults (assumptions only — never touches balances/data) ---
  const restoreGrowthRateDefaults = () => {
    setGrowthReturnRate(DEFAULT_GROWTH_RATES.growthReturnRate);
    setHouseGrowthRate(DEFAULT_GROWTH_RATES.houseGrowthRate);
    setCashGrowthRate(DEFAULT_GROWTH_RATES.cashGrowthRate);
    setCryptoGrowthRate(DEFAULT_GROWTH_RATES.cryptoGrowthRate);
  };

  const restoreAssetTaxDefaults = () => {
    updateAsset('taxRate', DEFAULT_TAX_RATES.stockTaxRate);
    updateAsset('cryptoTaxRate', DEFAULT_TAX_RATES.cryptoTaxRate);
  };

  const restoreCustomTaxRateDefault = () => {
    setCustomTaxRatePct(DEFAULT_TAX_RATES.customTaxRatePct);
  };

  const restorePensionAssumptionDefaults = () => {
    updatePension('otpEmployerPct', DEFAULT_PENSION.otpEmployerPct);
    updatePension('otpEmployeePct', DEFAULT_PENSION.otpEmployeePct);
    updatePension('otpGrowthRate', DEFAULT_PENSION.otpGrowthRate);
    updatePension('ipsGrowthRate', DEFAULT_PENSION.ipsGrowthRate);
    updatePension('retirementAge', DEFAULT_PENSION.retirementAge);
  };

  const restoreEmployerCostDefaults = () => {
    setEmployerCostConfig(DEFAULT_EMPLOYER_COST_CONFIG);
    setBillingConfig(DEFAULT_BILLING_CONFIG);
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

  // Like formatCurrency but without decimals — for chart labels/legends where
  // 2-decimal precision is noise. Respects the user's display currency so
  // converted values (USD/custom) stay correct.
  const formatCurrencyShort = (val: number) => {
    if (displayCurrency === 'USD') {
      return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'USD', maximumFractionDigits: 0,
      }).format(val * nokToUsd);
    }
    if (displayCurrency === 'custom' && customCurrencyCode) {
      const converted = val * customCurrencyRate;
      try {
        return new Intl.NumberFormat('en', {
          style: 'currency', currency: customCurrencyCode.toUpperCase(), maximumFractionDigits: 0,
        }).format(converted);
      } catch {
        return `${customCurrencyCode.toUpperCase()} ${Math.round(converted).toLocaleString('en-US')}`;
      }
    }
    return new Intl.NumberFormat(lang === 'nb' ? 'nb-NO' : 'en-US', {
      style: 'currency', currency: 'NOK', maximumFractionDigits: 0,
    }).format(val);
  };

  return (
    <FinanceContext.Provider value={{
      lang, setLang, t, displayCurrency, setDisplayCurrency, nokToUsd, setNokToUsd,
      customCurrencyCode, setCustomCurrencyCode, customCurrencyRate, setCustomCurrencyRate,
      currentMonth, setCurrentMonth, income, setIncome,
      monthlyIncomes, setMonthlyIncomeForMonth, clearMonthlyIncomeForMonth,
      payslips, setPayslip, removePayslip,
      derivedMonthlyIncome, grossAnnualIncome, isMonthlyIncomeOverridden,
      netWorthHistory, setNetWorthForMonth, clearNetWorthForMonth, balanceSnapshots, prevMonthIncome, prevMonthSpending,
      effectiveIncome, averageIncome,
      savingsTargetPercent, setSavingsTargetPercent,
      recommendedSpending, recommendedInvestment, suggestedInvestment, conservativeMode, conservativeReason,
      fixedExpenses, setFixedExpenses, dailyTransactions, setDailyTransactions,
      debts, setDebts, totalDebt, netWorth,
      recurringTemplates, setRecurringTemplates,
      assets, updateAsset, loan, updateLoan, pension, updatePension,
      housingMode, setHousingMode: changeHousingMode, homeowner, updateHomeowner, transition, updateTransition,
      mortgageRate, mortgageTermYears,
      growthReturnRate, setGrowthReturnRate,
      houseGrowthRate, setHouseGrowthRate,
      cashGrowthRate, setCashGrowthRate,
      cryptoGrowthRate, setCryptoGrowthRate,
      jobs, addJob, updateJob, removeJob,
      salaries, addSalary, updateSalary, removeSalary,
      bonuses, addBonus, updateBonus, removeBonus,
      overtime, addOvertime, updateOvertime, removeOvertime,
      hoursSnapshots, addHoursSnapshot, updateHoursSnapshot, removeHoursSnapshot,
      goals, addGoal, updateGoal, removeGoal,
      inflation, inflationStale, wageStats,
      region, setRegion, customTaxRatePct, setCustomTaxRatePct,
      employerCostConfig, updateEmployerCostConfig, billingConfig, updateBillingConfig,
      hiddenNavItems, toggleNavItem,
      totalResidual,
      totalFixedExpenses, monthlyBudget, dailyBudget,
      dailyData, totalEquity, taxOnGain, netInvestment, houseEquity, cryptoTaxOnGain, netCrypto,
      formatCurrency, formatCurrencyShort, importAll, resetAll,
      restoreGrowthRateDefaults, restoreAssetTaxDefaults, restoreCustomTaxRateDefault,
      restorePensionAssumptionDefaults, restoreEmployerCostDefaults,
      demoMode, toggleDemoMode,
      dataLoadFailed,
      saveFailed, retrySave,
    }}>
      {children}
    </FinanceContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useFinance() {
  const context = useContext(FinanceContext);
  if (context === undefined) {
    throw new Error('useFinance must be used within a FinanceProvider');
  }
  return context;
}
