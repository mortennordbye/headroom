# Backlog

Known gaps agreed to leave for later. Each entry says what, why it was deferred, what would
unblock it, and where the code lives. When an item is finished, remove it. Shipped history lives
in git and the CHANGELOG, not here.

## Calculations and money figures

- **Dashboard "vs last month" spend chip mixes fixed-expense sources.** `currentMonthSpending`
  reconciles against the viewed month's snapshot fixed expenses (`viewFixedExpenses`) while
  `prevMonthSpending` uses live `fixedExpenses`, so the delta % can count different transactions
  as enveloped. **Unblock**: resolve `prevMonthSpending` against
  `balanceSnapshots[prevMonthKey].fixedExpenses` too. **Where**: `src/context/FinanceContext.tsx`
  (`prevMonthSpending`/`currentMonthSpending`).
- **Mortgage edge cases only reachable with hand-made or old data.** MCP `get_mortgage` treats
  missing sale-cost fields as zero proceeds; the paydown plan can anchor on a stored snapshot whose
  old copy of the balance was a dated 3 000 000 placeholder, shows "months ahead" after a sale, and
  grows when the term is 0. **Why deferred**: the app's own saves never produce these. **Where**:
  `src/lib/paydown.ts`, `src/lib/mortgageSlices.ts`, `mcp/derive.ts` (`activeMortgage`).
- **BSU lifetime room is measured against the balance.** The 300k cap counts deposits, but only the
  balance (with interest) is stored, so the room shown is a floor. **Unblock**: agree a persisted
  "total deposited" field and its backfill. **Where**: `src/lib/bsu.ts`, payload sites in
  `src/context/FinanceContext.tsx`.
- **Wealth tax simplifications.** No gjeldsreduksjon (debt deducted in full), single-person
  bunnfradrag (no spousal doubling), the forecast splits financial assets by today's
  shares-vs-other ratio, and Pengestrøm shows no wealth-tax line. Documented in code. **Where**:
  `calcWealthTax` in `src/lib/norwegianTax.ts`, `src/lib/forecastProjection.ts`.
- **Spouses.** Married co-owners get a doubled bunnfradrag and can split rentefradrag freely; the
  app models one person. **Unblock**: an issue covering a marital-status field. **Where**:
  `src/lib/norwegianTax.ts`, `annualMortgageInterest` in `src/context/FinanceContext.tsx` and
  `mcp/derive.ts`.
- **OTP base excludes bonuses.** `otpAnnualContribution` is capped at 12G but uses base + on-call
  only; a real OTP base may include bonuses. **Where**: `src/lib/pension.ts`,
  `src/pages/PensionPage.tsx`.
- **Not audited yet**: `secondHome.ts`, `forskuddstrekk.ts`, `savingsRate.ts`, `envelopes.ts`,
  bank import and categorisation.

## Income and salary

- **Manual monthly-income override goes stale vs the salary system.** The per-month override never
  re-syncs when salary/tax/IPS change. Wants a "stale override" indicator or re-sync affordance.
  **Where**: `effectiveIncome`/`derivedNetMonthlyFor` in `src/context/FinanceContext.tsx`.
- **Consultant features.** Commission entries (`CommissionEntry` aggregated in `compByYear`), a
  per-job billing rate with billed-hours snapshots, and a per-job stack in the Total comp chart
  (`compByYear` aggregates globally). **Where**: `src/context/FinanceContext.tsx`,
  `src/pages/SalaryPage.tsx`.
- **Bulk-reassign unassigned entries.** Bonus/overtime/hours rows from before `jobId` render under
  "Uten jobb"; there's no bulk-attribute UI. **Where**: `src/pages/SalaryPage.tsx`.
- **2027 withholding tables aren't out yet.** `TREKK_PARAMS` only has 2026. The Trekk tables
  workflow opens a `tier:review` PR once Skatteetaten publishes (usually December). **Unblock**:
  review and merge that PR. **Where**: `.github/workflows/trekk-tables.yml`,
  `scripts/trekk/update-trekk-year.mjs`, `src/lib/forskuddstrekk.ts`.

## Payslip importer

- **More providers.** Visma and Tripletex are supported; another one is a `PayslipParser` pushed onto
  `PROVIDERS`. **Unblock**: a sample PDF. **Where**: `src/lib/payslip/index.ts`.
- **Tripletex leaves fields empty.** No annual salary or position %; holiday pay is derived from YTD
  figures; bonus rows aren't mapped; tabelltrekk and multi-month exports are untested.
  **Unblock**: more samples. **Where**: `src/lib/payslip/parseTripletexPayslip.ts`.
- **Visma line items (on-call / overtime) aren't parsed.** The thousands-space and column separator
  are the same character, so per-column amounts are ambiguous. **Unblock**: parse columns by the
  pdf.js X position (`transform[4]`), then map rows to `OvertimeEntry`/`BonusEntry`. **Where**:
  `src/lib/payslip/parseVismaPayslip.ts`, `src/lib/payslip/extractPdfText.ts`,
  `src/components/PayslipImportModal.tsx`.

## Bank import

- **A row deleted before a re-link can come back.** The first sync after a re-link drops overlap
  rows whose reference changed format by matching them against stored rows (`dropRelinkFormatTwins`).
  A row the user had deleted is no longer stored, and `deletedBankIds` holds its old id, so its
  new-format twin is imported again. **Unblock**: keep date, amount, account and description with
  each deleted id so the re-link match can check against them too. **Where**:
  `dropRelinkFormatTwins` / `mergeTransactions` in `server/bank.js`, `deletedBankIds` in
  `src/context/FinanceContext.tsx`.
- **`deletedBankIds` grows unbounded.** No prune is provably safe without knowing the bank's sync
  window. **Unblock**: a server-side retention rule keyed to that window, or drop ids when their
  connection is removed. **Where**: `src/context/FinanceContext.tsx`, `mergeTransactions` in
  `server/bank.js`.
- **Bank-id dedup regex ambiguity.** A legacy bare id whose ref starts with 8 hex chars + `-` is
  classified as connection-prefixed. **Unblock**: converge the id format, or a secondary key.
  **Where**: `src/lib/bankDedup.ts`, `dropStaleBareTwins` in `server/bank.js`.
- **Bulk re-categorize auto-sourced rows.** A Settings action re-running `categorizeWithRules` over
  rows with `categorySource === 'auto'`. **Unblock**: agree the gate + a confirm step. **Where**:
  `src/pages/SettingsPage.tsx`, `src/lib/categorize.ts`.
- **Heuristics to tune.** The keyword table (`src/lib/categorize.ts`), transfer detection
  (`src/lib/transfers.ts`, could use own-IBAN matching), transfer-suggestion thresholds
  (`src/lib/transferSuggestions.ts`, tuned on one dataset), envelope name hints (`NAME_HINTS` in
  `src/lib/envelopes.ts`). Pending rows with amount drift (tips, forex) aren't matched to their
  booked twin by design.
- **Managed encryption key is co-located** with the data unless `EB_KEY_SECRET` is set
  out-of-band. **Where**: `server/bank.js`.
- **Bank endpoints are unauthenticated** like the rest of the app on a no-auth deploy. **Where**:
  `server/index.js`.
- **Legacy rows are unlabeled.** Transactions imported before multi-account support have no
  `account`/`bank` and can't be back-attributed.

## Budget and savings UI

- **Savings rows are one flat list.** A goal pot, a buffer and an invested position render the same;
  rows show the monthly amount but not the destination balance; the derived-mode caption wraps
  badly in the narrow column. **Where**: `renderSavings` in `src/pages/BudgetPage.tsx`.
- **`SavingsAllocationPanel` is the one place that writes both `savings` and `fixedExpenses`.**
  Correct, but the likeliest spot for a future regression. **Where**: `createExpenses` in
  `src/components/SavingsAllocationPanel.tsx`.
- **Editing an allocation percentage doesn't update the expenses it created.** **Unblock**: agree
  the allocation is authoritative, then a "sync amounts" button. **Where**:
  `src/components/SavingsAllocationPanel.tsx`.
- **The savings target shrinks as you automate, by construction** (it's a share of the
  uncommitted residual). Surfaced in the panel rather than changed. **Where**:
  `calcRecommendations` in `src/lib/calculations.ts`.
- **CashflowChart shows savings transfers as money out** (a literal cashflow view), so it disagrees
  with the savings-rate chart. **Where**: `src/components/charts/CashflowChart.tsx`.
- **Cross-month envelope rollover.** Unused envelope room doesn't carry over. **Where**:
  `src/lib/envelopes.ts`, `src/context/FinanceContext.tsx`.

## Balances, history and provenance

- **No staleness surfacing on user-entered balances.** Derive last-touched from the latest
  `balanceSnapshots` month where the value changed, then an age dimension on `ProvenanceBadge` and a
  monthly reconcile prompt. A "at 7% it would now be ~X, confirm" suggestion belongs here too (growth
  never posts by design). **Where**: `src/lib/provenance.ts`, `src/components/ui/ProvenanceBadge.tsx`,
  `src/lib/snapshots.ts`, `src/components/HistoryManagerModal.tsx`.
- **`notifiedRate` never applies itself** when its month arrives. **Where**: `HomeownerData` in
  `src/context/FinanceContext.tsx`.
- **Provenance is a value-comparison heuristic** (a deliberate value equal to the default shows
  "Default"); a fix needs a `touched` set. Badges could extend to fixed-expense seeds,
  `loan`/`homeowner`/`transition` and `savingsTargetPercent`. **Where**: `src/lib/provenance.ts`.
- **v1 snapshots have no recorded assumptions** and fall back to live ones without a muted "not
  recorded" treatment. **Where**: `src/pages/AssetPage.tsx`, `src/lib/snapshots.ts`.
- **History before debt historization is equity-only**, and history months stored only as a total
  aren't split by co-owner share. Can be hand-corrected in the History manager. **Where**:
  `netWorthSeriesFrom` in `src/lib/netWorth.ts`, `src/lib/ownership.ts`.
- **`recommendedInvestment` on Assets is month-coupled** (derives from the viewed month's income).
  **Where**: `calcRecommendations(effectiveIncome, …)` in `src/context/FinanceContext.tsx`.
- **Scenario bands only on the Forecast chart.** The Assets growth and Dashboard projections are
  stacked, so a band needs a design decision. **Where**: `src/pages/AssetPage.tsx`,
  `src/pages/DashboardPage.tsx`, `src/lib/scenarioBands.ts`.

## Housing

- **Co-owner gaps.** Projections and automation catch-ups use today's loan share past a co-owner's
  `until` (`src/lib/automation.ts`, `src/lib/projectBalances.ts`); buy-and-sell treats the next home
  as the user's alone (`calcTransitionNewLoan`); onboarding doesn't ask the ownership share
  (`src/lib/onboarding.ts`).
- **A declined catch-up counts its skipped months as interest-charged.** Needs per-loan "interest
  charged through" state. **Where**: `computeAutomationPostings` in `src/lib/automation.ts`.
- **MCP server clock vs browser clock** can disagree for a few hours at month end. **Where**:
  `currentMonthKey` in `src/lib/date.ts`, `mcp/derive.ts`.
- **Loan modelling.** Annuity only (no serial loans), annual-granularity amortization (no bank
  schedule import), no rate-change history. **Where**: `src/lib/calculations.ts`.
- **Residence history isn't linked to the current home**, and Kjøpe & selge doesn't write the move
  into history. **Where**: `src/context/FinanceContext.tsx`, `src/lib/property.ts`,
  `src/pages/BoligPage.tsx`.
- **Loan-page overrides don't persist across reloads** (page-local, like Employer cost).
  **Where**: `src/pages/BoligPage.tsx`.
- **Sekundærbolig tax model is simplified** (no Airbnb regime, no owner-occupied rental rule, no
  household formuesskatt, no loss benefit, no botid exemption). **Where**: `src/lib/secondHome.ts`.
- **Market data, phases 2 and 3.** Listing search/compare tools, more filters, watch status, price
  history, Entur transit distance; then market stats and a wait-or-switch Forecast scenario.
  **Unblock**: phase 1 accepted. **Where**: `mcp/tools/market.ts`, `server/market.js`,
  `src/pages/bolig/MarketPanel.tsx`.

## Pension

- **Foreign pension / IRA / 401k** buckets for users who worked abroad.

## Tooling and infrastructure

- **Stricter lint presets.** No `recommendedTypeChecked` for the TypeScript and no `jsx-a11y`.
  **Why deferred**: out of scope for #142, which only brought `server/` and `desktop/` under the
  recommended rules. **Where**: `eslint.config.js`.
- **`typescript` 7 is blocked upstream.** `typescript-eslint` peers `typescript <6.1.0`.
  **Unblock**: a release widening it. **Where**: `package.json`.
- **Revision-history prune scans every snapshot on each save** (~70-120 ms at the 200 MB cap, not
  reachable at today's size). **Unblock**: a `bytes` column filled at insert. **Where**:
  `server/index.js` (`historyPruneBytesStmt`, `historyListStmt`, `recordHistory`).
- **MCP generic `set_field` / `describe_field`.** Needs the default `assets`/`loan`/`pension`/
  `homeowner`/`transition`/`fixedExpenses` constants moved into `src/lib`, and a type check for the
  ~20 weakly guarded registry keys. **Where**: `src/lib/payloadRegistry.ts`,
  `src/context/FinanceContext.tsx`, `mcp/tools/write.ts`.
- **Public demo shares one rate-limit bucket.** **Unblock**: per-IP keying when `DEMO_MODE` is on,
  with `trust proxy` scoped to the gateway. **Where**: `server/index.js` (`globalKey`,
  `apiLimiter`). A stale SW predating `DEMO_MODE` would boot the old client; only matters if the
  demo URL is repointed.
- **SPA fallback 404s under a dot-directory.** `res.sendFile(path.join(DIST, 'index.html'))` is
  refused by `send`'s dotfile rule when the install path has a `.`-prefixed segment (a checkout in
  `.claude/worktrees`), so every client route 404s; Docker and CI paths are fine. The e2e setup
  works around it by running the server from a temp copy. **Why deferred**: test-only PR, no server
  changes. **Unblock**: `res.sendFile('index.html', { root: DIST })`, then drop the copy in
  `e2e/global-setup.ts`. **Where**: `server/index.js` (SPA fallback), `e2e/global-setup.ts`.

## Desktop app

- **Windows signing is wired but off** until the SignPath Foundation application is approved and the
  secrets are set. **Where**: `.github/workflows/desktop-build.yml`, `desktop/README.md`.
- **macOS is unsigned** until there's an Apple Developer account. **Where**:
  `desktop/electron-builder.yml`, `desktop/build/entitlements.mac.plist`.
- **The update check only notifies.** Self-install needs both platforms signed. **Where**:
  `desktop/update.js`, `desktop/main.js`.
- **Bank linking is untested in the desktop app.** The callback lands in the system browser and
  breaks if the port moves off 3737. **Unblock**: a `headroom://` protocol handler. **Where**:
  `desktop/main.js`, `server/bank.js`.
