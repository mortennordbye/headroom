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
import { calcTaxByRegion } from '../lib/norwegianTax';
import {
  type EmployerCostConfig,
  type BillingRateConfig,
  DEFAULT_EMPLOYER_COST_CONFIG,
  DEFAULT_BILLING_CONFIG,
} from '../lib/employerCost';

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
    today: 'I dag',
    viewingPast: 'Historisk måned',
    viewingFuture: 'Fremtidig måned',
    viewingCurrent: 'Denne måneden',
    salary: {
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
    today: 'Today',
    viewingPast: 'Past month',
    viewingFuture: 'Future month',
    viewingCurrent: 'Current month',
    salary: {
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

const DEFAULT_PENSION: Pension = {
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
  derivedMonthlyIncome: number;
  isMonthlyIncomeOverridden: boolean;
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
  dataLoadFailed: boolean;
}

export interface ExportPayload {
  income: number;
  fixedExpenses: FixedExpense[];
  dailyTransactions: DailyTransaction[];
  assets: Assets;
  loan: LoanData;
  pension?: Pension;
  recurringTemplates: TransactionTemplate[];
  monthlyIncomes?: Record<string, number>;
  netWorthHistory?: Record<string, number>;
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
  const [netWorthHistory, setNetWorthHistory] = useState<Record<string, number>>({});
  const [savingsTargetPercent, setSavingsTargetPercent] = useState<number>(20);
  const [fixedExpenses, setFixedExpenses] = useState<FixedExpense[]>(DEFAULT_FIXED_EXPENSES);
  const [dailyTransactions, setDailyTransactions] = useState<DailyTransaction[]>([]);
  const [recurringTemplates, setRecurringTemplates] = useState<TransactionTemplate[]>([]);
  const [assets, setAssets] = useState<Assets>(DEFAULT_ASSETS);
  const [loan, setLoan] = useState<LoanData>(DEFAULT_LOAN);
  const [pension, setPension] = useState<Pension>(DEFAULT_PENSION);
  const [housingMode, setHousingMode] = useState<HousingMode>('first_buyer');
  const [homeowner, setHomeowner] = useState<HomeownerData>(DEFAULT_HOMEOWNER);
  const [transition, setTransition] = useState<TransitionData>(DEFAULT_TRANSITION);
  const [growthReturnRate, setGrowthReturnRate] = useState<number>(7);
  const [houseGrowthRate, setHouseGrowthRate] = useState<number>(3);
  const [cashGrowthRate, setCashGrowthRate] = useState<number>(1);
  const [cryptoGrowthRate, setCryptoGrowthRate] = useState<number>(0);
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
  const [customTaxRatePct, setCustomTaxRatePct] = useState<number>(30);
  const [employerCostConfig, setEmployerCostConfig] = useState<EmployerCostConfig>(DEFAULT_EMPLOYER_COST_CONFIG);
  const [billingConfig, setBillingConfig] = useState<BillingRateConfig>(DEFAULT_BILLING_CONFIG);
  const [hiddenNavItems, setHiddenNavItems] = useState<string[]>([]);

  const loaded = useRef(false);
  const [dataLoadFailed, setDataLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ATTEMPTS = 3;

    const applyData = (data: Partial<ExportPayload> | null) => {
        if (data) {
          setIncome(data.income ?? 55000);
          setMonthlyIncomes(data.monthlyIncomes ?? {});
          setNetWorthHistory(data.netWorthHistory ?? {});
          setFixedExpenses(data.fixedExpenses ?? DEFAULT_FIXED_EXPENSES);
          setDailyTransactions(data.dailyTransactions ?? []);
          setAssets({ ...DEFAULT_ASSETS, ...(data.assets ?? {}) });
          setLoan(data.loan ?? DEFAULT_LOAN);
          setPension({ ...DEFAULT_PENSION, ...(data.pension ?? {}) });
          setRecurringTemplates(data.recurringTemplates ?? []);
          setHousingMode(data.housingMode ?? 'first_buyer');
          setHomeowner({ ...DEFAULT_HOMEOWNER, ...(data.homeowner ?? {}) });
          setTransition({ ...DEFAULT_TRANSITION, ...(data.transition ?? {}) });
          if (data.lang) setLang(data.lang);
          if (data.currentMonth) {
            const [y, m] = data.currentMonth.split('-').map(Number);
            if (!isNaN(y) && !isNaN(m)) setCurrentMonth(new Date(y, m - 1, 1));
          }
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

  useEffect(() => {
    if (!loaded.current) return;
    const payload = {
      income, monthlyIncomes, netWorthHistory, fixedExpenses, dailyTransactions,
      assets, loan, pension, recurringTemplates, housingMode, homeowner, transition,
      lang, currentMonth: format(currentMonth, 'yyyy-MM'),
      savingsTargetPercent, growthReturnRate, houseGrowthRate, cashGrowthRate, cryptoGrowthRate, displayCurrency, nokToUsd,
      customCurrencyCode, customCurrencyRate,
      jobs, salaries, bonuses, overtime, hoursSnapshots, goals,
      region, customTaxRatePct, employerCostConfig, billingConfig, hiddenNavItems,
    };
    fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }, [income, monthlyIncomes, netWorthHistory, fixedExpenses, dailyTransactions, assets, loan, pension, recurringTemplates, housingMode, homeowner, transition, lang, currentMonth, savingsTargetPercent, growthReturnRate, houseGrowthRate, cashGrowthRate, cryptoGrowthRate, displayCurrency, nokToUsd, customCurrencyCode, customCurrencyRate, jobs, salaries, bonuses, overtime, hoursSnapshots, goals, region, customTaxRatePct, employerCostConfig, billingConfig, hiddenNavItems]);

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
  const derivedMonthlyIncome = useMemo(() => {
    if (salaries.length === 0) return income;
    const totalAnnual = calcActiveGrossAnnual(salaries, jobs, monthKey);
    if (totalAnnual === 0) return income;
    return Math.round(calcTaxByRegion(totalAnnual, region, customTaxRatePct, pension.ipsAnnualContribution).netMonthly);
  }, [salaries, jobs, monthKey, region, customTaxRatePct, income, pension.ipsAnnualContribution]);

  const isMonthlyIncomeOverridden = monthlyIncomes[monthKey] !== undefined;

  const effectiveIncome = useMemo(() =>
    monthlyIncomes[monthKey] ?? derivedMonthlyIncome,
  [monthlyIncomes, monthKey, derivedMonthlyIncome]);

  const averageIncome = useMemo(() => {
    const values = Object.values(monthlyIncomes);
    if (values.length === 0) return derivedMonthlyIncome;
    return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
  }, [monthlyIncomes, derivedMonthlyIncome]);

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

  const clearMonthlyIncomeForMonth = (key: string) => {
    setMonthlyIncomes(prev => {
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
      const totalSpentToday = dayTransactions.reduce((sum, t) => sum + t.amount, 0);
      runningBalance += dailyBudget - totalSpentToday;
      result.push({
        date: day,
        dateStr,
        spent: totalSpentToday,
        balance: runningBalance,
        transactions: dayTransactions
      });
    }
    return result;
  }, [monthInterval, transactionsForMonth, dailyBudget]);

  // Latent tax floored at 0: a loss (negative gain) is not a liquid asset, so it
  // must not inflate net worth. The UI clamps inputs ≥0 but JSON import does not.
  const taxOnGain = (Math.max(0, assets.unrealizedGain) * assets.taxRate) / 100;
  const netInvestment = assets.portfolio - taxOnGain;
  const houseEquity = assets.houseValue - assets.houseDebt;
  const cryptoTaxOnGain = (Math.max(0, assets.cryptoUnrealizedGain) * assets.cryptoTaxRate) / 100;
  const netCrypto = assets.crypto - cryptoTaxOnGain;
  // Single source of truth for the mortgage rate/term used by net-worth projections,
  // selected by the active housing mode (first-buyer & transitioning use the `loan`
  // inputs; homeowner uses the `homeowner` inputs).
  const mortgageRate = housingMode === 'homeowner' ? homeowner.rente : loan.rente;
  const mortgageTermYears = housingMode === 'homeowner' ? homeowner.nedbetalingstid : loan.nedbetalingstid;
  const totalEquity = netInvestment + netCrypto + assets.bsu + assets.savings + assets.bufferAccount + houseEquity;

  // Snapshot current month's net worth whenever equity changes (only for the current real month)
  useEffect(() => {
    if (!loaded.current) return;
    if (monthKey !== format(new Date(), 'yyyy-MM')) return;
    // Deliberate: snapshot the current month's net worth into persisted state when equity changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNetWorthHistory(prev => ({ ...prev, [monthKey]: Math.round(totalEquity) }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalEquity]);

  const updateAsset = (key: keyof Assets, value: number) => {
    setAssets(prev => ({ ...prev, [key]: value }));
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
  };

  const updateTransition = (key: keyof TransitionData, value: number) => {
    setTransition(prev => ({ ...prev, [key]: value }));
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
    if (data.netWorthHistory !== undefined) setNetWorthHistory(data.netWorthHistory);
    if (data.fixedExpenses) setFixedExpenses(data.fixedExpenses);
    if (data.dailyTransactions) setDailyTransactions(data.dailyTransactions);
    if (data.assets) setAssets({ ...DEFAULT_ASSETS, ...data.assets });
    if (data.pension) setPension({ ...DEFAULT_PENSION, ...data.pension });
    if (data.loan) setLoan(data.loan);
    if (data.recurringTemplates !== undefined) setRecurringTemplates(data.recurringTemplates);
    if (data.housingMode !== undefined) setHousingMode(data.housingMode);
    if (data.homeowner) setHomeowner({ ...DEFAULT_HOMEOWNER, ...data.homeowner });
    if (data.transition) setTransition({ ...DEFAULT_TRANSITION, ...data.transition });
    if (data.lang) setLang(data.lang);
    if (data.currentMonth) {
      const [y, m] = data.currentMonth.split('-').map(Number);
      if (!isNaN(y) && !isNaN(m)) setCurrentMonth(new Date(y, m - 1, 1));
    }
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

  const resetAll = () => {
    setIncome(0);
    setMonthlyIncomes({});
    setNetWorthHistory({});
    setFixedExpenses([]);
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
      derivedMonthlyIncome, isMonthlyIncomeOverridden,
      netWorthHistory, prevMonthIncome, prevMonthSpending,
      effectiveIncome, averageIncome,
      savingsTargetPercent, setSavingsTargetPercent,
      recommendedSpending, recommendedInvestment, conservativeMode,
      fixedExpenses, setFixedExpenses, dailyTransactions, setDailyTransactions,
      recurringTemplates, setRecurringTemplates,
      assets, updateAsset, loan, updateLoan, pension, updatePension,
      housingMode, setHousingMode, homeowner, updateHomeowner, transition, updateTransition,
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
      dataLoadFailed,
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
