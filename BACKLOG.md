# Backlog

Items deferred from prior work. When an item is finished, remove it.

## Scenario bands on the other projection charts

Shipped (2026-07): bear/base/bull uncertainty bands (return ±3pp) on the **Forecast**
net-worth chart — the long-range single-line projection that most overstates certainty.
Pure engine `src/lib/scenarioBands.ts` (`netWorthBands`, unit-tested); rendered as a range
Area behind the nominal/real lines (`src/pages/ForecastPage.tsx`).

Remaining: the Assets "Growth projection" chart and the Dashboard net-worth projection were
**not** banded. Both are *stacked* area charts (per-bucket / composition), so a total-only
bear/bull band would sit hidden behind the opaque stacked fills — showing it there needs a
design decision (e.g. an unstacked "total" overlay line with a band, or a toggle), not a
drop-in. **What would unblock**: agree the visual treatment for a band on a stacked chart.
**Where**: `src/pages/AssetPage.tsx` (`calcNetWorthProjectionByBucket` chart, ~line 567),
`src/pages/DashboardPage.tsx` projection chart, `src/lib/scenarioBands.ts` (reusable).

## Payslip importer — follow-ups

Shipped (2026-07): client-side Visma payslip import (Tripletex added 2026-10) on the Budget page. PDFs are parsed entirely in-browser (pdf.js, lazy-loaded) and never stored; a single-month PDF opens a detailed editable review, a multi-page archive opens a batch list that fills income history back in time. Per-month figures live in `payslips: Record<month, MonthlyPayslip>` (`src/context/FinanceContext.tsx`), and net pay is written as that month's income override. Parser + tests in `src/lib/payslip/` (`parseVismaPayslip.ts`, `parsePayslipAmount.ts`, provider registry in `index.ts`); browser extraction/render in `extractPdfText.ts`; UI in `src/components/PayslipImportModal.tsx` + `src/pages/BudgetPage.tsx`. Remaining:

- **Visma and Tripletex are supported.** Adding another payroll provider = write a `PayslipParser` (returns `null` when it doesn't recognise the text) and push it onto `PROVIDERS` in `src/lib/payslip/index.ts`. **Unblock**: a sample PDF from the new provider to build a fixture from (tests inline invented text lines that mirror the layout, never the binary or real figures).
- **Tripletex leaves some fields empty.** The Tripletex payslip prints no annual salary or position %, so `annualSalary` and `positionPct` come back `null`. Holiday pay is only printed year-to-date, so the period's figure is derived as period gross × (YTD accrued ÷ YTD holiday base), which assumes the holiday base equals the tax base for the month. Gross is the period's tax base ("Grunnlag prosenttrekk ...: X."), and net is the amount paid out, which includes expense reimbursements ("Gjeld til ansatte"). Bonus rows aren't mapped to `BonusEntry`. Only a single-month prosenttrekk slip has been seen; tabelltrekk and multi-page Tripletex exports are untested. **What would unblock**: more Tripletex samples (a tabelltrekk month, a month where the holiday base differs from the tax base, a multi-month export). **Where**: `src/lib/payslip/parseTripletexPayslip.ts`.
- **Line items (on-call / overtime) aren't parsed into their own entries.** The Visma parser deliberately drops the pay-line table (Fastlønn / On-Call / Feriepenger rows) because the thousands-space and column-separator are the same character, making per-column amounts ambiguous (e.g. `On-Call ... 24/7 108,00` mis-bridges to `7 108,00`). Only the headline figures (gross/net/tax/base/holiday) are extracted. **What would unblock**: column parsing anchored on the payslip's fixed X positions (available from pdf.js `transform[4]`) instead of regex over the joined line, then map rows to `OvertimeEntry`/`BonusEntry`. **Where**: `src/lib/payslip/parseVismaPayslip.ts` (extraction), `src/lib/payslip/extractPdfText.ts` (would need to preserve per-item X), `src/components/PayslipImportModal.tsx` (write mapping).

## Time/data-model rethink — follow-ups

Shipped (2026-07): the contextual month picker, provenance badges, editable net-worth history, monthly balance snapshots, and the balance-page time machine are all done. Details: contextual picker (interactive only on `/` and `/overview`; static "as of today" marker elsewhere; hidden on `/settings` — `MONTH_SCOPED_ROUTES` / `HIDE_TIME_MARKER_ROUTES` in `src/components/Layout.tsx`); `ProvenanceBadge` Default/Yours/Estimate (`src/lib/provenance.ts`, `src/components/ui/ProvenanceBadge.tsx`) on high-impact assumptions across Assets/Settings/Pension/Employer Cost + a Dashboard "defaults nudge"; `setNetWorthForMonth`/`clearNetWorthForMonth` + `NetWorthHistoryModal` (`src/components/NetWorthHistoryModal.tsx`); `BalanceSnapshot` + `balanceSnapshots` auto-captured for the current calendar month and persisted/exported/imported; `useBalanceHistory` (`src/hooks/useBalanceHistory.ts`) + `BalanceHistoryBar` (`src/components/BalanceHistoryBar.tsx`) making Assets/Loan/Pension render read-only history, with shared equity math in `src/lib/equity.ts`. Demo data (`src/lib/demoData.ts`) seeds 6 months of snapshots so demo mode showcases it.

Remaining:

- **Deepen the time machine.** Addressed by the full-historization work (PR #31) and the single-shared-month unification (2026-07): (a) the whole app now tracks one month (`currentMonth`); `historyMonth` was retired and `useBalanceHistory` snaps the shared month to the nearest recorded snapshot (`snapToRecordedMonth` in `src/lib/snapshots.ts`) ✅; (b) AssetPage projections now use the snapshot's `assumptions`/mortgage rate/term (v1 snapshots still fall back to live — a muted "not recorded" treatment for v1 is the remaining polish); (c) PensionPage contributions now resolve at the viewed month via `calcActiveGrossAnnual` ✅; (d) hand-entered historical backfill shipped via `HistoryManagerModal` ✅.
- **Extend provenance badges to the remaining defaults** — fixed-expense seeds, whole `loan`/`homeowner`/`transition` objects, `savingsTargetPercent`. Consider a first-run setup flow that converts defaults into explicit choices, reusing `provenanceOf`.

Known limitations:
- **History recorded before debt historization (2026-07) is equity-based.** `netWorthHistory` values and `BalanceSnapshot`s captured before debts were snapshotted hold asset equity (no `debts` field), and the missing debt history can't be reconstructed. Those months render equity-only in the Dashboard chart and the Assets time machine; values self-correct as new months are recorded, or can be hand-corrected via the History manager (Settings → Data management, or the Dashboard "Edit history" button).
- **Provenance is a value-comparison heuristic** (`provenanceOf` in `src/lib/provenance.ts`): a user who deliberately sets a value equal to the default sees "Default". A true fix needs explicit provenance tracking in state (a `touched` set). The Dashboard "defaults nudge" count (`defaultAssumptions` in `src/pages/DashboardPage.tsx`) inherits the same heuristic.
- **AssetPage growth RateChips are unbadged** — the compact chips at `src/pages/AssetPage.tsx:394-397` (which open the same editor as Settings) were left without badges to avoid clutter; the canonical badged surface for growth rates is Settings.
- **`recommendedInvestment` on Assets is month-coupled** — it derives from `effectiveIncome` (month-scoped). Now that the header picker is shown on `/assets` and drives the single shared month, the value visibly tracks the month on screen (no longer a stale hidden month), but it still reflects a *past* month's income when time-travelling rather than the live figure. **Where**: `calcRecommendations(effectiveIncome, …)` in `src/context/FinanceContext.tsx`, consumed in `src/pages/AssetPage.tsx`.
- **`prevMonthSpending` vs `currentMonthSpending` fixed-expense asymmetry** — after the shared-month unification, `currentMonthSpending` reconciles against `viewFixedExpenses` (the viewed month's snapshot fixed expenses for a past month) while `prevMonthSpending` still uses live `fixedExpenses`. This only affects the Dashboard month-over-month spending **delta %** (which transactions count as enveloped), not money math or persistence. **What unblocks:** resolve `prevMonthSpending` against `balanceSnapshots[prevMonthKey].fixedExpenses` too. **Where**: `src/context/FinanceContext.tsx` (`prevMonthSpending`/`currentMonthSpending` memos).

## Cross-page value syncing — follow-ups

Shipped (2026-07): the Loan page's first-buyer Låneevne inputs now auto-fill from the app's
real data with a per-field manual override (the Employer-cost pattern) — `arslonn` ←
`grossAnnualIncome` (Salary), `eksisterendeGjeld` ← `totalDebt` (Debts), `egenkapital` ←
liquid assets (`bsu + savings + bufferAccount + netInvestment`). Each shows an Auto/Overstyrt
chip and a reset-to-auto control; overrides are page-local (reset on reload, like
EmployerCost), and history (read-only) views fall back to the month's stored `loan` snapshot.
The current home's value/mortgage are now hard-mirrored across `assets` ↔ `homeowner` ↔
`transition` in `updateAsset`/`updateHomeowner`/`updateTransition` (previously only
assets↔homeowner, only in homeowner mode). Code: `src/pages/BoligPage.tsx`,
`src/context/FinanceContext.tsx`. Remaining:

- **Loan-input overrides don't persist across reloads** — matches EmployerCost, and is fine
  for a what-if calculator, but if we later want a "sticky" manual salary/debt on the Loan
  page it needs a persisted `number | null` override model (or a `touched` set) rather than
  the page-local `useState`.

Shipped (2026-07): rentefradrag wired end-to-end. `calcNorwegianTax`/`calcTaxByRegion`/
`calcMarginalTaxRate` gained an `interestDeduction` param (subtracted from alminnelig inntekt,
uncapped); `annualMortgageInterest` derived in `FinanceContext` (year-one interest via
`calcAmortizationSchedule`, housing-mode aware) and threaded into budget net income,
Pengestrøm, SKATTEFORDELING, and Salary take-home. Forecast now uses `calcActiveGrossAnnual`
for income (on-call + multi-job), per-year mortgage interest as rentefradrag, and seeds its
raise/savings/return/inflation sliders from the user's salary CAGR, `recommendedInvestment`,
`growthReturnRate`, and rolling SSB CPI (override-until-touched). Remaining disconnections:

- **Manual monthly-income override goes stale vs the salary system.** `effectiveIncome` uses a
  per-month manual override that never re-syncs when salary/tax/IPS change
  (`src/context/FinanceContext.tsx` `effectiveIncome`/`derivedNetMonthlyFor`). Partly
  deliberate; wants a "stale override" indicator or re-sync affordance rather than silent drift.
- **Wealth tax simplifications** (deliberate, documented in code): single-person bunnfradrag (no
  spousal doubling); the forecast splits financial assets into shares-vs-other by *today's* ratio;
  Pengestrøm (current-month cashflow) shows no wealth-tax line, only the projections do.
  **Where**: `src/lib/calculations.ts`, `src/lib/forecastProjection.ts`.

## Job-centric salary tracking — phase 2

The job-filter tab strip and per-job `jobId` on `BonusEntry` / `OvertimeEntry` / `HoursSnapshot` are shipped. The remaining IT-consultant edge cases:

- **Commission / provisjon tracking** — variable monthly amount tied to billed hours, project margin, or sales. Needs a new `CommissionEntry { id, jobId, periodMonth, amount, basis?: 'hours' | 'margin' | 'sales', rate?: number, notes? }` plus an aggregation in `compByYear`. **Where**: `src/context/FinanceContext.tsx`, `src/pages/SalaryPage.tsx`.
- **Per-job billing rate (consultant mode)** — track `kr/hour billed to client` distinct from base salary. Add `billingRateKrPerHour?: number` to `JobEntry`, plus a "billed hours" snapshot type. Enables an "Effective billing margin" chart contrasting what you cost vs what's billed.
- **Per-job stack in the Total comp chart** — when more than one job has activity in a given year, split the `base` / `onCall` / `bonus` / `overtime` segments per job (or add a job-color legend). Currently aggregated globally across jobs. **Where**: `compByYear` in `src/pages/SalaryPage.tsx`.
- **Concurrent jobs** — `derivedMonthlyIncome` (budget income) and `PensionPage` pensionable income now sum across all active jobs via `calcActiveGrossAnnual` (latest salary per job, skipping ended jobs, aggregated before tax). Still single-job: `ForecastPage` `currentGross`/`currentOnCall` (base-only decomposition, single latest salary) and the SalaryPage "Total comp" chart (`compByYear` aggregates globally — see the per-job-stack bullet above). **Where**: `src/pages/ForecastPage.tsx:23-37`, `src/pages/SalaryPage.tsx` `compByYear`.
- **Reassign unassigned entries** — `BonusEntry` / `OvertimeEntry` / `HoursSnapshot` rows from before the `jobId` field render under "Uten jobb" in the All tab. Add a quick bulk-attribute UI (or surface it inline in the entry row) so users can clean these up without opening the edit modal one by one.

## Math-correctness audit — deferred findings

A cross-domain math audit (2026-06) fixed the high-value issues (savings-rate in the
projection, multi-job income aggregation, IPS net-income consistency across pages,
homeowner year-1 tax deduction, mortgage rate/term source, loan term=0 guard, `/30`
daily-budget divisor, latent-tax floor, projection-growth denominator, burn-rate month
guard). These lower-priority findings were **intentionally left** and are not bugs that
break current usage:

- **Trygdeavgift rate 7.7 vs 7.8%** — the ~99 650–144 000 *opptrapping* cap (25% of income above the limit) and the hard cliff are now fixed in `norwegianTax.ts` (`trygde`). What remains is confirming whether the flat rate for the active tax year should be 7.7% or 7.8% (`TAX_PARAMS[TAX_YEAR].trygdeavgiftRate`) — this affects every salary, so leave until the correct statutory rate is confirmed.
Done (2026-07): `ipsTaxSaving` now uses `customTaxRatePct` under the generic region (`PensionPage`); Dashboard monthly-investment bars now use `residual * ratio` to match the projection/recommendation; trygdeavgift opptrapping cap added; LoanPage first-buyer capacity replaced with `calcBorrowingCapacity` (min of 5× income cap and 15%-equity/85%-LTV cap, plus a +3pp stress-tested payment) — `src/lib/calculations.ts`; bonus/overtime entries now carry a per-entry `includeInBudget` toggle (SalaryPage modals) that folds the opted-in gross into that month's `derivedMonthlyIncome` at the marginal rate.

**Unblock**: the remaining trygde-rate item needs the correct statutory rate confirmed.

## Pension — phase 2

OTP + IPS tracking is shipped (balance, contribution, growth, retirement-readiness tile on Forecast).

Shipped (2026-07): **Folketrygd (NAV state pension) + net drawdown taxation.** Pure engine
`src/lib/folketrygd.ts` (unit-tested): 18.1% accrual up to 7.1G into a notional pensjonsbeholdning
(projected in today's kroner — G-regulated, not market-funded), converted at retirement by the
cohort delingstall (NAV 1954–2000 age-67 table, interpolated + per-age adjustment), with a
garantipensjon floor (80% avkorting, single/married rate). Year-keyed `FOLKETRYGD_PARAMS` (G +
garantipensjon for 2025/2026). Withdrawal taxation via `calcPensionIncomeTax` (`src/lib/norwegianTax.ts`,
`PENSION_TAX_PARAMS` 2025/2026): pension minstefradrag 40%, 5.1% trygde, 22% + trinnskatt, and the
skattefradrag for pensjonsinntekt (two-tier phase-out). New `Pension` fields `folketrygdBeholdning`
(NAV figure, 0 = estimate from age+income), `folketrygdSingle`, `pensionPayoutYears` (auto-persist via
`mergedWith`). PensionPage gained a "Pensjonsinntekt ved uttak" breakdown (folketrygd + OTP/IPS
annuitized → gross → tax → net/mo + replacement ratio) and a Folketrygd input card; the Forecast
retirement tile now shows net monthly pension incl. folketrygd. **Disclosed simplifications** (in-UI,
not TODOs): today's-kroner projection with income held flat; delingstall linear age-adjust; garanti at
full trygdetid (no cohort levealdersjustering); OTP/IPS annuitized linearly over payout years; new-IPS's
trinn/trygde exemption folded into the pension-income model (conservative). **Where**: `src/lib/folketrygd.ts`,
`src/lib/norwegianTax.ts`, `src/pages/{PensionPage,ForecastPage}.tsx`.

Remaining pension topics:

Shipped (2026-07): **AFP (ny privat, født 1963+).** Tested engine `src/lib/afp.ts` (0.314% of
pensjonsgrunnlag up to 7.1G over a career to 61, levealdersjustert via the folketrygd delingstall).
A self-certified `pension.afpEligible` toggle gates it; when on, AFP is a lifelong line in the
PensionPage income-at-withdrawal breakdown and is folded into the net-of-tax figure on both the
Pension and Forecast pages (taxed as pension income via `calcPensionIncomeTax`). Disclosed
simplifications: pensjonsgrunnlag estimated from today's income held flat; levealdersjustering
reuses folketrygd delingstall rather than NAV's separate AFP forholdstall; no kompensasjonstillegg
(that's for pre-1963 cohorts). **Where**: `src/lib/afp.ts`, `src/pages/{PensionPage,ForecastPage}.tsx`.
- **Foreign pension / IRA / 401k** — multi-currency pension buckets for users who worked abroad.
- **Pension contribution from variable comp** — `otpAnnual` calc currently uses `currentGross + currentOnCall` only. Real OTP base may include bonuses and is capped at 12G (~1.4M). Refine if it becomes inaccurate for high earners.

## Bank transaction import (Enable Banking) — follow-ups

Shipped (2026-07): in-app Bank Norwegian → Headroom transaction sync via Enable Banking
(PSD2 AIS, free own-accounts tier). Self-contained CommonJS engine `server/bank.js`
(ships in the Node-22 image; JWT auth, link/callback/sync/status, session in
`$DATA_DIR/eb-session.json`, pure mapper + dedup-merge). Routes in `server/index.js`
(`/api/bank/{status,link,callback,sync}`). Settings UI `src/components/BankSyncCard.tsx`
(Connect/Re-link with BankID, "Sync now", consent-expiry indicator; i18n under
`settings.bank`). Anti-clobber reconcile in `server/index.js` re-adds `eb-`-prefixed rows a
stale tab dropped. Mapping tested in `src/lib/bank.test.ts`. Daily sync = cron `curl -X POST
/api/bank/sync`. Requires `EB_REDIRECT` (registered HTTPS callback) + the RSA key in the
data volume. Remaining:

- **Auto-categorisation — shipped (2026-07), viewing follow-ups remain.** A canonical
  category taxonomy (`src/lib/categories.ts`, 12 keys with i18n labels + palette colours +
  icons) and a local rule-based categorizer (`src/lib/categorize.ts`, Norwegian-merchant
  keyword table + ISO-18245 MCC fallback, unit-tested) now label every transaction on
  ingest. `mapEBTransaction` keeps `merchant` + `mcc`; categorization runs **client-side** at
  a single chokepoint (a backfill effect in `FinanceContext.tsx`) so it also covers manual
  and legacy rows; `mergeTransactions` carries an existing label forward across re-sync so a
  manual correction is never clobbered. `DailyTransaction` gained `merchant`/`mcc`/
  `categorySource`. `BudgetPage` renders localized labels + canonical colours.

  The category *viewing* layer also shipped (2026-07, agreed "Everything" scope), all reading
  from a tested pure lib `src/lib/categoryStats.ts` (spendByCategory / categoryMoM /
  monthlyCategoryTotals / budgetProgress — income always excluded from spend):
  - **Category dashboard** — `src/components/CategoryBreakdown.tsx`: per-category spend with
    icon + colour + share bar, a month-over-month chip, click-to-drill into the category's
    transactions. Replaced the old ad-hoc bar list in `BudgetPage`.
  - **Multi-month trend** — `src/components/charts/CategoryTrendChart.tsx`: stacked bar of
    spend by category over the last 6 months (only categories with spend get a series).
  - **Per-category budgets** — persisted `categoryBudgets: Partial<Record<CategoryKey, number>>`
    (wired through every persist site + demo data), UI in `src/components/CategoryBudgets.tsx`
    (inline editor + actual-vs-budget progress bars with over-budget warnings).

  Verified: `tsc`/`lint`/132 unit tests (incl. a headless react-dom/server render smoke for the
  three components), plus a throwaway-server integration test confirming the persist +
  bank-reconcile round-trip preserves `categoryBudgets`, `merchant`/`mcc`, and manual labels.
  A live in-browser visual pass was NOT possible (no browser available in the dev sandbox) —
  worth an eyeball on the Budget page in demo mode after next pull.

  Remaining:
  - **Rule-table tuning + optional LLM fallback** — the keyword table (`src/lib/categorize.ts`)
    is deliberately small; add merchants as gaps surface. An LLM fallback for unmatched
    merchants was declined for now (keeps the app local-only) — revisit behind a toggle if
    `other` grows large.
  - **User-defined category rules — shipped (2026-07).** Vipps is no longer matched as a
    transfer (it's a payment rail; `Vipps*Merchant` is a purchase). For the personal/foreign pile
    that the generic keyword table can't know (a user's loan account number, personal payees,
    one-off foreign merchants), users add rules: `categoryRules: CategoryRule[]` (`{id, match,
    category}`) in the blob, `categorizeWithRules` applies them ahead of the built-in engine at
    the ingest/backfill chokepoint (`FinanceContext.tsx`), so a rule relabels every matching row
    past + future. Created from the transaction edit modal ("remember" checkbox + editable match
    text, `EditModal` gained a `checkbox` field type), managed in `src/components/CategoryRules.tsx`
    on the Budget page. Wired through every persist site. Match is a case-insensitive substring;
    a stronger matcher (regex / anchored / by account field) could follow if needed.
- **Scheduled sync — shipped (2026-07).** An optional in-process scheduler
  (`server/bankSync.js`, `startBankSyncSchedule`) now runs the sync inside the single `node`
  process (mirroring `server/backup.js`), gated by `BANK_SYNC_INTERVAL_HOURS` (default `0` =
  off). No cron to install, no compose sidecar, and no self-POST to the unauthenticated
  `/api/bank/sync` — the shared `runBankSync` in `server/index.js` is called directly. First
  tick is delayed by `bank.lastSyncAgeMs` so restarts don't re-sync early; timers are unref'd.
  The manual "Sync now" button and any external cron (`scripts/enable-banking/README.md`) still
  work. **Where**: `server/bankSync.js`, `server/index.js` (`runBankSync`), `Dockerfile` (copies
  `bankSync.js`).
- **Managed encryption key is co-located.** The key is always AES-256-GCM encrypted at rest;
  without `EB_KEY_SECRET` the app manages its own key in `$DATA_DIR/eb-master.key` (chmod 600),
  which guards against the key file leaking in isolation but not a full-volume breach (the
  master key is in the same volume). Real at-rest protection still needs `EB_KEY_SECRET` set
  out-of-band. Config (redirect URL) + key are now set entirely in-app (Settings → Bank sync;
  `POST /api/bank/config`, `POST /api/bank/key`); env vars are optional overrides. **Where**:
  `server/bank.js`.
- **Bank endpoints are unauthenticated** like the rest of the app — `config` and `key` are
  write-only and validated, but on a network-reachable deploy anyone could overwrite the
  redirect/key (integrity/DoS, not disclosure) or read `/api/data`. Gate behind app auth /
  reverse-proxy / VPN. Tracked with §1.3 / the no-auth posture. **Where**: `server/index.js`.
- **Pending rows — shipped (2026-07).** `mapEBTransactions` now imports not-yet-booked (`PDNG`)
  rows (default on; `EB_INCLUDE_PENDING=0/false/off` disables), stamping `pending: true` and a
  muted Clock marker in the Budget ledger. The stale-duplicate risk (a pending row and its later
  booked twin carry different ids) is handled by `evictSupersededPending` — a pure fn run in
  `mergeTransactions` **and** the POST `/api/data` reconcile (so a stale tab can't resurrect the
  pending twin), with a byte-equivalent client twin in `src/lib/bankDedup.ts`. Match is
  conservative (same account, `|amount|`, direction, within 6 days) and rescues a manual category
  onto the survivor. Deliberate gap: **amount drift** (tips, forex) isn't matched, so a rare
  pending row lingers until manually removed — safer than fuzzy amount matching in a money app.
  **Where**: `server/bank.js`, `src/lib/bankDedup.ts`, `src/pages/BudgetPage.tsx`.
- **Multi-bank / multi-account — Tier 1 shipped (2026-07); Tier 2 deferred.** The engine now
  holds *many* bank connections at once (`server/bank.js` `readStore`/`writeStore`,
  `connections[]` in `$DATA_DIR/eb-session.json`, legacy single-session auto-migrated on read),
  each with its own `idPrefix` so rows can't collide across banks. A bank picker
  (`GET /api/bank/aspsps`), per-bank connect/re-link/disconnect
  (`POST /api/bank/link {aspsp}`, `DELETE /api/bank/connection/:id`), and a "Sync now" that
  loops every live connection (one expired bank flags itself without blocking the others).
  Imported rows carry `account`/`accountName`/`bank` (`DailyTransaction`), rendered as a colored
  per-account badge (`src/components/AccountBadge.tsx`) on the Dashboard recent list and the
  Budget ledger. Bank copy genericized (i18n `settings.bank`).

  Friendly account labels also shipped (2026-07): `accountLabels: Record<string, string>`
  (account key → user name) is wired through every persist site (`buildPayload` + deps,
  `applyPayload`, `ExportPayload`, `SettingsPage` export/import, demo, reset); inline rename per
  account in `BankSyncCard`; `AccountBadge` prefers the custom name over the bank-provided one
  (which is often the account holder's own name). Color helper extracted to
  `src/lib/accountColor.ts`.

  Per-account view + merge also shipped (2026-07):
  - **Whole-Budget-page account filter.** An "All accounts / <account>" pill row narrows the
    spending analysis (category breakdown, trend, heatmap, category budgets) and the ledger to
    one account. State in `FinanceContext.tsx`: `accountFilter` / `accountGroups` /
    `visibleBudgetTransactions` (analysis) / `nonTransferTransactions` (whole-finance surfaces
    like the savings rate). Budget-only components alias the filtered list in their `useFinance()`
    destructure. Grouping is by display label (`src/lib/account.ts` `accountGroupLabel`), so
    **giving two accounts the same custom name merges them** into one group/color everywhere.
  - **Internal-transfer netting.** A move between two own accounts (expense on one + income on the
    other) is detected (`src/lib/transfers.ts`, conservative: opposite-kind, equal-amount,
    different-account, ≤3 days, unambiguous only) and excluded from the spending analysis; the
    rows stay in the ledger, marked (⇄, muted).

  Deferred / notes:
  - **Transfer netting on the Dashboard — done.** `InsightBanner`, `CashflowChart`, and
    `SavingsRateChart` consume `nonTransferTransactions` (whole-finance, transfers excluded but
    not account-scoped — correct, since income/cashflow span all accounts). The Budget category
    surfaces use `visibleBudgetTransactions` (also account-scoped). No surface still counts
    transfers.
  - **Transfer detection is a heuristic** — a genuine same-amount expense+income within 3 days on
    two accounts could be wrongly netted. Mitigated by the ambiguity skip and by keeping the rows
    visible (marked) in the ledger. Stronger signals (own-IBAN match / transfer keywords) would
    tighten it. **Where**: `src/lib/transfers.ts`.
  - **Legacy rows are unlabeled.** Transactions imported before Tier 1 have no `account`/`bank`,
    so they show no badge and fall outside every account group (can't be back-attributed). New
    syncs tag correctly; this only affects pre-upgrade rows.

- **A re-link can import the overlap window twice when the bank changes its reference format.** A sync refetches from 7 days before `last_sync`, and rows dedup by id. On the 2026-10-29 re-link Handelsbanken switched from `2026-08-03-0`-style references to encrypted `enc!!…` ones, so the two rows booked on the overlap day came in again under new ids (a 3 013 kr and a 39 kr payment). **Unblock**: decide on a content match (same account key, date, amount and description, one old-style and one new-style id) limited to the first sync after a re-link; a blanket content dedup would also merge two genuine identical purchases. **Where**: `fetchMappedTransactions` / `mergeTransactions` in `server/bank.js`.

## Envelope budgeting (fixed-expense ↔ category reconciliation) — follow-ups

Shipped (2026-07): a fixed expense can be linked to a tracked spending category (optional
`FixedExpense.category`), turning it into an *envelope*. Its amount is still reserved up front
(in `totalFixedExpenses` → daily budget), but real transactions in that category draw the
envelope down instead of being counted against the daily budget a second time — fixing the
double-count where e.g. a "Mat" fixed line and grocery transactions both hit the remaining
budget. Overspend past a full envelope spills into the daily budget, day-accurate. Single
source of truth: pure engine `src/lib/envelopes.ts` (`reconcile` / `createEnvelopeLedger` /
`runningEnvelopeBalance` / `suggestEnvelopeLinks`, 22 unit tests). Consumed by `dailyData`
(`FinanceContext.tsx`, adds `discretionary` to `DailyDataEntry` + exposes `reconciliation` on
the derived context); UI in `BudgetPage.tsx` (link picker in the add/edit modal, per-envelope
progress bar, "covered by {name}" tags in the daily log, and a collision-detector nudge that
offers one-tap linking). Category budgets defer to envelopes (an enveloped category drops out
of `CategoryBudgets`); `CategoryBreakdown` marks enveloped categories; Dashboard/SmartRecs
pacing use `discretionary` so the fix propagates. Non-syncers (no transactions) are unaffected —
the exclusion set is empty and every number matches pre-feature behavior. No migration
(`category` optional, round-trips through sanitize/persist/export untouched).

Design decision (worth revisiting): **unused envelope money is NOT folded into the daily
running-balance surplus.** The running balance stays discretionary-only; envelope
under/overspend is surfaced separately on the envelope bar. The plan originally said "release
unused to surplus," but folding *current* unused into the projected month-end surplus is
misleading mid-month (you'll likely still spend the envelope), so it was deliberately kept as
two separate pools. Overspend spillover (the correctness-critical half) IS reflected in the
balance.

Remaining:
- **Cross-month envelope rollover.** Unused envelope room doesn't carry to next month; each
  month's envelope is the current fixed-expense amount. True rollover needs per-month envelope
  state (a persisted map) and a cross-month reconciliation. **Where**: `src/lib/envelopes.ts`,
  `FinanceContext.tsx`.
- **Time-versioned fixed-expense amounts.** Envelopes for *historical* months use the *current*
  budgeted amount (fixed expenses aren't snapshotted per month — a pre-existing app limitation
  the envelope view inherits). Accurate history needs a per-month fixed-expense snapshot.
- **Distribution chart (Fordelingsanalyse) budgeted-vs-actual overlay** — deliberately skipped;
  the per-envelope bars in the fixed-expense list already deliver the reconciliation view.
  Revisit if a combined chart is wanted. **Where**: `src/components/BudgetDistributionChart.tsx`.
- **Name→category hints are a small keyword map** (`NAME_HINTS` in `src/lib/envelopes.ts`),
  tuned for common Norwegian fixed-expense names (Mat/Strøm/Trening/…). Extend as gaps surface;
  the collision nudge only fires when the guessed category has real spend, so misses are silent.

## Audit (2026-07-04) — deferred architecture & data-safety items

Remaining from the 2026-07-04 app audit.

- **§5.5 ESLint depth.** Baseline only — no `recommendedTypeChecked`, no `eslint-plugin-jsx-a11y` (would auto-catch icon-button/label regressions), no formatter/pre-commit hooks. `no-unused-vars` is now configured. **Where**: `eslint.config.js`.

## IMPROVEMENTS §5.6/§5.7 logic-cleanup — deferred data-safety items

Two items from the logic-cleanup pass were deferred because touching them risks
resurrecting or double-counting real bank transactions.

- **Bank-id dedup regex ambiguity.** **What**: the bare-vs-prefixed split in the
  twin-dedup regexes classifies any `eb-<8hex>-<rest>` id as connection-prefixed,
  so a legacy *bare* id whose ref happens to begin with 8 hex chars + `-` is
  misclassified as prefixed (and could drop a same-ref bare row that is actually a
  distinct transaction). **Why deferred**: the two id shapes (`eb-<8hex>-<ref>`
  prefixed vs `eb-<8hexref…>` bare) are genuinely indistinguishable by structure;
  no safe discriminator exists, and guessing wrong risks data loss/duplication in a
  money app. **What would unblock**: convergence of the id format so bare ids no
  longer exist (see the §2.3 note — "keep; shrink after 2.3 converges the blob"),
  after which the bare branch can be removed entirely instead of disambiguated; or a
  reliable secondary key (own-IBAN / booking-date match) to break the tie. **Where**:
  `src/lib/bankDedup.ts` (`BARE`/`PREFIXED`) and its byte-equivalent twin
  `dropStaleBareTwins` in `server/bank.js`; behavior locked by a documenting test in
  `src/lib/bankDedup.test.ts`.
- **`deletedBankIds` grows unbounded.** **What**: soft-deleted bank-row ids
  accumulate forever in the persisted blob and are never pruned. **Why deferred**:
  an id stays in `deletedBankIds` precisely because its row is absent from
  `dailyTransactions`, so "prune ids no longer in the stored blob" would prune the
  whole set and let the next server reconcile (`mergeTransactions`) resurrect every
  deleted transaction. There is no client-side signal proving a deleted id can never
  return from a future bank sync (the sync window is server-side), so no prune is
  provably safe. **What would unblock**: a server-side retention rule keyed to the
  Enable Banking sync window (drop a deleted id only once the bank can no longer
  return it), or tying deleted ids to a connection lifecycle so they can be dropped
  when a connection is removed. **Where**: `src/context/FinanceContext.tsx`
  (`deletedBankIds`, `setDailyTransactionsTracked`), consumed by
  `mergeTransactions` in `server/bank.js`.

- **Re-categorize auto-sourced `transfers` rows in bulk.** **What**: a Settings
  maintenance action that re-runs `categorize()` over transactions whose
  `categorySource` is auto (never user-edited), so historical rows filed under
  `transfers` by an older keyword table get re-filed to their correct category
  (e.g. `Storgata Borettslag` → `housing`, which the current table already ranks
  above `transfers`). **Why deferred**: the own-account transfer-rule feature
  (see `src/lib/transferRules.ts`) already fixes the spend/savings-rate distortion;
  the remaining issue is only cosmetic category labels, which the existing per-row
  relabel flow (EditTransactionModal → `addCategoryRule`) can already fix. A bulk
  re-categorize must strictly gate on `categorySource === 'auto'` to avoid
  clobbering manual categorizations, and that guard needs care/testing. **What would
  unblock**: agreement on the gate + a confirm step in the UI. **Where**: new action
  in `src/pages/SettingsPage.tsx`, reusing `categorizeWithRules` from
  `src/lib/categorize.ts` over `dailyTransactions` in `src/context/FinanceContext.tsx`.

## Property / boliglån tracking — follow-ups

Shipped (2026-07): the homeowner Loan page now records the real mortgage (loan account
label + origination `startDate`, with a derived payoff date and term-elapsed %), the
apartment purchase (address, type, `purchasePrice`, `purchaseCosts`, borettslag
`jointDebtShare`, move-in), and a **residence history** timeline of homes lived in
(`Residence[]`, move-in/out + sale price/gain). New persisted `residences` array (registered
like `salaries` in `src/lib/payloadRegistry.ts`), enriched `HomeownerData`, pure logic in
`src/lib/property.ts` (+ tests), UI in `src/pages/BoligPage.tsx` and the new
`src/components/ResidenceHistory.tsx`. Remaining, deliberately deferred:

- **Exact bank amortization import.** The app's amortization is annual-granularity and
  computed from (balance, rate, term); it does not import the bank's literal per-month
  "Nedbetalingsplan" (per-row Avdrag/Renter/Omkostninger, effektiv rente, sub-year term like
  "29 år 3 måneder"). **What would unblock**: a decision on whether to store a bank schedule
  verbatim vs keep deriving it. **Where**: `src/lib/calculations.ts`
  (`calcAmortizationSchedule`), `src/pages/BoligPage.tsx` (AmortizationAccordion).
- **Serial (serie) loan type.** The engine only models annuity loans. **Where**:
  `src/lib/calculations.ts`.
- **Loan rate-change history.** `HomeownerData.notifiedRate`/`notifiedRateFrom` are
  display-only (matching the bank's "Varslet nominell rente fra …"); there is no timeline of
  past rates. **What would unblock**: agree whether a rate history feeds the schedule or is
  informational only. **Where**: `HomeownerData` in `src/context/FinanceContext.tsx`.
- **Unified housing-lifecycle model (the "thought-through" version).** The redesign +
  property/history is now shown in the two owner modes (Boligeier and Kjøpe & selge, 2026-07),
  but `residences[]` is still a parallel record, not linked to the live current-home financials
  (`assets.houseValue`/`houseDebt`, mirrored across `homeowner`/`transition`). The coherent model
  is: the current residence (no `moveOutDate`) *is* the current home, `housingMode` is its
  lifecycle stage (planning → owning → selling), and completing a sale/purchase advances the
  timeline. Deferred because it rewires the money-math mirroring (net-worth blast radius) for a
  transition that happens rarely in a single-home app. **What would unblock**: decision to harden
  this as a shareable product + accept the mirroring refactor. **Where**: `updateAsset`/
  `updateHomeowner`/`updateTransition` mirroring in `src/context/FinanceContext.tsx`,
  `src/lib/property.ts`.
- **"Registrer flytting" (record-the-move) action.** The Kjøpe & selge flow still doesn't write
  the move into history: selling doesn't set the old residence's `moveOutDate`/`salePrice`, and
  buying doesn't create the new residence — the user re-enters it manually in Boligeier. A
  one-click action in the transition summary could write both from the calculator values.
  Deferred (chosen over automation) in favour of a clean manual log; revisit if the manual step
  proves annoying. **Where**: transitioning block in `src/pages/BoligPage.tsx`, `residences` CRUD
  in `src/context/FinanceContext.tsx`.

## Co-owned home — follow-ups (2026-10)

Shipped in #220 and #223: co-owners of the current home with ownership and loan share
(`assets.coOwners`, pure logic in `src/lib/ownership.ts`). Home value and loan are stored in full;
net worth, wealth tax, rentefradrag and the gjeldsgrad headline use the user's share. Remaining:

- **History months stored only as a total aren't split by share.** Months with a
  `netWorthHistory` number but no balance snapshot keep their recorded value, so adding a co-owner
  "since" an earlier month can still show a step in the net-worth chart between those months and the
  first snapshot. **Why deferred**: the home value and loan for those months were never stored, and a
  hand-entered total may already be the user's share, so scaling would be a guess. **What would
  unblock**: the user backfilling those months as full snapshots (History manager), or a decision to
  mark them as estimated inside a co-owner window. **Where**: `netWorthSeriesFrom` in
  `src/lib/netWorth.ts`, `rewriteSnapshotCoOwners` in `src/lib/ownership.ts`.
- **Spouses.** Married co-owners get a doubled wealth-tax bunnfradrag and can split rentefradrag
  freely; the app models one person. **Why deferred**: needs a marital-status field and touches
  `norwegianTax.ts`. **What would unblock**: an issue covering both. **Where**: `calcWealthTax` in
  `src/lib/norwegianTax.ts`, `annualMortgageInterest` in `src/context/FinanceContext.tsx` and
  `mcp/derive.ts`.
- **Buy-and-sell with a jointly bought next home.** The new loan is the full purchase price minus
  only the user's share of the sale, and the same co-owners carry over to the next home with a
  `since` that refers to the old one. A note in the UI says the new home is calculated as the user's
  alone. **What would unblock**: co-buyers in borrowing capacity (plan PR 3), then separate
  co-owner sets for the sold and the new home. **Where**: `transitionNewLoan` in
  `src/pages/BoligPage.tsx`.
- **Projections use today's loan share.** `projectSnapshotBalances` and automation catch-ups gross
  up a "my share" mortgage payment with today's `mortgageDebtShare`, even past a co-owner's `until`
  or before a future `since`. **What would unblock**: pass the share per month into the runner.
  **Where**: `computeAutomationPostings` in `src/lib/automation.ts`, `src/lib/projectBalances.ts`.
- **Onboarding step for ownership share.** The home topic asks only value and debt. **Where**:
  `src/lib/onboarding.ts` (home topic).
- **A declined catch-up counts its skipped months as interest-charged.** Two rules paying the same
  loan now charge each month's interest once, using the other rules' `lastPostedMonth` stamps as
  "already charged". Declining a catch-up stamps months it never paid, so a later catch-up by another
  rule on that loan pays those months as principal only. Fixing it needs per-loan "interest charged
  through" state rather than inferring from stamps. **Where**: `computeAutomationPostings` in
  `src/lib/automation.ts`.
- **MCP server clock vs browser clock.** Co-owner `since`/`until`, the term countdown and the
  snapshot month use the local month, so the two can disagree for a few hours at month end.
  **Where**: `currentMonthKey` in `src/lib/date.ts`, its uses in `mcp/derive.ts`.
## Sekundærbolig (second-home) tool — deferred items

Shipped (2026-07): the `/loan` page became a **Bolig hub** (`/bolig`, old path redirects) with
a tab strip between the existing mortgage tools ("Boliglån") and a new **Sekundærbolig**
planner. The planner models buy-to-rent and renovate-and-refinance (BRRR) with the Norwegian
tax picture (rental-income tax 22% of net, interest deduction, formuesskatt at 100% valuation,
capital-gains 22% on a modelled sale). Named scenarios persist in the blob
(`secondHomeScenarios`, backup/restore/export). Scenarios can be flagged `committed` to stack
into a **portfolio** summary (cumulative debt vs 5×-income headroom, combined cashflow, equity
tied up) so buying home 2 → 3 → 4 scales, plus a cross-scenario **comparison table**. Pure
engine `src/lib/secondHome.ts` (+ tests: `calcPortfolio`/`summarizeScenario`); UI in
`src/pages/bolig/SecondHomePanel.tsx`; hub in `src/pages/BoligPage.tsx`.

Remaining / intentionally out of v1:

- **Tax model is a deliberate simplification** (disclosed in-UI). Not modelled: short-term /
  Airbnb rental (taxed on 85% of income over 10k, different regime); the owner-occupied
  tax-free rental rule (renting <50% of your primary home); full-household formuesskatt
  (bunnfradrag, spouse split, the automated 25%/100% ligningsverdi); capital-gains *benefit*
  on a modelled loss; botid exemption on a secondary that was once a primary. **Where**:
  `src/lib/secondHome.ts` (`calcRentalIncomeTax`, `calcWealthTaxImpact`, `calcPropertyCapitalGains`).
- **Scenarios aren't snapshotted into the time machine.** They're forward-looking and render
  always-live, independent of `useBalanceHistory` (unlike the mortgage tools). Fine by design;
  noted in case historical scenario tracking is ever wanted.

## Balance automations — deferred bits (shipped 2026-08)

Shipped: the monthly automation runner now covers **portfolio (aksjer/ASK) and BSU** as
fixed-expense destinations, and **OTP/IPS pension contributions** as synthesized rules that need
no budget line (`src/lib/pensionAccrual.ts` projects pension state onto the same `AutomationRule`
shape, so both sources share one runner, one catch-up prompt and one double-apply guard —
`src/lib/automation.ts`). User control: a Settings master switch (`automationEnabled`), a
per-expense pause (`FixedExpense.automationPaused`), and per-scheme opt-ins on the Pension page
(`pension.otpAutoPost` / `ipsAutoPost`, both default **false**). Plus the savings-target split
(`src/lib/savingsAllocation.ts`, `src/components/SavingsAllocationPanel.tsx`): a percentage
allocation of `recommendedInvestment` across destinations, with a one-click "create these as fixed
expenses" that hands them to the runner. `savingsContributionTotal` now counts portfolio/BSU as
retained money, not spend (`src/lib/savingsRate.ts` `isSavingsDestination`).

Deliberately deferred:

- **Assumed growth never posts, and there is no suggestion flow for it.** Only contributions are
  written to a balance; `otpGrowthRate` / `ipsGrowthRate` / `growthReturnRate` stay in the
  projections. That is the intended safety property (compounding a guess into a stored balance
  would launder it into recorded net worth, and `balanceSnapshots` would freeze it into history) —
  but the agreed design also had a *suggestion* half that was not built: "this balance is 8 months
  old; at 7% it would now be ~X — confirm or enter the real number". **What would unblock**: a
  decision on where the suggestion lives (a card on Assets/Pension vs the monthly reconcile prompt
  below). **Where**: `src/lib/pensionAccrual.ts` (contributions only), `src/pages/AssetPage.tsx`,
  `src/pages/PensionPage.tsx`.
- **No staleness surfacing on user-entered balances.** External feeds have `*Stale` flags, retry
  and refresh affordances; the user's own balances have no "last confirmed" concept at all
  (`src/lib/provenance.ts` is value-vs-default only). The cheap version needs no schema change:
  derive last-touched as the most recent month in `balanceSnapshots` where the value *changed*.
  Then an age dimension on `ProvenanceBadge` and a monthly reconcile prompt (the `NumberRow` grid
  in `src/components/HistoryManagerModal.tsx` already renders exactly this form). **Where**:
  `src/lib/provenance.ts`, `src/components/ui/ProvenanceBadge.tsx`, `src/lib/snapshots.ts`.
- **Estimates that are fetched but never applied.** `PropertyValueEstimate` computes a house value
  from the live SSB square-metre price with no "use this" action, and
  `homeowner.notifiedRate`/`notifiedRateFrom` never applies itself when its month arrives — both
  are places the app already knows the answer and still lets the stored value rot. **Where**:
  `src/components/PropertyValueEstimate.tsx`, `HomeownerData` in `src/context/FinanceContext.tsx`.
- **Editing an allocation percentage does not update the expenses it created.** The created
  `FixedExpense` keeps its original amount; the panel shows the divergence (an "Aktiv · X" chip
  against the newly planned figure) but offers no re-sync action. Deferred because a sync would
  have to decide whether the allocation or the expense is authoritative, and silently rewriting a
  budget line the user may have since edited by hand is worse than showing the gap. **What would
  unblock**: agreeing the allocation is authoritative, then a "sync amounts" button.
  **Where**: `src/components/SavingsAllocationPanel.tsx`, `src/lib/savingsAllocation.ts`.
- **The savings target shrinks as you automate, by construction.** `recommendedInvestment` is a
  share of the residual, and committing savings as a fixed expense reduces the residual — so the
  target falls each time you act on it. Surfaced honestly (the panel shows "already automated" and
  a per-row active chip) rather than fixed, because "% of what is left uncommitted" is a coherent
  definition and changing it would move a number used across Dashboard/Assets/Forecast.
  **Where**: `calcRecommendations` in `src/lib/calculations.ts`.

## Savings rate (Spareandel) — remaining gaps

Fixed (2026-07): three bugs made the savings rate read far worse than reality.
(a) automated savings transfers were subtracted as consumption; (b) the target
(a share of *residual*) was compared against and plotted on top of a rate (a share
of *income*); (c) a budgeted fixed expense and its own imported bank payment were
both charged, roughly doubling expenses for any month with bank coverage. See
`savingsContributionTotal` / `targetRateOfIncome` (`src/lib/savingsRate.ts`), the
optional `fixedExpenses` reconciliation arg in `src/lib/monthlyCashflow.ts`, and the
`measured` flag that stops pre-bank-sync months plotting as high-savings months.

Remaining:

- **`mortgage` and `debt` destinations still count as pure spend.** The principal
  portion of a loan payment builds equity and belongs in the savings rate, but a
  `FixedExpense` holds the *gross* payment, so counting it whole would overstate the
  rate. Needs the amortization split `src/lib/automation.ts` already computes,
  threaded into the rate. **Where**: `savingsContributionTotal` in
  `src/lib/savingsRate.ts` (the destinationKind filter), `src/lib/automation.ts`.
- **The overlapping-jobs warning only checks the current month.** A job change
  entered with a stale end date in a *past* or future month still double-counts
  gross there (and so in the 12-month income series, volatility, and every chart
  keyed off it) without any warning. Checking the whole series would catch it, at
  the cost of deciding which month to point the user at. **Where**:
  `overlappingJobs` in `src/pages/SalaryPage.tsx`, `activeJobBreakdown` in
  `src/lib/salary.ts`.
- **A job with no salary entries contributes nothing, silently.** Once every job
  with a salary has ended, `calcActiveGrossAnnual` returns 0 and
  `derivedNetMonthlyFor` falls back to the legacy flat `income` field — so a
  long-range forecast can quietly switch from salary data to a single stale
  number. Worth a warning of its own. **Where**: `derivedNetMonthlyFor` in
  `src/context/FinanceContext.tsx`.
- **Suggestion thresholds are untuned beyond one real dataset.** `MIN_SUGGESTION_TOTAL`
  (2000 kr) and the "3+ months" recurrence override were checked against a single
  user's 244 transactions. A different bank's statement format may not use a
  `Til:` prefix at all, leaving only the account-number and round-amount signals.
  **Where**: `src/lib/transferSuggestions.ts`.
- **CashflowChart still shows savings transfers as money out.** Deliberate — it is a
  literal cashflow view, not a retention view — but the two Budget-page charts then
  disagree about the same transfer. **Where**:
  `src/components/charts/CashflowChart.tsx`.

## Blocked major dependency upgrades (2026-08)

Still blocked as of 2026-10; this is the one
holdout.

- **`typescript` 6.0.3 → 7.0.2 is blocked upstream.** `typescript-eslint@8.72.1` (the newest
  release — there is no v9) declares `peer typescript ">=4.8.4 <6.1.0"`, so the resolver cannot
  satisfy TS 7 alongside the current lint stack, and `npm ci` fails outright. Nothing to fix in
  this repo. **What would unblock**: a `typescript-eslint` release widening its peer range to
  TS 7; the bump is mechanical after that. **Where**: `package.json` (`typescript`,
  `typescript-eslint`).

## Public demo mode (2026-08) — deferred items

`DEMO_MODE=1` shipped (`server/demo.js`, plus the locked client demo in `FinanceContext`).
Two gaps were knowingly left.

- **The rate limiter is one global bucket, which a public demo shares across all visitors.**
  `apiLimiter` uses `keyGenerator: () => 'single-user'` — deliberately, because the app is
  single-user and that sidesteps `X-Forwarded-For` trust. On the public demo that means one
  visitor (or one crawler) hammering `/api/inflation` can spend the 2000-per-15-min budget and
  429 everyone else. Deferred because per-IP keying requires deciding how far to trust the
  proxy chain, and it would change limiter behaviour for the private instance too, which was
  out of scope for standing the demo up. The blast radius is availability of a demo, not data.
  **What would unblock**: key the limiter per-IP when `DEMO_MODE` is on, with `app.set('trust proxy', …)`
  scoped to the known gateway. **Where**: `server/index.js` (`globalKey`, `apiLimiter`).
- **A visitor holding a stale service worker would boot the pre-demo client.** The PWA precaches
  the app shell, so a browser that cached a build predating `DEMO_MODE` would fetch `/api/data`,
  find it empty, and then 403 on every autosave — an empty app with a "not saved" banner rather
  than the demo. Deferred because it cannot happen on a fresh deployment (no prior visitors) and
  self-heals as soon as the update prompt is accepted. **What would unblock**: nothing needed
  unless the demo URL is ever repointed at a different app; if so, bump the SW cache name.
  **Where**: `vite.config.ts` (VitePWA `workbox`), `src/context/FinanceContext.tsx` (boot effect).

## Desktop app (2026-08) — unsigned builds and bank linking

Shipped: an Electron wrapper (`desktop/`) that runs `server/index.js` in a child process and ships
it as a Mac/Windows download, built by `.github/workflows/desktop-build.yml` and attached to the
release by `release.yml`. No second data path — the packaged app runs the same server, API and
SQLite storage as the container. All three artifacts have now been installed and launched by hand
(macOS arm64 and Intel, Windows 11 x64).

- **Windows signing is wired but switched off — it needs the SignPath Foundation application.**
  `desktop-build.yml` uploads the unsigned `.exe`, submits it to SignPath and ships the signed one
  back, all skipped while the `SIGNPATH_API_TOKEN` secret is empty, so releases still go out
  unsigned. Deferred because the certificate is an application to a third party (days to weeks),
  not work in this repo. Note the trade before applying: the certificate is issued to SignPath
  Foundation, so that is the publisher Windows names, and their terms require publishing a code
  signing policy in the README once it is live. **What would unblock**: applying at signpath.org,
  then setting the secret plus the four `SIGNPATH_*` repository variables — no code change.
  **Where**: `.github/workflows/desktop-build.yml` (`SIGN_WINDOWS`), `desktop/README.md` (the
  step-by-step and the required policy wording).
- **macOS is still unsigned, and only money fixes it.** Ad-hoc signing (`identity: '-'`) is the
  minimum that stops Apple Silicon rejecting a downloaded app as "damaged", but Gatekeeper still
  reports an unidentified developer. There is no free-for-open-source equivalent of SignPath on
  Apple's side. **What would unblock**: an Apple Developer account ($99/yr), then the credentials as
  repository secrets, `mac.identity` + `notarize` set, and `CSC_IDENTITY_AUTO_DISCOVERY` re-enabled.
  The entitlements file is already notarization-ready. **Where**: `desktop/electron-builder.yml`,
  `desktop/build/entitlements.mac.plist`, `.github/workflows/desktop-build.yml`.
- **The update check only notifies; it does not install.** `update.js` compares the running version
  against the latest GitHub release and `main.js` offers Download / Later / Skip. Deferred the
  self-installing version because Squirrel.Mac refuses the ad-hoc macOS signature, so
  `electron-updater` would be Windows-only — a dependency, a `latest.yml` publishing step and two
  divergent update paths to maintain, for half the platforms. **What would unblock**: signing both
  platforms (the two items above); at that point `electron-updater` with `autoDownload` is worth it.
  **Where**: `desktop/update.js`, `desktop/main.js` (`checkForUpdate`), `desktop/electron-builder.yml`.
- **Bank linking is untested in the desktop app and probably needs work.** The Enable Banking flow
  redirects to the bank and back to a registered callback URL. `main.js` sends off-origin
  navigations to the system browser, so BankID opens correctly, but the callback then lands in the
  browser rather than the app window, and it only works at all if the app is on its default port
  (3737) — the wrapper falls forward to another port when that one is taken, which the registered
  redirect URL cannot follow. Not blocking: bank sync needs an Enable Banking application ID and
  private key, which a downloader will not have. **What would unblock**: register a custom protocol
  (`headroom://`) as the redirect target and handle `open-url` / `second-instance` in the wrapper.
  **Where**: `desktop/main.js` (`FIRST_PORT`, `will-navigate`), `server/bank.js`.

## Savings as their own type — deferred UI work (shipped 2026-08)

Shipped: savings are their own record (`Saving` in `src/context/FinanceContext.tsx`) in their own
`savings` array, with their own dialog (`src/components/SavingDialog.tsx`) and their own row
renderer on the Budget page. `ExpenseType` no longer has a `'saving'` member and
`ExpenseDestinationKind` is down to `mortgage | debt`; the runtime `isSavingsRow` predicate is gone.
Stored blobs and v1/v2 balance snapshots are split at load by `partitionSavings`
(`src/lib/savingsMigration.ts`), amounts untouched.

Remaining — the visual half, deliberately left out to keep the model change reviewable:

- **Savings rows are still one flat list.** A "Sparekonto: Ferie/Gaver", a "Bufferkonto" and an
  "Aksjer og fond" row render identically, though they are a goal pot, a safety net and an invested
  position. Grouping or differentiating by `destinationKind` is the visual payoff of the split.
  **What would unblock**: a design decision on how much per-vehicle treatment is worth the width.
  **Where**: `renderSavings` in `src/pages/BudgetPage.tsx`.
- **A row shows what moves, never where it stands.** "500 kr/mnd → 12 400 kr" would answer the
  question the row raises; the destination balance is already in `assets`.
  **Where**: `renderSavings` in `src/pages/BudgetPage.tsx`, `assets.savingsAccounts` / the scalars.
- **The derived-mode caption wraps badly in the narrow column.** "60.8209 % AV SPAREGRUNNLAGET ·
  FØLGER INNTEKTEN" takes two uppercase lines under an already-truncated name. Worth a rethink
  alongside the card's `lg:col-span-3` width. **Where**: `src/pages/BudgetPage.tsx`.
- **`SavingsAllocationPanel` is the one place that writes both arrays.** Activating a plan row
  creates a `Saving` for a savings vehicle and a `FixedExpense` for mortgage/debt. That is correct
  but it is the only remaining spot where the two shapes meet, so it is where a future change is
  most likely to go wrong. **Where**: `createExpenses` in `src/components/SavingsAllocationPanel.tsx`.

## MCP generic `set_field` / `describe_field` tools

**What:** a `describe_field(key)` read tool and a `set_field(key, value)` write tool covering every
`PersistedKey`, validating `value` with that key's payload-registry `read()` guard.
**Why deferred:** `makePayloadRegistry` needs the default `assets`/`loan`/`pension`/`homeowner`/
`transition`/`fixedExpenses` objects, and those are module-private constants in
`src/context/FinanceContext.tsx`, which pulls in React. The MCP server must not import it. Also,
about 20 keys read with `whenDefined`/`whenTruthy`, which accept any non-undefined value
(`income: "abc"` passes), so the registry guard alone cannot reject a wrong type for those keys.
**Unblock:** move the six default constants into `src/lib` (FinanceContext re-imports them), and
decide how to type-check the weakly guarded keys (per-key zod schemas, or a check against the
registry `default`). **Where:** `src/lib/payloadRegistry.ts`, `src/context/FinanceContext.tsx`
(`DEFAULT_ASSETS` ~line 584 through `DEFAULT_PENSION`, `PAYLOAD_REGISTRY` ~line 659),
`mcp/tools/write.ts`.

## Revision-history prune scans every snapshot on each save

**What:** the byte-cap prune in `recordHistory` sums `LENGTH(content)` over every `finance_history`
row on every save, which reads each snapshot. Measured at the 200 MB cap: about 70-120 ms of blocked
event loop per save. `GET /api/history` does the same scan. At today's ~110 KB blob the table stays
far below the cap, so the cost is small.
**Why deferred:** found in the post-merge audit of the revision system; not a correctness issue and
not reachable at current data size.
**Unblock:** add a `bytes` column filled at insert time (backfill once on startup) and sum that in
the prune and list queries.
**Where:** `server/index.js` (`historyPruneBytesStmt`, `historyListStmt`, `recordHistory`).


## Skattekort (tax table / trekkprosent) — follow-ups

Shipped (2026-10): the Salary page takes a skattekort (table number with monthly, 14-day or weekly pay, or a trekkprosent) and shows monthly withholding, bonus and overtime included, plus the restskatt/refund against the modelled annual tax. This year's budget income uses the card's yearly withholding, spread evenly (the existing feriepenger model adds the June/December shape). Tabelltrekk is a port of Skatteetaten's trekkrutine, checked against every monthly, 14-day and weekly row of the 2026 "trekktabeller i tekstformat" file.

- **Holiday pay above salary isn't in the Forecast, money-flow chart or pension figures.** Budget income (UI and MCP) and the skattekort's expected tax now count `feriepengerSurplus` as taxed income; the Forecast's yearly net, the money-flow Sankey, the pension page's current net and the Salary page's tax breakdown still tax salary only, so year one of the Forecast sits ~1% of salary below the budget × 12. **Unblock**: thread the surplus through `projectForecast` (needs last year's gross per projected year) and the other `calcTaxByRegion` salary callers. **Where**: `src/lib/forecastProjection.ts`, `src/components/charts/MoneyFlowSankey.tsx`, `src/pages/PensionPage.tsx`, `mcp/derive.ts`.
- **2027 withholding tables aren't out yet.** `TREKK_PARAMS` only has 2026; later years fall back to the 2026 tables. The Trekk tables workflow (`.github/workflows/trekk-tables.yml`, Mondays November–February) adds the year from Skatteetaten's trekkrutine once both `Konstanter.java` and the table file are published (usually December), checks it against every row of the file and opens a `tier:review` PR, or an issue if the trekkrutine changed shape. **Unblock**: Skatteetaten publishing 2027; then review and merge that PR (it needs `--admin`, like release PRs). **Where**: `scripts/trekk/update-trekk-year.mjs`, `src/lib/forskuddstrekk.file.test.ts`, `src/lib/forskuddstrekk.ts`.
