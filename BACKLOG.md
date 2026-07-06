# Backlog

Items deferred from prior work. When an item is finished, remove it.

## Payslip importer — follow-ups

Shipped (2026-07): client-side Visma payslip import on the Budget page. PDFs are parsed entirely in-browser (pdf.js, lazy-loaded) and never stored; a single-month PDF opens a detailed editable review, a multi-page archive opens a batch list that fills income history back in time. Per-month figures live in `payslips: Record<month, MonthlyPayslip>` (`src/context/FinanceContext.tsx`), and net pay is written as that month's income override. Parser + tests in `src/lib/payslip/` (`parseVismaPayslip.ts`, `parsePayslipAmount.ts`, provider registry in `index.ts`); browser extraction/render in `extractPdfText.ts`; UI in `src/components/PayslipImportModal.tsx` + `src/pages/BudgetPage.tsx`. Remaining:

- **Only Visma is supported.** The provider registry (`src/lib/payslip/index.ts`, `parsePayslip` iterating `PARSERS`) is built to take more formats, but only `parseVismaPayslip` exists. Adding another payroll provider = write a `PayslipParser` (returns `null` when it doesn't recognise the text) and push it onto `PARSERS`. **Unblock**: a sample PDF from the new provider to build a fixture from (tests inline the extracted text lines, never the binary).
- **Line items (on-call / overtime) aren't parsed into their own entries.** The Visma parser deliberately drops the pay-line table (Fastlønn / On-Call / Feriepenger rows) because the thousands-space and column-separator are the same character, making per-column amounts ambiguous (e.g. `On-Call ... 24/7 108,00` mis-bridges to `7 108,00`). Only the headline figures (gross/net/tax/base/holiday) are extracted. **What would unblock**: column parsing anchored on the payslip's fixed X positions (available from pdf.js `transform[4]`) instead of regex over the joined line, then map rows to `OvertimeEntry`/`BonusEntry`. **Where**: `src/lib/payslip/parseVismaPayslip.ts` (extraction), `src/lib/payslip/extractPdfText.ts` (would need to preserve per-item X), `src/components/PayslipImportModal.tsx` (write mapping).

## Debt modeling — follow-ups

Non-mortgage debts (studielån / forbrukslån / kredittkort) now exist (`Debt` in `src/context/FinanceContext.tsx`, math in `src/lib/debt.ts`, UI in `src/components/DebtSection.tsx` on the Formue page). They reduce the headline net worth (`netWorth = totalEquity − totalDebt`) and feed the gjeldsgrad metric. Remaining:

- **Debts aren't historized or projected.** The Dashboard 12-month net-worth chart and the Formue growth projection are asset-equity based, so when debts > 0 the hero/highlight net-worth number sits slightly below the chart's latest point, and the growth projection's "Nå" starts from asset equity (excludes other debt). To fix: snapshot `debts` in `BalanceSnapshot` and factor debt paydown into `calcNetWorthProjectionByBucket` (mirrors the existing "contributions/rates not snapshotted" caveats). *Larger + touches the projection math — deferred for careful handling.*

## Time/data-model rethink — follow-ups

Shipped (2026-07): the contextual month picker, provenance badges, editable net-worth history, monthly balance snapshots, and the balance-page time machine are all done. Details: contextual picker (interactive only on `/` and `/overview`; static "as of today" marker elsewhere; hidden on `/settings` — `MONTH_SCOPED_ROUTES` / `HIDE_TIME_MARKER_ROUTES` in `src/components/Layout.tsx`); `ProvenanceBadge` Default/Yours/Estimate (`src/lib/provenance.ts`, `src/components/ui/ProvenanceBadge.tsx`) on high-impact assumptions across Assets/Settings/Pension/Employer Cost + a Dashboard "defaults nudge"; `setNetWorthForMonth`/`clearNetWorthForMonth` + `NetWorthHistoryModal` (`src/components/NetWorthHistoryModal.tsx`); `BalanceSnapshot` + `balanceSnapshots` auto-captured for the current calendar month and persisted/exported/imported; `useBalanceHistory` (`src/hooks/useBalanceHistory.ts`) + `BalanceHistoryBar` (`src/components/BalanceHistoryBar.tsx`) making Assets/Loan/Pension render read-only history, with shared equity math in `src/lib/equity.ts`. Demo data (`src/lib/demoData.ts`) seeds 6 months of snapshots so demo mode showcases it.

Remaining:

- **Deepen the time machine.** (a) Stepper state is per-page (each balance page defaults to live) — consider lifting it so the selected month carries across Assets/Loan/Pension. (b) `AssetPage` projections in history mode still use the *live* `mortgageRate`/`mortgageTermYears`/`recommendedInvestment` (forward assumptions, not snapshotted). (c) `PensionPage` history shows snapshot pension balances but live `salaries`/`jobs` (contributions aren't snapshotted). (d) Let users hand-enter historical breakdowns to backfill months from before they used the app.
- **Extend provenance badges to the remaining defaults** — fixed-expense seeds, whole `loan`/`homeowner`/`transition` objects, `savingsTargetPercent`. Consider a first-run setup flow that converts defaults into explicit choices, reusing `provenanceOf`.

Known limitations:
- **Provenance is a value-comparison heuristic** (`provenanceOf` in `src/lib/provenance.ts`): a user who deliberately sets a value equal to the default sees "Default". A true fix needs explicit provenance tracking in state (a `touched` set). The Dashboard "defaults nudge" count (`defaultAssumptions` in `src/pages/DashboardPage.tsx`) inherits the same heuristic.
- **AssetPage growth RateChips are unbadged** — the compact chips at `src/pages/AssetPage.tsx:394-397` (which open the same editor as Settings) were left without badges to avoid clutter; the canonical badged surface for growth rates is Settings.
- **`recommendedInvestment` on Assets is silently month-coupled** — it derives from `effectiveIncome` (month-scoped), so with the picker hidden on `/assets` the value still reflects whatever month was last selected on Budget/Dashboard. **Where**: `calcRecommendations(effectiveIncome, …)` at `src/context/FinanceContext.tsx:1654`, consumed in `src/pages/AssetPage.tsx`.
- **Net-worth history editor covers a rolling 12-month window** matching the Dashboard chart. Editing months older than 12 back isn't exposed.

## Live SSB wage statistics

`/api/wage-stats` currently returns a curated static series (server/index.js, `WAGE_STATS_STATIC`). Should query SSB table 11418 (or 13606) for live national median annual wage instead.

**What's needed**: the SSB PXweb query for that table requires picking correct `Yrke`, `Sektor`, `Kjønn` dimension codes — these vary by table version and need to be confirmed by inspecting the live metadata at `https://data.ssb.no/api/v0/no/table/11418/`. Once confirmed, add `fetchWageStats(years)` to `server/ssb.js` and call it from the endpoint with a 30-day cache (mirror the `inflation_cache` pattern).

**Where**: `server/ssb.js`, `server/index.js`. The frontend already consumes `/api/wage-stats` and renders a comparison line on the salary timeline.

## Polish items noticed during the restyle

- **Per-file `card` and `sectionLabel` string constants** still exist in `AssetPage`, `BudgetPage`, `LoanPage`, `SmartRecommendations`, `FunBudget`. Functional but the new `Card` and `SectionLabel` primitives in `src/components/ui/` would consolidate them. Dashboard is already using the primitives. (Cosmetic; deferred — a broad JSX churn across many render sites with only visual verification to catch regressions.)
- **`isDarkMode` field in `ExportPayload`** was removed from the producer side, but old JSON exports from before the dark-mode removal still carry the field. The importer ignores it gracefully — no action needed unless we want to clean very old export files.

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

OTP + IPS tracking is shipped (balance, contribution, growth, retirement-readiness tile on Forecast). Remaining pension topics:

- **Folketrygd / NAV state pension** — separate income stream at retirement based on lifetime income, G-multiple, and årskull. Adds a baseline monthly pension on top of OTP/IPS. Needs a simplified inntektsgrunnlag model. **Where**: `src/lib/norwegianTax.ts` (new `calcFolketrygd`), `src/pages/ForecastPage.tsx`.
- **Withdrawal-phase taxation** — currently pension is shown as gross balance. Modeling drawdown tax (IPS as alminnelig 22%, OTP as ordinary wage-equivalent tax bracket) gives an honest "monthly pension net" number. **Where**: `src/lib/norwegianTax.ts`.
- **AFP (Avtalefestet pensjon)** — eligibility-based (LO/NHO members, tenure ≥ 7 years etc.), can boost pension significantly. Defer until folketrygd lands.
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
- **Cron isn't installed by anything.** The daily `curl` schedule is documented in
  `scripts/enable-banking/README.md` but must be added to the homelab crontab (or a Docker
  sidecar) by hand. Consider shipping a compose service / entrypoint hook.
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
- **Pending rows excluded.** `mapEBTransactions` drops `PDNG` (they churn until booked); very
  recent spending is invisible until it books. Revisit if the lag matters.
- **`out/` + `.cert/` leftovers** from the retired CLI prototype live under
  `scripts/enable-banking/` (gitignored, `out/` holds a real-data dump). Safe to delete.

## Audit (2026-07-04) — deferred architecture & data-safety items

Most of `AUDIT.md` is done (see its "Progress log"). These remaining entries are larger refactors, several touching the persistence backbone — deferred because they can't be safely exercised against the user's real data volume without a throwaway `DATA_DIR` and careful diffing.

- **§4.1 Memoize the context value + stabilize actions — DONE (2026-07).** All ~40 actions are now `useCallback`-stabilized; the provider is split into three memoized contexts — `FinanceSettingsContext` / `FinanceDataContext` / `FinanceDerivedContext` — with `useFinanceSettings`/`useFinanceData`/`useFinanceDerived` hooks and a memoized `useFinance()` shim (`{...settings,...data,...derived}`) for backward compat. `Layout` migrated to `useFinanceSettings()` (settings-only → no re-render on data edits). `demoMode`/`toggleDemoMode` live in Settings (demo actions read `buildPayload`/`currentMonth` via refs to stay stable). **Not migrated**: `BudgetPage`/`DashboardPage` genuinely read all three slices, so the shim is already optimal for them — splitting their destructures would be churn with no re-render reduction. Migrating any *future* single-slice-heavy component to a granular hook is the way to extend the win.
- **§4.3 Unify i18n.** The typed translations table coexists with 145+ ad-hoc `lang === 'nb' ? … : …` ternaries (visible gaps: hardcoded `'estimert'`, always-Norwegian validation errors, Norwegian placeholders). **Fix**: move component copy into the table; rule "`lang` never appears in JSX except locale selection". **Done (2026-07)**: the ~1.3k-line table is extracted to `src/i18n/translations.ts` (with `Language`/`Translations` types); FinanceContext imports it. **Remaining**: migrate the 145 in-JSX ternaries into table keys. **Where**: all pages.
- **§4.4 Move page-embedded domain logic to `src/lib/`.** `SalaryPage` inline month math + `salaryAt` (duplicates `calcActiveGrossAnnual`), `DashboardPage` 12-month interpolation. Unlocks unit tests. **Where**: `src/pages/SalaryPage.tsx`, `src/pages/DashboardPage.tsx` → new `src/lib/salary.ts` etc.
- **§4.5 Unify the two charting systems.** `DashboardPage` has 4 bespoke SVG charts + a private `ChartTip` duplicating `ChartTooltip.tsx` and hardcoding hex, while every other page uses Recharts. **Fix**: one token-based chart primitive family, or accept Recharts here too (~400 lines out of DashboardPage). **Where**: `src/pages/DashboardPage.tsx:925-1472`.
- **§7.2 Self-host fonts + offline read-only data.** Fonts load from Google (fail offline, ping Google on every cold load); `/api/data` is network-only so offline shows the error banner over empty defaults. **Fix**: self-host fonts (Fontsource variable, or `public/fonts` + `@font-face`) so they precache — then the CSP can drop the Google allowlist too; optionally a NetworkFirst runtime cache for `GET /api/data` with an "offline — last synced" banner (keep POSTs network-only). **Where**: `index.html`, `vite.config.ts`, `server/index.js` CSP.
- **§5.5 ESLint depth.** Baseline only — no `recommendedTypeChecked`, no `eslint-plugin-jsx-a11y` (would auto-catch icon-button/label regressions), no formatter/pre-commit hooks. `no-unused-vars` is now configured. **Where**: `eslint.config.js`.
