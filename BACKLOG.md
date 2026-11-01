# Backlog

Known gaps agreed to leave for later. Each entry says what, why it was deferred, what would
unblock it, and where the code lives. When an item is finished, remove it. Shipped history lives
in git and the CHANGELOG, not here.

## Calculations and money figures

- **Wealth tax simplifications.** Single-person bunnfradrag (no spousal doubling), the forecast
  splits financial assets by today's shares-vs-other ratio, and Pengestrøm shows no wealth-tax
  line. Gjeldsreduksjon's gross-asset ratio uses the adjusted `primaryHomeValue`, which overstates
  a co-owned home above the 70 % threshold (needs the market share passed separately). Documented
  in code. **Where**:
  `calcWealthTax` in `src/lib/norwegianTax.ts`, `src/lib/forecastProjection.ts`.
- **Spouses.** Married co-owners get a doubled bunnfradrag and can split rentefradrag freely; the
  app models one person. **Unblock**: an issue covering a marital-status field. **Where**:
  `src/lib/norwegianTax.ts`, `annualMortgageInterest` in `src/context/FinanceContext.tsx` and
  `mcp/derive.ts`.
- **OTP base excludes bonuses.** `otpAnnualContribution` is capped at 12G but uses base + on-call
  only; a real OTP base may include bonuses. **Where**: `src/lib/pension.ts`,
  `src/pages/PensionPage.tsx`.
- **Not audited yet**: bank import and categorisation.

## Income and salary

- **Consultant features.** Commission entries (`CommissionEntry` aggregated in `compByYear`), a
  per-job billing rate with billed-hours snapshots, and a per-job stack in the Total comp chart
  (`compByYear` aggregates globally). **Where**: `src/context/FinanceContext.tsx`,
  `src/pages/SalaryPage.tsx`.
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

- **`deletedBankIds` and `deletedBankTombstones` grow unbounded.** Neither of the obvious prunes is
  safe. Dropping a connection's entries when it is removed would resurrect its deleted rows on a
  re-add, because `startLink` reuses a removed connection's id prefix and the re-add refetches
  `EB_DAYS` of history. An age rule has no fixed bound: a live connection fetches from
  `last_sync - 7d`, which can be arbitrarily old after a long gap (a re-link keeps `last_sync`), and
  `EB_DAYS` is an env var. Legacy `deletedBankIds` entries also carry no date. **Unblock**: a
  persisted per-connection "oldest date any future sync can fetch" on the bank store, then prune
  tombstones (and their ids) older than it. **Where**: `fetchMappedTransactions` / `startLink` /
  `removeConnection` in `server/bank.js`, `deletedBankIds` / `deletedBankTombstones` in
  `src/context/FinanceContext.tsx`.
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

- **`SavingsAllocationPanel` is the one place that writes both `savings` and `fixedExpenses`.**
  Correct, but the likeliest spot for a future regression. **Where**: `createExpenses` in
  `src/components/SavingsAllocationPanel.tsx`.
- **The savings target shrinks as you automate, by construction** (it's a share of the
  uncommitted residual). Surfaced in the panel rather than changed. **Where**:
  `calcRecommendations` in `src/lib/calculations.ts`.
- **The allocation panel's target and the budget's savings target disagree once a paydown row is
  active.** The panel (`sizeAllocation`) leaves the plan's own mortgage/debt paydowns out of
  spending so activating and syncing them can't shift the target; `calcRecommendations` /
  `plannedMonthlySaving` still count them as spending, so the Budget Saving pill, its
  "unallocated" note and the Dashboard read lower. Surfaced with a caption in the panel. **Why
  deferred**: counting a linked paydown as saving in `plannedMonthlySaving` spreads into the
  Dashboard and Forecast projections (which already amortize the loan, so the paydown would count
  twice), the savings-rate chart (`paydownPrincipal`), the pill split and the MCP's own copy in
  `mcp/derive.ts`. **Unblock**: decide whether a plan-linked paydown is saving or spending
  everywhere. **Where**: `src/lib/allocationSync.ts`, `src/lib/calculations.ts`,
  `src/context/FinanceContext.tsx`, `src/components/SmartRecommendations.tsx`,
  `src/pages/DashboardPage.tsx`, `mcp/derive.ts`.
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
- **Provenance is a value-comparison heuristic** (a deliberate value equal to the default shows
  "Default"); a fix needs a `touched` set. Badges could extend to fixed-expense seeds,
  `loan`/`homeowner`/`transition` and `savingsTargetPercent`. **Where**: `src/lib/provenance.ts`.
- **History before debt historization is equity-only**, and history months stored only as a total
  aren't split by co-owner share. Can be hand-corrected in the History manager. **Where**:
  `netWorthSeriesFrom` in `src/lib/netWorth.ts`, `src/lib/ownership.ts`.
- **Scenario bands only on the Forecast chart.** The Assets growth and Dashboard projections are
  stacked, so a band needs a design decision. **Where**: `src/pages/AssetPage.tsx`,
  `src/pages/DashboardPage.tsx`, `src/lib/scenarioBands.ts`.

## Housing

- **Stamps that pay nothing still count as interest-charged.** Creating a paydown expense, resuming
  it from a pause, or changing its destination sets `lastPostedMonth` to the current month without
  paying it, so another expense's catch-up on the same loan pays that month as principal only.
  **Why deferred**: out of scope for the declined catch-up fix (#338). **What would unblock**: record
  those stamped-but-unpaid months in `uncoveredMonths` (as 0) too. **Where**: `src/components/ExpenseDialog.tsx`,
  `src/components/SavingsAllocationPanel.tsx`, `src/lib/allocationSync.ts`, `computeAutomationPostings`
  in `src/lib/automation.ts`.
- **Catch-up order still moves a loan by a few kroner.** With two expenses on one loan, the runner
  amortizes one expense over all its months before the next, so whose principal lands first changes
  the interest that compounds. Answering the catch-up prompts in the other order gives a slightly
  different balance (tens of kroner over a few months), with or without co-owners. **Why deferred**:
  found while fixing the co-owner order gap in #340; closing it needs the runner to step month by
  month across all rules on a loan, a redesign of the #338 interest tracking. **What would unblock**:
  agreeing to rework `computeAutomationPostings` to interleave rules per month. **Where**:
  `computeAutomationPostings` and `applyAmortization` in `src/lib/automation.ts`.
- **Loan modelling.** Annuity only (no serial loans), annual-granularity amortization (no bank
  schedule import), no rate-change history. **Where**: `src/lib/calculations.ts`.
- **Residence history isn't linked to the current home**, and Kjøpe & selge doesn't write the move
  into history. **Where**: `src/context/FinanceContext.tsx`, `src/lib/property.ts`,
  `src/pages/BoligPage.tsx`.
- **Sekundærbolig tax model is simplified** (no Airbnb regime, no owner-occupied rental rule, no
  household formuesskatt, no loss benefit, no botid exemption). **Where**: `src/lib/secondHome.ts`.
- **Market data, phases 2 and 3.** Listing search/compare tools, more filters, watch status, price
  history, Entur transit distance; then market stats and a wait-or-switch Forecast scenario.
  **Unblock**: phase 1 accepted. **Where**: `mcp/tools/market.ts`, `server/market.js`,
  `src/pages/bolig/MarketPanel.tsx`.

## Pension

- **Foreign pension / IRA / 401k** buckets for users who worked abroad.

## Tooling and infrastructure

- **Temporary tap log for the mobile "first tap does nothing" report.** The on-device log showed
  iOS delivering touchstart and touchend but no click. `installTapRecovery` now clicks any button
  or link whose tap got no click, app-wide. Emulation can't make iOS drop a click, so the log stays
  until that is confirmed on the phone. It is turned on in Settings (About card) or with
  `?debugtaps`. **Why deferred**: needs confirmation from the real phone. **Unblock**: the user
  confirms taps work, then delete the component, its mount and the toggle. **Where**:
  `src/components/TapDebugLog.tsx`, `src/lib/tapLog.ts`, `<TapDebugLog />` in
  `src/components/Layout.tsx`, the toggle in the About card of `src/pages/SettingsPage.tsx`.

- **`typescript` 7 is blocked upstream.** `typescript-eslint` peers `typescript <6.1.0`.
  **Unblock**: a release widening it. **Where**: `package.json`.
- **Dev-only audit alerts with no usable fix.** minimatch GHSA-g3hv-75wg-m249 is fixed only in
  11.x, which removes `makeRe` and RegExp entries in `Minimatch.set`; every parent (eslint,
  typescript-eslint, glob 11 via workbox-build, filelist, app-builder-lib, @electron/asar,
  dir-compare) still pins 3.x to 10.x, so an override would break lint and the build. glob
  GHSA-3g3m-2fjr-6pw4 needs glob 14 and workbox-build pins ^11. deepmerge GHSA-gcqx-w48m-w2h4 has no
  patched release (via @rollup/plugin-node-resolve). All are build or lint tooling, never shipped.
  **Unblock**: parent releases that accept minimatch 11 / glob 14, or a deepmerge fix. **Where**:
  `package-lock.json`, `desktop/package-lock.json`.
- **MCP generic `set_field` / `describe_field`.** Needs the default `assets`/`loan`/`pension`/
  `homeowner`/`transition`/`fixedExpenses` constants moved into `src/lib`, and a type check for the
  ~20 weakly guarded registry keys. **Where**: `src/lib/payloadRegistry.ts`,
  `src/context/FinanceContext.tsx`, `mcp/tools/write.ts`.

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
