# Backlog

Items deferred from prior work. When an item is finished, remove it.

## Live SSB wage statistics

`/api/wage-stats` currently returns a curated static series (server/index.js, `WAGE_STATS_STATIC`). Should query SSB table 11418 (or 13606) for live national median annual wage instead.

**What's needed**: the SSB PXweb query for that table requires picking correct `Yrke`, `Sektor`, `Kjønn` dimension codes — these vary by table version and need to be confirmed by inspecting the live metadata at `https://data.ssb.no/api/v0/no/table/11418/`. Once confirmed, add `fetchWageStats(years)` to `server/ssb.js` and call it from the endpoint with a 30-day cache (mirror the `inflation_cache` pattern).

**Where**: `server/ssb.js`, `server/index.js`. The frontend already consumes `/api/wage-stats` and renders a comparison line on the salary timeline.

## Phase 3 — financial insights expansion (deferred)

The POC C restyle and Settings page are shipped; the additional insight features the user asked for are not yet wired to real data. Sparklines on metric tiles currently use synthetic series where real history is sparse.

- **Real sparkline data on metric tiles** — `DashboardPage.tsx` hero uses `netWorthHistory` (real) but the small tiles (Residual / Can Spend / Investment) fall back to synthetic series. Need: monthly residual derived from `monthlyIncomes - totalFixedExpenses` over the last 12 months; daily-burn series from `dailyData`; monthly investment contributions from `monthlyIncomes * (savingsTargetPercent/100)`.
- **Spending-by-category bars** — `BudgetPage` "Fordelingsanalyse" already has a Recharts horizontal bar chart; add MoM delta chips per category by computing the previous month's totals from `dailyTransactions`.
- **Net-worth composition timeline** — `AssetPage` currently has a single net-worth projection chart; add a stacked-area chart of Investment / Property Equity / Crypto / Cash across the months in `netWorthHistory` (history only stores total equity today — needs schema extension to keep per-asset snapshots, OR derive composition retroactively from current ratios — pick).
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
- **Concurrent jobs** — UI currently assumes one active job at a time (the "Total årslønn" tile uses the latest `SalaryEntry`'s job). Investigate moonlighting / overlapping contracts: should `derivedMonthlyIncome` sum across all currently-active jobs?
- **Reassign unassigned entries** — `BonusEntry` / `OvertimeEntry` / `HoursSnapshot` rows from before the `jobId` field render under "Uten jobb" in the All tab. Add a quick bulk-attribute UI (or surface it inline in the entry row) so users can clean these up without opening the edit modal one by one.

## Pension — phase 2

OTP + IPS tracking is shipped (balance, contribution, growth, retirement-readiness tile on Forecast). Remaining pension topics:

- **Folketrygd / NAV state pension** — separate income stream at retirement based on lifetime income, G-multiple, and årskull. Adds a baseline monthly pension on top of OTP/IPS. Needs a simplified inntektsgrunnlag model. **Where**: `src/lib/norwegianTax.ts` (new `calcFolketrygd`), `src/pages/ForecastPage.tsx`.
- **Withdrawal-phase taxation** — currently pension is shown as gross balance. Modeling drawdown tax (IPS as alminnelig 22%, OTP as ordinary wage-equivalent tax bracket) gives an honest "monthly pension net" number. **Where**: `src/lib/norwegianTax.ts`.
- **AFP (Avtalefestet pensjon)** — eligibility-based (LO/NHO members, tenure ≥ 7 years etc.), can boost pension significantly. Defer until folketrygd lands.
- **Foreign pension / IRA / 401k** — multi-currency pension buckets for users who worked abroad.
- **Pension contribution from variable comp** — `otpAnnual` calc currently uses `currentGross + currentOnCall` only. Real OTP base may include bonuses and is capped at 12G (~1.4M). Refine if it becomes inaccurate for high earners.
