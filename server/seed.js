/**
 * Headroom seed script — writes a year of realistic Norwegian demo data
 * straight into the SQLite DB. Idempotent: re-running replaces the row.
 *
 *   node server/seed.js
 *
 * Honours DATA_DIR (same convention as server/index.js).
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'database.sqlite');

// ── Deterministic PRNG so re-runs are identical ──────────────────
let _rngSeed = 0xC0FFEE;
function rand() {
  _rngSeed ^= _rngSeed << 13; _rngSeed ^= _rngSeed >>> 17; _rngSeed ^= _rngSeed << 5;
  return ((_rngSeed >>> 0) % 100000) / 100000;
}
function jitter(base, pct) { return Math.round(base * (1 + (rand() - 0.5) * 2 * pct)); }
function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }

// ── Build month keys for the last 12 months ──────────────────────
const today = new Date();
const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const months = [];
for (let i = 11; i >= 0; i--) {
  const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
  months.push(monthKey(d));
}
const currentMonthKey = months[months.length - 1];

// ── Income history: ~55k base with bonus spikes ──────────────────
const monthlyIncomes = {};
months.forEach((k, i) => {
  const base = 55_000;
  // Holiday pay bump in June (Norwegian feriepenger)
  const isJune = k.endsWith('-06');
  const isDecember = k.endsWith('-12');
  const bonus = isJune ? 18_000 : isDecember ? 8_000 : 0;
  monthlyIncomes[k] = jitter(base + bonus, 0.04);
  if (i === months.length - 1) monthlyIncomes[k] = 55_000; // pin current month
});

// ── Net worth history: gentle growth + monthly volatility ────────
const netWorthHistory = {};
let nw = 1_950_000;
months.forEach((k, i) => {
  nw = nw * (1 + 0.008 + (rand() - 0.5) * 0.012);
  netWorthHistory[k] = Math.round(nw);
  if (i === months.length - 1) netWorthHistory[k] = 2_142_667; // pin
});

// ── Fixed expenses (Norwegian household) ─────────────────────────
const fixedExpenses = [
  { id: 'fe-1', name: 'Huslån',           amount: 12_000, type: 'fixed' },
  { id: 'fe-2', name: 'Fellesutgifter',   amount: 3_400,  type: 'fixed' },
  { id: 'fe-3', name: 'Forsikring',       amount: 850,    type: 'insurance' },
  { id: 'fe-4', name: 'Strøm',            amount: 1_350,  type: 'fixed' },
  { id: 'fe-5', name: 'Trening',          amount: 549,    type: 'subscription' },
  { id: 'fe-6', name: 'Mobil',            amount: 449,    type: 'subscription' },
  { id: 'fe-7', name: 'Internett',        amount: 599,    type: 'subscription' },
  { id: 'fe-8', name: 'Musikkstrømming',  amount: 169,    type: 'subscription' },
  { id: 'fe-9', name: 'TV-strømming',     amount: 159,    type: 'subscription' },
  { id: 'fe-10', name: 'BSU sparing',     amount: 2_200,  type: 'fixed' },
  { id: 'fe-11', name: 'Aksjesparing',    amount: 4_000,  type: 'fixed' },
  { id: 'fe-12', name: 'Bil leasing',     amount: 1_575,  type: 'fixed' },
];

// ── Daily transactions for the CURRENT month (up to today) ───────
// `cat` values are canonical CategoryKeys (src/lib/categories.ts), so seeded
// rows use the same taxonomy as auto-categorized bank rows.
const dailyTransactions = [];
const merchants = [
  { name: 'Rema 1000',           cat: 'groceries',     min: 180,  max: 620 },
  { name: 'Kiwi',                cat: 'groceries',     min: 140,  max: 540 },
  { name: 'Bunnpris',            cat: 'groceries',     min: 95,   max: 380 },
  { name: 'Meny',                cat: 'groceries',     min: 220,  max: 780 },
  { name: 'Vinmonopolet',        cat: 'entertainment', min: 280,  max: 720 },
  { name: 'Kaffebar',            cat: 'dining',        min: 55,   max: 95 },
  { name: 'Espresso House',      cat: 'dining',        min: 49,   max: 89 },
  { name: 'Sushi Hjem',          cat: 'dining',        min: 280,  max: 720 },
  { name: 'Olympen',             cat: 'dining',        min: 380,  max: 950 },
  { name: 'Burger King',         cat: 'dining',        min: 120,  max: 240 },
  { name: 'NSB Vy',              cat: 'transport',     min: 39,   max: 199 },
  { name: 'Ruter',               cat: 'transport',     min: 42,   max: 124 },
  { name: 'YX Bensinstasjon',    cat: 'transport',     min: 420,  max: 920 },
  { name: 'Apotek 1',            cat: 'health',        min: 99,   max: 480 },
  { name: 'H&M',                 cat: 'shopping',      min: 199,  max: 1_200 },
  { name: 'Princess',            cat: 'shopping',      min: 149,  max: 880 },
  { name: 'Clas Ohlson',         cat: 'shopping',      min: 89,   max: 540 },
  { name: 'Komplett',            cat: 'shopping',      min: 299,  max: 4_500 },
  { name: 'Outland',             cat: 'entertainment', min: 199,  max: 890 },
  { name: 'Kino Oslo',           cat: 'entertainment', min: 140,  max: 320 },
];

const todayDate = today.getDate();
const cmYear = today.getFullYear();
const cmMonth = today.getMonth();
for (let day = 1; day <= Math.min(todayDate, 28); day++) {
  // 60% chance: 0–3 transactions per day
  const n = rand() < 0.4 ? 0 : Math.floor(rand() * 3) + 1;
  for (let i = 0; i < n; i++) {
    const m = pick(merchants);
    const amount = Math.round(m.min + rand() * (m.max - m.min));
    const dateStr = `${cmYear}-${String(cmMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    dailyTransactions.push({
      id: `tx-${day}-${i}-${Math.floor(rand() * 1e6)}`,
      date: dateStr,
      description: m.name,
      amount,
      category: m.cat,
      kind: 'expense',
      categorySource: 'auto',
    });
  }
}

// ── Recurring templates (suggested for quick add) ────────────────
const recurringTemplates = [
  { id: 'rt-1', description: 'Rema 1000',    amount: 350, category: 'groceries' },
  { id: 'rt-2', description: 'Kaffe',        amount: 71,  category: 'dining' },
  { id: 'rt-3', description: 'NSB Vy',       amount: 84,  category: 'transport' },
  { id: 'rt-4', description: 'Vinmonopolet', amount: 420, category: 'entertainment' },
];

// ── Assets ───────────────────────────────────────────────────────
const assets = {
  portfolio: 480_000,
  unrealizedGain: 95_000,
  taxRate: 37.84,
  houseValue: 4_800_000,
  houseDebt: 3_400_000,
  bsu: 150_000,
  savings: 0, // legacy scalar — superseded by savingsAccounts
  savingsAccounts: [
    { id: 'sav-1', name: 'Sparekonto', balance: 125_000 },
  ],
  bufferAccount: 75_000,
  crypto: 48_000,
  cryptoUnrealizedGain: 12_000,
  cryptoTaxRate: 22,
};

// ── Loan (first-time-buyer scenario, matches modeOptions default) ──
const loan = {
  laanebelop: 3_400_000,
  rente: 5.65,
  nedbetalingstid: 25,
  termingebyr: 50,
  etableringsgebyr: 0,
  skattefradragssats: 22,
  arslonn: 660_000,
  egenkapital: 500_000,
  eksisterendeGjeld: 0,
  betingetLaan: 3_500_000,
  kjoepesum: 4_000_000,
  gyldigTil: '',
};

const homeowner = {
  currentMortgageBalance: 3_200_000,
  originalLoanAmount: 3_800_000,
  rente: 5.65,
  nedbetalingstid: 22,
  termingebyr: 50,
  skattefradragssats: 22,
};

const transition = {
  currentHouseValue: 4_800_000,
  currentMortgageBalance: 3_200_000,
  agentFeePercent: 1.8,
  documentFee: 25_000,
  otherSaleCosts: 15_000,
  bridgeLoanRate: 7.0,
  bridgeMonths: 3,
};

// ── Salary tracker history (3 years, 2 jobs) ─────────────────────
const thisYear = today.getFullYear();
const jobs = [
  {
    id: 'job-1',
    startDate: `${thisYear - 4}-08`,
    endDate: `${thisYear - 1}-09`,
    employer: 'Demo Konsult AS',
    role: 'Backend Engineer',
    contractedHoursPerWeek: 37.5,
  },
  {
    id: 'job-2',
    startDate: `${thisYear - 1}-10`,
    endDate: null,
    employer: 'Demo Software AS',
    role: 'Senior Engineer',
    contractedHoursPerWeek: 37.5,
  },
];

const salaries = [
  { id: 'sal-1', jobId: 'job-1', effectiveDate: `${thisYear - 4}-08`, grossAnnual: 580_000, changeType: 'initial' },
  { id: 'sal-2', jobId: 'job-1', effectiveDate: `${thisYear - 3}-04`, grossAnnual: 610_000, changeType: 'raise' },
  { id: 'sal-3', jobId: 'job-1', effectiveDate: `${thisYear - 2}-04`, grossAnnual: 640_000, changeType: 'raise' },
  { id: 'sal-4', jobId: 'job-2', effectiveDate: `${thisYear - 1}-10`, grossAnnual: 760_000, changeType: 'job_change', notes: 'Jobbytte' },
  { id: 'sal-5', jobId: 'job-2', effectiveDate: `${thisYear}-04`,    grossAnnual: 795_000, changeType: 'raise' },
];

const bonuses = [
  { id: 'bon-1', date: `${thisYear - 3}-06-15`, amount: 18_000, type: 'holiday_pay' },
  { id: 'bon-2', date: `${thisYear - 3}-12-15`, amount: 12_000, type: 'annual' },
  { id: 'bon-3', date: `${thisYear - 2}-06-15`, amount: 21_000, type: 'holiday_pay' },
  { id: 'bon-4', date: `${thisYear - 2}-12-15`, amount: 15_000, type: 'annual' },
  { id: 'bon-5', date: `${thisYear - 1}-06-15`, amount: 24_000, type: 'holiday_pay' },
  { id: 'bon-6', date: `${thisYear - 1}-10-15`, amount: 35_000, type: 'signing', notes: 'Signeringsbonus ny jobb' },
  { id: 'bon-7', date: `${thisYear - 1}-12-15`, amount: 20_000, type: 'performance' },
  { id: 'bon-8', date: `${thisYear}-06-15`,    amount: 28_000, type: 'holiday_pay' },
];

const overtime = [
  { id: 'ot-1', date: `${thisYear - 2}-11-12`, hours: 12, amount: 5_400 },
  { id: 'ot-2', date: `${thisYear - 1}-03-20`, hours: 18, amount: 8_100 },
  { id: 'ot-3', date: `${thisYear - 1}-08-05`, hours: 22, amount: 11_500 },
  { id: 'ot-4', date: `${thisYear}-02-18`,    hours: 16, amount: 9_600 },
  { id: 'ot-5', date: `${thisYear}-05-10`,    hours: 24, amount: 14_400 },
];

const hoursSnapshots = [
  { id: 'hrs-1', periodMonth: `${thisYear - 3}-01`, actualHoursPerWeek: 38 },
  { id: 'hrs-2', periodMonth: `${thisYear - 2}-01`, actualHoursPerWeek: 40 },
  { id: 'hrs-3', periodMonth: `${thisYear - 1}-01`, actualHoursPerWeek: 41 },
  { id: 'hrs-4', periodMonth: `${thisYear - 1}-10`, actualHoursPerWeek: 44, notes: 'Onboarding ny jobb' },
  { id: 'hrs-5', periodMonth: `${thisYear}-01`,    actualHoursPerWeek: 43 },
  { id: 'hrs-6', periodMonth: `${thisYear}-05`,    actualHoursPerWeek: 42 },
];

// ── Savings goals ────────────────────────────────────────────────
const goals = [
  { id: 'goal-1', name: 'BSU fullt utnyttet',         target: 300_000, source: 'bsu',           deadline: `${thisYear + 2}-12` },
  { id: 'goal-2', name: 'Bufferkonto: 6 mnd utgifter', target: 180_000, source: 'bufferAccount', deadline: `${thisYear + 1}-06` },
  { id: 'goal-3', name: 'Aksjeportefølje 1M',          target: 1_000_000, source: 'portfolio',   deadline: `${thisYear + 4}-12` },
  { id: 'goal-4', name: 'Reisefond',                    target: 60_000,  source: 'manual', manualCurrent: 32_000, deadline: `${thisYear + 1}-03` },
];

// ── Final payload ────────────────────────────────────────────────
const payload = {
  income: monthlyIncomes[currentMonthKey],
  monthlyIncomes,
  netWorthHistory,
  fixedExpenses,
  dailyTransactions,
  recurringTemplates,
  assets,
  loan,
  housingMode: 'first_buyer',
  homeowner,
  transition,
  savingsTargetPercent: 30,
  growthReturnRate: 7,
  displayCurrency: 'NOK',
  nokToUsd: 0.093,
  customCurrencyCode: '',
  customCurrencyRate: 1,
  currentMonth: currentMonthKey,
  lang: 'nb',
  jobs,
  salaries,
  bonuses,
  overtime,
  hoursSnapshots,
  goals,
};

// ── Write to DB ──────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS finance_data (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    rev INTEGER NOT NULL DEFAULT 0
  )
`);
// Pre-rev volumes lack the column (same dance as server/index.js).
if (!db.prepare('PRAGMA table_info(finance_data)').all().some((c) => c.name === 'rev')) {
  db.exec('ALTER TABLE finance_data ADD COLUMN rev INTEGER NOT NULL DEFAULT 0');
}
// Bump rev instead of resetting it, so an open tab sees a normal 409/reload
// rather than a rev that went backwards.
const existing = db.prepare('SELECT rev FROM finance_data WHERE id = ?').get('headroom');
const rev = (existing ? existing.rev : 0) + 1;
db.prepare(
  'INSERT INTO finance_data (id, content, rev) VALUES (?, ?, ?) ' +
  'ON CONFLICT(id) DO UPDATE SET content = excluded.content, rev = excluded.rev'
).run('headroom', JSON.stringify(payload), rev);

console.log(`✓ Seeded ${DB_PATH}`);
console.log(`  · ${months.length} months of income & net-worth history`);
console.log(`  · ${fixedExpenses.length} fixed expenses`);
console.log(`  · ${dailyTransactions.length} transactions in ${currentMonthKey}`);
console.log(`  · current net equity: NOK ${netWorthHistory[currentMonthKey].toLocaleString('no-NO')}`);
console.log(`  · ${jobs.length} jobs, ${salaries.length} salary changes, ${bonuses.length} bonuses, ${overtime.length} overtime, ${hoursSnapshots.length} hours snapshots`);
