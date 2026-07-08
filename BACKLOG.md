# Backlog

Items deferred from prior work. When an item is finished, remove it.

## Payslip importer — follow-ups

Shipped (2026-07): client-side Visma payslip import on the Budget page. PDFs are parsed entirely in-browser (pdf.js, lazy-loaded) and never stored; a single-month PDF opens a detailed editable review, a multi-page archive opens a batch list that fills income history back in time. Per-month figures live in `payslips: Record<month, MonthlyPayslip>` (`src/context/FinanceContext.tsx`), and net pay is written as that month's income override. Parser + tests in `src/lib/payslip/` (`parseVismaPayslip.ts`, `parsePayslipAmount.ts`, provider registry in `index.ts`); browser extraction/render in `extractPdfText.ts`; UI in `src/components/PayslipImportModal.tsx` + `src/pages/BudgetPage.tsx`. Remaining:

- **Only Visma is supported.** The provider registry (`src/lib/payslip/index.ts`, `parsePayslip` iterating `PARSERS`) is built to take more formats, but only `parseVismaPayslip` exists. Adding another payroll provider = write a `PayslipParser` (returns `null` when it doesn't recognise the text) and push it onto `PARSERS`. **Unblock**: a sample PDF from the new provider to build a fixture from (tests inline the extracted text lines, never the binary).
- **Line items (on-call / overtime) aren't parsed into their own entries.** The Visma parser deliberately drops the pay-line table (Fastlønn / On-Call / Feriepenger rows) because the thousands-space and column-separator are the same character, making per-column amounts ambiguous (e.g. `On-Call ... 24/7 108,00` mis-bridges to `7 108,00`). Only the headline figures (gross/net/tax/base/holiday) are extracted. **What would unblock**: column parsing anchored on the payslip's fixed X positions (available from pdf.js `transform[4]`) instead of regex over the joined line, then map rows to `OvertimeEntry`/`BonusEntry`. **Where**: `src/lib/payslip/parseVismaPayslip.ts` (extraction), `src/lib/payslip/extractPdfText.ts` (would need to preserve per-item X), `src/components/PayslipImportModal.tsx` (write mapping).

## Time/data-model rethink — follow-ups

Shipped (2026-07): the contextual month picker, provenance badges, editable net-worth history, monthly balance snapshots, and the balance-page time machine are all done. Details: contextual picker (interactive only on `/` and `/overview`; static "as of today" marker elsewhere; hidden on `/settings` — `MONTH_SCOPED_ROUTES` / `HIDE_TIME_MARKER_ROUTES` in `src/components/Layout.tsx`); `ProvenanceBadge` Default/Yours/Estimate (`src/lib/provenance.ts`, `src/components/ui/ProvenanceBadge.tsx`) on high-impact assumptions across Assets/Settings/Pension/Employer Cost + a Dashboard "defaults nudge"; `setNetWorthForMonth`/`clearNetWorthForMonth` + `NetWorthHistoryModal` (`src/components/NetWorthHistoryModal.tsx`); `BalanceSnapshot` + `balanceSnapshots` auto-captured for the current calendar month and persisted/exported/imported; `useBalanceHistory` (`src/hooks/useBalanceHistory.ts`) + `BalanceHistoryBar` (`src/components/BalanceHistoryBar.tsx`) making Assets/Loan/Pension render read-only history, with shared equity math in `src/lib/equity.ts`. Demo data (`src/lib/demoData.ts`) seeds 6 months of snapshots so demo mode showcases it.

Remaining:

- **Deepen the time machine.** (a) Stepper state is per-page (each balance page defaults to live) — consider lifting it so the selected month carries across Assets/Loan/Pension. (b) `AssetPage` projections in history mode still use the *live* `mortgageRate`/`mortgageTermYears`/`recommendedInvestment` (forward assumptions, not snapshotted). (c) `PensionPage` history shows snapshot pension balances but live `salaries`/`jobs` (contributions aren't snapshotted). (d) Let users hand-enter historical breakdowns to backfill months from before they used the app.
- **Extend provenance badges to the remaining defaults** — fixed-expense seeds, whole `loan`/`homeowner`/`transition` objects, `savingsTargetPercent`. Consider a first-run setup flow that converts defaults into explicit choices, reusing `provenanceOf`.

Known limitations:
- **History recorded before debt historization (2026-07) is equity-based.** `netWorthHistory` values and `BalanceSnapshot`s captured before debts were snapshotted hold asset equity (no `debts` field), and the missing debt history can't be reconstructed. Those months render equity-only in the Dashboard chart and the Assets time machine; values self-correct as new months are recorded, or can be hand-corrected via the net-worth history editor.
- **Provenance is a value-comparison heuristic** (`provenanceOf` in `src/lib/provenance.ts`): a user who deliberately sets a value equal to the default sees "Default". A true fix needs explicit provenance tracking in state (a `touched` set). The Dashboard "defaults nudge" count (`defaultAssumptions` in `src/pages/DashboardPage.tsx`) inherits the same heuristic.
- **AssetPage growth RateChips are unbadged** — the compact chips at `src/pages/AssetPage.tsx:394-397` (which open the same editor as Settings) were left without badges to avoid clutter; the canonical badged surface for growth rates is Settings.
- **`recommendedInvestment` on Assets is silently month-coupled** — it derives from `effectiveIncome` (month-scoped), so with the picker hidden on `/assets` the value still reflects whatever month was last selected on Budget/Dashboard. **Where**: `calcRecommendations(effectiveIncome, …)` at `src/context/FinanceContext.tsx:1654`, consumed in `src/pages/AssetPage.tsx`.
- **Net-worth history editor covers a rolling 12-month window** matching the Dashboard chart. Editing months older than 12 back isn't exposed.

## Cross-page value syncing — follow-ups

Shipped (2026-07): the Loan page's first-buyer Låneevne inputs now auto-fill from the app's
real data with a per-field manual override (the Employer-cost pattern) — `arslonn` ←
`grossAnnualIncome` (Salary), `eksisterendeGjeld` ← `totalDebt` (Debts), `egenkapital` ←
liquid assets (`bsu + savings + bufferAccount + netInvestment`). Each shows an Auto/Overstyrt
chip and a reset-to-auto control; overrides are page-local (reset on reload, like
EmployerCost), and history (read-only) views fall back to the month's stored `loan` snapshot.
The current home's value/mortgage are now hard-mirrored across `assets` ↔ `homeowner` ↔
`transition` in `updateAsset`/`updateHomeowner`/`updateTransition` (previously only
assets↔homeowner, only in homeowner mode). Code: `src/pages/LoanPage.tsx`,
`src/context/FinanceContext.tsx`. Remaining:

- **`skattefradragssats` (interest tax-deduction %) is still duplicated** — an editable copy
  lives in both `loan` and `homeowner` (both default 22%), but it's a policy constant, not a
  per-loan choice. Promote to one shared source (a Settings value or a `TAX_PARAMS` constant)
  so the two can't diverge. Deferred because it's a persisted-shape change (touches
  `LoanData`/`HomeownerData`, defaults, sanitize, export/import, demo). **Where**:
  `src/context/FinanceContext.tsx` (`DEFAULT_LOAN`/`DEFAULT_HOMEOWNER`), `src/pages/LoanPage.tsx`.
- **Loan-input overrides don't persist across reloads** — matches EmployerCost, and is fine
  for a what-if calculator, but if we later want a "sticky" manual salary/debt on the Loan
  page it needs a persisted `number | null` override model (or a `touched` set) rather than
  the page-local `useState`.

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
  - **Transfer netting is Budget-scoped** — the Dashboard spend charts (`InsightBanner`,
    `CashflowChart`) still count transfers. Extend if it matters.
  - **Transfer detection is a heuristic** — a genuine same-amount expense+income within 3 days on
    two accounts could be wrongly netted. Mitigated by the ambiguity skip and by keeping the rows
    visible (marked) in the ledger. Stronger signals (own-IBAN match / transfer keywords) would
    tighten it. **Where**: `src/lib/transfers.ts`.
  - **Legacy rows are unlabeled.** Transactions imported before Tier 1 have no `account`/`bank`,
    so they show no badge and fall outside every account group (can't be back-attributed). New
    syncs tag correctly; this only affects pre-upgrade rows.

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

Most of `AUDIT.md` is done (see its "Progress log"). These remaining entries are larger refactors, several touching the persistence backbone — deferred because they can't be safely exercised against the user's real data volume without a throwaway `DATA_DIR` and careful diffing.

- **§4.1 Memoize the context value + stabilize actions — DONE (2026-07).** All ~40 actions are now `useCallback`-stabilized; the provider is split into three memoized contexts — `FinanceSettingsContext` / `FinanceDataContext` / `FinanceDerivedContext` — with `useFinanceSettings`/`useFinanceData`/`useFinanceDerived` hooks and a memoized `useFinance()` shim (`{...settings,...data,...derived}`) for backward compat. `Layout` migrated to `useFinanceSettings()` (settings-only → no re-render on data edits). `demoMode`/`toggleDemoMode` live in Settings (demo actions read `buildPayload`/`currentMonth` via refs to stay stable). **Not migrated**: `BudgetPage`/`DashboardPage` genuinely read all three slices, so the shim is already optimal for them — splitting their destructures would be churn with no re-render reduction. Migrating any *future* single-slice-heavy component to a granular hook is the way to extend the win.
- **§4.3 Unify i18n — DONE (2026-07).** The ~1.3k-line table is extracted to `src/i18n/translations.ts` (with `Language`/`Translations` types); FinanceContext imports it. All in-JSX `lang === 'nb' ? … : …` copy ternaries (~150 sites across 8 pages + 8 components) are migrated into table keys: shared `common`/`validation` namespaces plus per-page `dashboardPage`/`salaryPage`/`pensionPage`/`forecastPage`/`assetPage`/`loanPage`/`budgetPage`/`employerCostPage` namespaces. Rich-JSX heroes (`<em>`/`<br>`) and mid-string interpolations were split into keys preserving exact output; verified byte-identical in Docker across Dashboard/Asset/Salary/Loan (0 console errors). **Intentionally left**: `lang` for locale selection only — `Intl.NumberFormat`/`toLocaleString`, date-fns `dateLocale`, the language-toggle active state, and the pure-lib `formatMonths(months, lang)` in `src/lib/debt.ts` (not JSX; would need a lib→i18n dependency to change).
- **§4.4 Move page-embedded domain logic to `src/lib/` — DONE (2026-07).** `SalaryPage`'s month-key helpers moved to `src/lib/date.ts` (`monthKeyFromDate`/`addMonthsKey`/`monthsBetween`/`yearOf`); `salaryAt`/`hoursAt` to new `src/lib/salary.ts`; `DashboardPage`'s 12-month net-worth interpolation to new `src/lib/netWorth.ts` (`buildNetWorthSeries`). `ForecastPage`'s two duplicated "current salary" blocks now reuse `salaryAt`. New tests: `date.test.ts` (10), `salary.test.ts` (6), `netWorth.test.ts` (5). Verified byte-identical rendering on Dashboard/Salary/Forecast (0 console errors). **Note**: `calcActiveGrossAnnual` stays in `FinanceContext.tsx` — it's a different (multi-job-sum) already-extracted exported function, not page-embedded.
- **§4.5 Unify the two charting systems — DONE (2026-07).** `DashboardPage`'s 4 bespoke SVG charts (`HeroChart`, `BurnRateChart`, `MonthlyInvestmentBars`, `ProjectionChart`) are now Recharts (`AreaChart`/`BarChart` with `ReferenceLine`/`ReferenceDot`/`Cell`), sharing the common `ChartTooltip` and `CHART` tokens; the private `ChartTip` and the `smoothPath` helper are gone. Trade-off accepted: the old charts used `preserveAspectRatio="none"` (edge-to-edge stretch) + HTML overlays for crisp round dots, which Recharts' true-aspect `ResponsiveContainer` doesn't reproduce, so proportions shifted slightly; the per-hover "estimert" tooltip sub-caption dropped (the hollow/dashed dot & bar still signal estimated). Visually verified in Docker (0 console errors).
- **§7.2 Self-host fonts + offline read-only data — fonts DONE (2026-07); offline data PENDING a decision.** Fonts are now self-hosted via Fontsource (`src/fonts.ts` imports the `latin` subset at the exact weights: Cormorant 400/500/600 + italic 400/500, IBM Plex Mono 400/500/600, Inter 400/500/600/700). The Google `<link>`s are gone from `index.html`, the CSP dropped `fonts.googleapis.com`/`fonts.gstatic.com` (`styleSrc`/`fontSrc` now `'self'` only), and `woff2` was added to the PWA precache glob (12 files precached). Verified in Docker: fonts render identically, zero requests to Google, 0 console/CSP errors. **Offline-data caching declined (2026-07)**: a NetworkFirst cache for `GET /api/data` was considered and deliberately NOT added — it would persist the full financial blob in the browser's Cache Storage (data-at-rest), which isn't worth it for a single-user loopback app. `/api/data` stays network-only; offline shows the existing load-failed state. Revisit only if a real offline-read need arises.
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
