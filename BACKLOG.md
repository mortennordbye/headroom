# Backlog

Known gaps agreed to leave for later. Each entry says what, why it was deferred, what would
unblock it, and where the code lives. When an item is finished, remove it. Shipped history lives
in git and the CHANGELOG, not here.

## Calculations and money figures

- **Wealth tax simplifications.** Single-person bunnfradrag (no spousal doubling), the forecast
  splits financial assets by today's shares-vs-other ratio, and Pengestrøm shows no wealth-tax
  line. Documented in code. **Where**:
  `calcWealthTax` in `src/lib/norwegianTax.ts`, `src/lib/forecastProjection.ts`.
- **Spouses.** Married co-owners get a doubled bunnfradrag and can split rentefradrag freely; the
  app models one person. **Unblock**: an issue covering a marital-status field. **Where**:
  `src/lib/norwegianTax.ts`, `annualMortgageInterest` in `src/context/FinanceContext.tsx` and
  `mcp/derive.ts`.
- **Deferred studielån with a linked expense.** While `interestFreeUntil` is in the future, the
  projections hold a student loan flat, but the paydown automation has no notion of deferment and
  posts a linked expense's payment into it every month, so the Assets balance falls while the
  projection doesn't. Predates the linked-payment projection fix and was left out to keep that
  change small. **Unblock**: decide which side is right (voluntary payments during deferment are
  allowed, so likely the projection should pay a linked expense from month 0 while the minimum
  still waits). **Where**: `simulatePayoff` in `src/lib/debt.ts`, `AutomationState.debts` and the
  debt paydown in `src/lib/automation.ts`.
- **Projections ignore an extra mortgage paydown.** A plan-linked paydown now counts as saving
  and is kept out of the cash a projection saves, because the projection is meant to amortize the
  loan with it. Debts do (`withLinkedPayments`), but the mortgage is still projected at its
  scheduled annuity from today's balance, so the extra principal shows up only as the real
  balance falls month by month. Predates the paydown-as-saving change, which made it a little
  more visible (that cash share is now part of the paydown). **Unblock**: let the mortgage
  projection take the linked paydown expenses as extra monthly principal, the way
  `withLinkedPayments` does for debts. **Where**: `calcHouseEquityByYear` /
  `calcMortgageBalanceByYear` in `src/lib/calculations.ts`, `forecastMortgage` in
  `src/lib/forecastProjection.ts`, `src/pages/DashboardPage.tsx`, `src/pages/ForecastPage.tsx`,
  `src/pages/AssetPage.tsx`, `forecast` in `mcp/derive.ts`.
- **OTP base, remaining gaps.** Bonuses are now a per-user setting, but the rest of the base is
  fixed: overtime is always left out (it counts under innskuddspensjonsloven § 5-5 første ledd
  unless the plan excludes it), on-call is always counted, the § 5-5 annet ledd bokstav b
  variant (last year's pay as the base) is not modelled, and bonuses are summed across all jobs
  instead of only the scheme's employer. Deferred to keep the bonus fix small. **Unblock**: an
  issue deciding which plan options to expose (likely one "counts overtime" setting and a job
  link for the scheme). **Where**: `otpPensionableIncome` and `otpBonusShareToDate` in
  `src/lib/pension.ts`, `src/lib/pensionAccrual.ts`, `src/pages/PensionPage.tsx`,
  `pensionSummary` in `mcp/derive.ts`.
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

- **Heuristics to tune.** The keyword table (`src/lib/categorize.ts`), transfer detection
  (`src/lib/transfers.ts`), transfer-suggestion thresholds
  (`src/lib/transferSuggestions.ts`, tuned on one dataset), envelope name hints (`NAME_HINTS` in
  `src/lib/envelopes.ts`). Pending rows with amount drift (tips, forex) aren't matched to their
  booked twin by design.
- **Managed encryption key is co-located** with the data unless `EB_KEY_SECRET` is set
  out-of-band. **Where**: `server/bank.js`.
- **Bank endpoints are unauthenticated** like the rest of the app on a no-auth deploy. **Where**:
  `server/index.js`.
- **Legacy rows are unlabeled.** Transactions imported before multi-account support have no
  `account`/`bank` and can't be back-attributed. Likewise, rows synced before account numbers
  were captured have no `accountNumber`/`counterpartyAccountNumber`, so own-account transfer
  matching only covers rows the bank returns again (sync window). **Unblock**: a one-off full
  re-fetch within the bank's history limit. **Where**: `server/bank.js` (`fetchMappedTransactions`
  window), `src/lib/transfers.ts`.
- **The amount matcher can still net a loan or card payment.** Own-account matching skips loan
  and card accounts, but the older equal-amount pairing in `findInternalTransferIds` doesn't know
  account types, so an unambiguous checking-to-loan payment with both legs synced is netted as a
  transfer instead of counting as debt service. **Why deferred**: rows carry no account type, only
  the server's account list does. **Unblock**: stamp the account type (or a "debt account" flag)
  on rows at sync and exclude those legs from pairing. **Where**: `src/lib/transfers.ts`,
  `server/bank.js` (`fetchMappedTransactions`, `ownAccountNumber`).
- **An auto-matched transfer can't be un-marked.** `segment: 'transfer'` only adds rows to the
  transfer set; there is no override that takes a row the matcher netted back into spending.
  **Why deferred**: needs a new segment value (or flag) plus UI. **Unblock**: an explicit
  "not a transfer" override honoured by `excludedTransferIds`. **Where**: `src/lib/transferRules.ts`,
  `src/lib/segments.ts`, `src/pages/BudgetPage.tsx`.

## Budget and savings UI

- **`SavingsAllocationPanel` is the one place that writes both `savings` and `fixedExpenses`.**
  Correct, but the likeliest spot for a future regression. **Where**: `createExpenses` in
  `src/components/SavingsAllocationPanel.tsx`.
- **The savings target shrinks as you automate, by construction** (it's a share of the
  uncommitted residual). Surfaced in the panel rather than changed. **Where**:
  `calcRecommendations` in `src/lib/calculations.ts`.
- **The cashflow chart and Year review still count a plan paydown as an expense.** A paydown the
  savings allocation set up is saving everywhere the month is split into saving and spending
  (`planPaydownTotal`), but `monthlyCashflow` takes each month's whole fixed-expense total as
  expenses and only the savings transfers as `saved`, so these two views still show it under
  expenses. **Why deferred**: a parallel change is reworking that cashflow code, and touching it
  here would collide. **Unblock**: move each month's plan paydown out of the fixed total and into
  the month's savings (`cashflowSavingsForMonth`), with that month's fixed expenses, allocations
  and debts.
  **Where**: `src/lib/monthlyCashflow.ts`, `src/components/charts/CashflowChart.tsx`,
  `src/pages/YearReviewPage.tsx`, `src/lib/yearReview.ts`, `perMonthFixed` and `budgetSummary`
  in `mcp/derive.ts`.
- **Some one-legged savings transfers are still counted twice in the cashflow.** The cashflow
  and year review match a planned saving to its imported outgoing row only when the payee after
  "Til:" is the saving's name (`savingsMatch.ts`), so a real purchase can never vanish. Accepted
  misses, where the old double count stays: the transfer drifts more than 1 % from the plan; a
  saving is split over several transfers, or several savings go out as one; the transfer lands in
  another month; a 'rest' or percent saving resolved from estimated income differs from what was
  sent; the destination text isn't the saving's name. **Why deferred**: matching on text any
  looser lets bill payments (every nettgiro and avtalegiro has "til:" and an account number)
  claim a saving. **Unblock**: store an account number on each saving and compare it with the
  row's `counterpartyAccountNumber` (captured since #358); that match needs no name or amount
  heuristics. **Where**: `src/lib/savingsMatch.ts`, `src/context/FinanceContext.tsx` (`Saving`),
  `src/lib/transfers.ts` (`normalizeAccountNumber`).
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

## Housing

- **A declined or short catch-up can still make prompt order move a loan by tens of kroner.** Full
  catch-ups now give the same balance in any order. When an earlier prompt was declined (or paid
  less than the interest), the months it left uncharged come before months it did charge, and the
  later prompt charges them on today's balance, which already holds the earlier prompt's later
  payments, instead of on the balance in that month. **Why deferred**: the runner keeps only the
  current balance, so the balance in a past month isn't known. **What would unblock**: a per-loan
  balance by month (or the payment history) the runner can rewind to. **Where**:
  `computeAutomationPostings` in `src/lib/automation.ts`.
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
