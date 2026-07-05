# Backlog

Items deferred from prior work. When an item is finished, remove it.

## Payslip importer — follow-ups

Shipped (2026-07): client-side Visma payslip import on the Budget page. PDFs are parsed entirely in-browser (pdf.js, lazy-loaded) and never stored; a single-month PDF opens a detailed editable review, a multi-page archive opens a batch list that fills income history back in time. Per-month figures live in `payslips: Record<month, MonthlyPayslip>` (`src/context/FinanceContext.tsx`), and net pay is written as that month's income override. Parser + tests in `src/lib/payslip/` (`parseVismaPayslip.ts`, `parsePayslipAmount.ts`, provider registry in `index.ts`); browser extraction/render in `extractPdfText.ts`; UI in `src/components/PayslipImportModal.tsx` + `src/pages/BudgetPage.tsx`. Remaining:

- **Only Visma is supported.** The provider registry (`src/lib/payslip/index.ts`, `parsePayslip` iterating `PARSERS`) is built to take more formats, but only `parseVismaPayslip` exists. Adding another payroll provider = write a `PayslipParser` (returns `null` when it doesn't recognise the text) and push it onto `PARSERS`. **Unblock**: a sample PDF from the new provider to build a fixture from (tests inline the extracted text lines, never the binary).
- **Line items (on-call / overtime) aren't parsed into their own entries.** The Visma parser deliberately drops the pay-line table (Fastlønn / On-Call / Feriepenger rows) because the thousands-space and column-separator are the same character, making per-column amounts ambiguous (e.g. `On-Call ... 24/7 108,00` mis-bridges to `7 108,00`). Only the headline figures (gross/net/tax/base/holiday) are extracted. **What would unblock**: column parsing anchored on the payslip's fixed X positions (available from pdf.js `transform[4]`) instead of regex over the joined line, then map rows to `OvertimeEntry`/`BonusEntry`. **Where**: `src/lib/payslip/parseVismaPayslip.ts` (extraction), `src/lib/payslip/extractPdfText.ts` (would need to preserve per-item X), `src/components/PayslipImportModal.tsx` (write mapping).

## Debt modeling — follow-ups

Non-mortgage debts (studielån / forbrukslån / kredittkort) now exist (`Debt` in `src/context/FinanceContext.tsx`, math in `src/lib/debt.ts`, UI in `src/components/DebtSection.tsx` on the Formue page). They reduce the headline net worth (`netWorth = totalEquity − totalDebt`) and feed the gjeldsgrad metric. Remaining:

- **Debts aren't historized or projected.** The Dashboard 12-month net-worth chart and the Formue growth projection are asset-equity based, so when debts > 0 the hero/highlight net-worth number sits slightly below the chart's latest point, and the growth projection's "Nå" starts from asset equity (excludes other debt). To fix: snapshot `debts` in `BalanceSnapshot` and factor debt paydown into `calcNetWorthProjectionByBucket` (mirrors the existing "contributions/rates not snapshotted" caveats).
- **Debt payments don't flow into the budget.** A debt's `minPayment` isn't reflected as a fixed expense on the Budget page — consider surfacing total monthly debt service there.

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

## Phase 3 — financial insights expansion (deferred)

The POC C restyle and Settings page are shipped; the additional insight features the user asked for are not yet wired to real data. Sparklines on metric tiles currently use synthetic series where real history is sparse.

- **Real sparkline data on metric tiles** — `DashboardPage.tsx` hero uses `netWorthHistory` (real) but the small tiles (Residual / Can Spend / Investment) fall back to synthetic series. Need: monthly residual derived from `monthlyIncomes - totalFixedExpenses` over the last 12 months; daily-burn series from `dailyData`; monthly investment contributions from `monthlyIncomes * (savingsTargetPercent/100)`.
- **Spending-by-category bars** — `BudgetPage` "Fordelingsanalyse" already has a Recharts horizontal bar chart; add MoM delta chips per category by computing the previous month's totals from `dailyTransactions`.
- **Net-worth composition timeline** — `AssetPage` currently has a single net-worth projection chart; add a stacked-area chart of Investment / Property Equity / Crypto / Cash over time. Per-asset history now EXISTS via `balanceSnapshots` (`src/context/FinanceContext.tsx`) — derive each month's composition with `computeEquityBreakdown(balanceSnapshots[m].assets)` (`src/lib/equity.ts`). Snapshots only accrue going forward, so the series is sparse until data builds — fall back to estimates/current ratios for months without a snapshot.
- **Loan affordability chip** — `LoanPage` should show `loan.laanebelop / totalEquity` as a chip near the top. Trivial.
- **Headline insight banner on Dashboard** — auto-generated single-sentence insights like "You spent 14% less on food this month than the 6-month average." Computation belongs in a new `src/lib/insights.ts`. Needs category data on transactions to be useful.

**Unblock**: Phase 3 can start any time. All inputs live in `FinanceContext`; no new server endpoints needed. The `Sparkline` primitive at `src/components/ui/Sparkline.tsx` is ready.

**Where**: `src/pages/DashboardPage.tsx`, `src/pages/BudgetPage.tsx`, `src/pages/AssetPage.tsx`, `src/pages/LoanPage.tsx`, plus a new `src/lib/insights.ts`.

## Polish items noticed during the restyle

- **Recharts tooltips and grids** in `BudgetPage`, `AssetPage`, `LoanPage` still use literal hex (`#2a2a2a`) inline rather than the `--border` / `--text-3` CSS variables. Functional but inconsistent. Where: every `<CartesianGrid stroke="...">` and `<Tooltip contentStyle={{ ... }}>` in those three pages.
- **Recharts chart palettes** (e.g. `BudgetPage` `CHART_COLORS` array, `AssetPage` chart colors) still use the old `#0ea5e9 / #10b981 / #f59e0b` set. The body of the app uses the new `--chart-1`…`--chart-6` tokens. Migrate the arrays.
- **Per-file `card` and `sectionLabel` string constants** still exist in `AssetPage`, `BudgetPage`, `LoanPage`, `SmartRecommendations`, `FunBudget`. Functional but the new `Card` and `SectionLabel` primitives in `src/components/ui/` would consolidate them. Dashboard is already using the primitives.
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

- **Loan capacity oversimplified** — `LoanPage` first-buyer `totalLaaneevne = 5*arslonn + egenkapital - eksisterendeGjeld` omits the two binding Norwegian rules: the 85% LTV / 15%-equity cap and the +3pp affordability stress test. Should surface `maxPrice = min(maxDebt + equity, equity/0.15)` and a stress-tested payment. **Where**: `src/pages/LoanPage.tsx` (`totalLaaneevne`).
- **Trygdeavgift low-income band** — `norwegianTax.ts:101` charges `gross * 7.8%` once above the 99 650 threshold. Correct for normal salaries (the flat rate IS on full personinntekt), but it overcharges in the ~99 650–144 000 *opptrapping* band where the real avgift is capped at 25% of income above the threshold, and it has a hard cliff at the threshold. Also the 2025 rate is arguably 7.7%, not 7.8%. Low impact (only part-time/low earners). **Where**: `src/lib/norwegianTax.ts` (`trygde`).
- **Dashboard investment bars denominator** — `DashboardPage` monthly-investment bars use `income * savingsTargetPercent` (% of *gross income*), inconsistent with the projection/recommendation which use `residual * ratio`. Pick one definition. **Where**: `src/pages/DashboardPage.tsx` (`investmentBars`, ~line 164).
- **`ipsTaxSaving` hardcodes 22%** — `PensionPage` shows IPS tax saving as `contribution * 0.22`. Correct for the Norwegian regime, but in `region === 'generic'` the real saving is `customTaxRatePct`, so the displayed figure is wrong there. **Where**: `src/pages/PensionPage.tsx:44`.
- **Bonus / overtime never reach the budget** — entered on SalaryPage and shown in the comp chart, but `derivedMonthlyIncome` ignores them (lumpy income). Likely by-design; if they should count, add them to annual gross *before* tax (progressive). **Where**: `src/context/FinanceContext.tsx` (`derivedMonthlyIncome`).

**Unblock**: each is self-contained; none needs new server data. Confirm the intended product behavior (esp. loan-capacity rule and bonus/overtime) before implementing.

## Pension — phase 2

OTP + IPS tracking is shipped (balance, contribution, growth, retirement-readiness tile on Forecast). Remaining pension topics:

- **Folketrygd / NAV state pension** — separate income stream at retirement based on lifetime income, G-multiple, and årskull. Adds a baseline monthly pension on top of OTP/IPS. Needs a simplified inntektsgrunnlag model. **Where**: `src/lib/norwegianTax.ts` (new `calcFolketrygd`), `src/pages/ForecastPage.tsx`.
- **Withdrawal-phase taxation** — currently pension is shown as gross balance. Modeling drawdown tax (IPS as alminnelig 22%, OTP as ordinary wage-equivalent tax bracket) gives an honest "monthly pension net" number. **Where**: `src/lib/norwegianTax.ts`.
- **AFP (Avtalefestet pensjon)** — eligibility-based (LO/NHO members, tenure ≥ 7 years etc.), can boost pension significantly. Defer until folketrygd lands.
- **Foreign pension / IRA / 401k** — multi-currency pension buckets for users who worked abroad.
- **Pension contribution from variable comp** — `otpAnnual` calc currently uses `currentGross + currentOnCall` only. Real OTP base may include bonuses and is capped at 12G (~1.4M). Refine if it becomes inaccurate for high earners.

## Audit (2026-07-04) — deferred architecture & data-safety items

Most of `AUDIT.md` is done (see its "Progress log"). These remaining entries are larger refactors, several touching the persistence backbone — deferred because they can't be safely exercised against the user's real data volume without a throwaway `DATA_DIR` and careful diffing.

- **§4.2 Consolidate the persist/export payload shape.** It's hand-maintained in ~5 places (`FinanceContext.tsx`: autosave payload + its dep array, demo snapshot, `applyData`, `importAll`; `SettingsPage.tsx` export). Adding a persisted field means touching them all; `applyData`/`importAll` are drifting near-duplicates and `resetAll` re-inlines defaults instead of `DEFAULT_*`. **Fix**: one `buildPayload()` (`useCallback` over all state → used by autosave/demo/export) + one `applyPayload(data)` (`useCallback` over stable setters → used by load/import/demo-restore); `resetAll` reuses `DEFAULT_*`. **Unblock**: extract carefully, diff `applyData` vs `importAll` for the correct union (esp. `{...DEFAULT_x, ...data.x}` merges), and test round-trip against a throwaway server. **Where**: `src/context/FinanceContext.tsx`, `src/pages/SettingsPage.tsx`.
- **§1.5 Sanitize imported/loaded payloads.** JSON import is shallow-validated then cast; a hand-edited file (e.g. `assets.portfolio: "5000"`) produces NaN across charts and is auto-saved over good data. Best done together with §4.2 (the `applyPayload` boundary is where a `sanitizePayload` in `src/lib/` should coerce numerics per section). **Where**: `src/pages/SettingsPage.tsx:~174`, `src/context/FinanceContext.tsx` load + `importAll`.
- **§4.1 Memoize the context value + stabilize actions.** The provider passes a fresh ~110-field object literal every render and none of the ~40 callbacks are memoized, so any state change re-renders every consumer (which then recompute derived series — `BudgetPage` has no `useMemo`). **Fix**: `useMemo` the value, `useCallback` the actions (or one stable actions object), ideally split into settings/data/derived contexts. Highest-leverage frontend perf change but broad and regression-prone. **Where**: `src/context/FinanceContext.tsx` (provider value ~2200+, action defs).
- **§4.3 Unify i18n.** The typed translations table coexists with 145+ ad-hoc `lang === 'nb' ? … : …` ternaries (visible gaps: hardcoded `'estimert'`, always-Norwegian validation errors, Norwegian placeholders). **Fix**: move component copy into the table; rule "`lang` never appears in JSX except locale selection"; consider extracting the ~930-line table to `src/i18n/` (also re-enables Fast Refresh in FinanceContext). **Where**: `FinanceContext.tsx` table, all pages.
- **§4.4 Move page-embedded domain logic to `src/lib/`.** `SalaryPage` inline month math + `salaryAt` (duplicates `calcActiveGrossAnnual`), `DashboardPage` 12-month interpolation. Unlocks unit tests. **Where**: `src/pages/SalaryPage.tsx`, `src/pages/DashboardPage.tsx` → new `src/lib/salary.ts` etc.
- **§4.5 Unify the two charting systems.** `DashboardPage` has 4 bespoke SVG charts + a private `ChartTip` duplicating `ChartTooltip.tsx` and hardcoding hex, while every other page uses Recharts. **Fix**: one token-based chart primitive family, or accept Recharts here too (~400 lines out of DashboardPage). **Where**: `src/pages/DashboardPage.tsx:925-1472`.
- **§1.3 Concurrent-write conflict detection.** Two tabs/devices clobber each other (whole-blob last-write-wins). **Fix (cheapest)**: add a `rev`/`updated_at` to the row; server rejects a POST whose `rev` doesn't match; client refetches + warns. Even refetch-on-`visibilitychange` removes most risk. **Where**: `server/index.js` (schema + POST), `src/context/FinanceContext.tsx` (save/load).
- **§7.2 Self-host fonts + offline read-only data.** Fonts load from Google (fail offline, ping Google on every cold load); `/api/data` is network-only so offline shows the error banner over empty defaults. **Fix**: self-host fonts (Fontsource variable, or `public/fonts` + `@font-face`) so they precache — then the CSP can drop the Google allowlist too; optionally a NetworkFirst runtime cache for `GET /api/data` with an "offline — last synced" banner (keep POSTs network-only). **Where**: `index.html`, `vite.config.ts`, `server/index.js` CSP.
- **§5.5 ESLint depth.** Baseline only — no `recommendedTypeChecked`, no `eslint-plugin-jsx-a11y` (would auto-catch icon-button/label regressions), no formatter/pre-commit hooks. `no-unused-vars` is now configured. **Where**: `eslint.config.js`.
