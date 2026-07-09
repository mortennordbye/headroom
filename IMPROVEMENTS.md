# Headroom, maths & value-population audit (2026-07-07)

> **Status (2026-07-09): effectively complete.** Every 🔴/🟡 finding and all of sections
> 1–4, 6 and 8 are ✅ FINISHED. Sections 5.6/5.7 were re-verified against `main` and closed
> out. Genuinely remaining, all intentional: `deletedBankIds` pruning (§5.7, BACKLOG-tracked
> as provably unsafe), the bank twin-dedup shims (§5.6/§7, kept until the blob converges), the
> `SalaryPage.trailingHourly` extraction (§5.1, do when next touched), and §8.8 (won't-do).

Full pass over how every number is computed and how values flow into charts, tables and tiles,
motivated by the app being shared (friends now self-host their own instances, each
single-user). Covered:
all of `src/lib/` plus tests, all pages, all chart/section components, `FinanceContext.tsx`,
and the server (`index.js`, `bank.js`, `seed.js`, `ssb.js`).

This follows up `AUDIT.md` (2026-07-04, closed out). Items already tracked in `BACKLOG.md`
are cross-referenced, not re-opened, except where this audit changes their urgency or
resolves their open question. The HIGH findings below were spot-verified against the code
before publishing.

Severity: 🔴 high (a wrong number is shown to the user, or data is at risk) ·
🟡 medium (edge-case wrong value, crash, or drift risk) · 🟢 low (hygiene, tests, style) ·
✅ FINISHED (fixed on main, commit in parentheses).

Each item is written to be self-contained: file and line refs, the failing scenario, and the
intended fix, so any item can be picked up fresh without this document's history. Line
numbers are as of commit 4813878. For every fix, the repo gate applies:
`npx tsc -b && npm run lint && npm test`, plus `make build` and a browser smoke test for
UI-visible changes (mind the service-worker cache gotcha in CLAUDE.md). Pure-math fixes
should land together with a unit test in the same `src/lib/*.test.ts`.

---

## 1. Wrong numbers on screen (fix first)

**1.1 ✅ FINISHED (09cedf5) Trygdeavgift rate is the 2024 value; every take-home figure is overstated.**
`TAX_PARAMS[2025].trygdeavgiftRate` is `0.078`, but the 2025 statutory rate on wage income
is 7.7% (cut 0.1pp in the 2025 budget). Every other 2025 constant in the table checks out
(personfradrag 108 550, minstefradrag 46%/92 000, all trinnskatt brackets). This resolves
the open question in `BACKLOG.md` ("Math-correctness audit, deferred findings"): the answer
is 7.7. At a 744 000 gross the shown tax is 744 kr/yr too high, flowing into net monthly,
effective rate, budget income, and the forecast.
Fix: `trygdeavgiftRate: 0.077` in `src/lib/norwegianTax.ts:32`.

**1.2 ✅ FINISHED (09cedf5) No 2026 tax year exists, and it is July 2026.**
`TAX_YEAR = 2025` with no `TAX_PARAMS[2026]` entry, so all salary numbers are computed on
last year's brackets. Meanwhile `src/lib/employerCost.ts` claims 2026 correctness in its
header, so the two libs disagree about which year the app models.
Fix: add `TAX_PARAMS[2026]` (trygdeavgift, personfradrag and trinnskatt all changed) and
bump `TAX_YEAR`. Consider deriving the default year from the current date so this can't
silently go stale again.

**1.3 ✅ FINISHED (1af9356; residual asymmetry closed 2026-07-08) Dashboard "vs last month" spending chip compares incompatible quantities.**
*(Re-verified 2026-07-08: 1af9356 fixed the previous-month side but the chip's current-month
side still came from `dailyData` built on the raw month transactions, so an internal
transfer's expense leg counted this month and not last month. Closed by adding
`currentMonthSpending` — `discretionarySpendForMonth` over `nonTransferTransactions`, same
call as `prevMonthSpending` — and pointing `spendingDelta` at it; `totalSpent` for the
Budget-Health bar is unchanged.)*
`spendingDelta` (`src/pages/DashboardPage.tsx:91`) compares this month's discretionary
spend against `prevMonthSpending` from `FinanceContext.tsx:1167-1171`, which sums *all*
transactions for the previous month: income deposits included, internal transfers included,
envelope-covered spend included. For any bank-synced user a salary deposit inflates "last
month's spending", so the chip percentage is wrong essentially always.
Fix: compute the previous month with the same pipeline as the current month (exclude
income/transfers, use discretionary), via one shared helper in `src/lib/`.

**1.4 ✅ FINISHED (1af9356) Loan page "Totalpris" contradicts the row above it.**
`totalpris = loan.betingetLaan + effEgenkapital` (`src/pages/LoanPage.tsx:207`), where
`effEgenkapital` is the auto-derived Låneevne equity, but the same card's "Egenkapital" row
shows `loan.egenkapital` and the note says "Betinget lån + egenkapital". With
finansieringsbevis equity 500k and derived liquid equity 800k, the card's own rows don't sum
to its total. Fix: `loan.betingetLaan + loan.egenkapital`.

**1.5 ✅ FINISHED (1af9356, test mock in ddcb039) CashflowChart counts internal transfers as expenses.**
`src/components/charts/CashflowChart.tsx:20` uses raw `dailyTransactions` while its sibling
`SavingsRateChart.tsx:18` deliberately uses `nonTransferTransactions`. Moving money between
your own accounts inflates "money out" and the two charts on the same page disagree.
Already noted as deferred in `BACKLOG.md` ("Transfer netting is Budget-scoped"); elevating
because with multi-account bank sync it now corrupts the dashboard for real users.
Fix: switch `CashflowChart` (and `InsightBanner`) to `nonTransferTransactions`.

**1.6 ✅ FINISHED (1af9356) Raise calculator misparses Norwegian numbers as tiny values.**
`NextReviewCard` (`src/pages/SalaryPage.tsx:1503-1506`) hand-rolls parsing with `parseFloat`
instead of the imported `parseLocaleNumber`. Input `"600.000"` parses as 600 and the card
confidently shows a −99.9% raise. Fix: use `parseLocaleNumber` (returns NaN, which already
renders as an em dash).

**1.7 ✅ FINISHED (1af9356) Fun budget card is dead for bank-synced users.**
`src/components/FunBudget.tsx:32-42` matches a fixed expense literally named "fun"/"moro"
and transactions whose category string equals those words. Canonical categories use
`entertainment` (`src/lib/categories.ts`), so `funSpent` is permanently 0 with categorized
data, and the Norwegian magic string violates the app-must-be-generic rule.
Fix: drive it from a canonical category or an envelope link, not name matching.

**1.8 ✅ FINISHED (0c3921e) Onboarding writes savings into a dead field; the money never appears anywhere.**
The "cash" onboarding topic defines `{ key: 'savings', writer: 'asset' }`
(`src/lib/onboarding.ts:113`) and `OnboardingTour.tsx:286` executes it as
`updateAsset('savings', n)`, the legacy scalar. But `sumSavings` (`src/lib/equity.ts:17`)
takes the array branch whenever `savingsAccounts` is an array, which it always is: fresh
users get `DEFAULT_ASSETS.savingsAccounts: []`, and `migrateSavingsAccounts`
(`FinanceContext.tsx:699-718`, called at :876) only absorbs the scalar when the array is
*absent*, not when it's empty. Net effect: a friend doing first-run setup types their
savings and it never shows in net worth, the Assets page, or the Dashboard cash tile; it is
only visible inside the onboarding field itself. Fix: make the onboarding writer create a
savings account (`addSavingsAccount`), or make `migrateSavingsAccounts` also absorb a
nonzero scalar when the array is empty. Highest priority given onboarding is the current
project goal.

---

## 2. Data safety & persistence

**2.1 ✅ FINISHED (1af9356) Imported backups can put string "numbers" into the maths.**
`sanitizePayload` (`src/lib/sanitizePayload.ts`) coerces top-level scalars, five schema
objects and three number-records, but never descends into `fixedExpenses[].amount`,
`dailyTransactions[].amount`, or `debts[].balance/rate/minPayment`. A hand-edited backup
with `"amount": "5 000"` passes the Settings import check and the server's shape validation,
then `totalFixedExpenses` string-concatenates and NaN/garbage flows through `monthlyBudget`,
`dailyBudget` and every chart, and gets autosaved over good data. This is the repo's own
stated highest-risk bug class. Fix: coerce the numeric fields of those three arrays (and
`balanceSnapshots` nested numbers, see 4.6).

**2.2 ✅ FINISHED (fdd75db) Disconnecting and reconnecting a bank duplicates up to 90 days of transactions.**
`startLink` (`server/bank.js:400-419`) only reuses a connection id if the ASPSP connection
still exists; after `removeConnection` a re-add mints a new UUID, a new `eb-<conn8>-` id
prefix and a null `last_sync`, so the full 90-day history re-imports under new ids.
`mergeTransactions` keys by id and `dropStaleBareTwins` intentionally never merges across
prefixed connections, so all spending double-counts until the user finds the historical-
accounts delete button. Fix: on re-add of an ASPSP that has orphaned rows, reuse the old
prefix (or dedupe by `(entry_reference, aspsp)` at merge time).

**2.3 ✅ FINISHED (1f7b670) The id-format dedup (commit 4813878) never converges server-side.**
`applyPayload` drops bare twins via raw `setDailyTransactions` without recording the dropped
ids in `deletedBankIds`. On the next autosave the server's `reconcileBankTransactions`
(`server/index.js:177-199`) sees stored `eb-` rows missing from the payload and re-adds
them, every save, forever (the UI stays clean because every read path re-dedupes, but the
stored blob keeps the dupes and client/server ping-pong on each save). Fix: record dropped
bare ids into `deletedBankIds` in `applyPayload`, or run `dropStaleBareTwins` in the POST
handler after reconcile.

**2.4 ✅ FINISHED (d034a9c) "Delete all data" keeps payslips.**
`resetAll` (`src/context/FinanceContext.tsx:1696-1751`) resets every domain field except
`payslips`; imported gross/net/tax figures survive a full wipe and are re-persisted by the
next autosave. Fix: `setPayslips({})`.

**2.5 ✅ FINISHED (b2fb174) Demo mode leaks real data.**
(a) `getDemoData` (`src/lib/demoData.ts`) omits `accountLabels`, `categoryRules`,
`labelRules`, `employerCostConfig`, `billingConfig`, despite its own "must set EVERY field
that can hold personal data" contract; real merchant rules and billing rates render during a
demo. (b) Bank sync isn't gated on demo mode: "Sync now" during a demo pulls the full real
ledger into the visible demo state (`BankSyncCard.tsx:199-221`). Disk data stays safe in
both cases; this is a display leak, which is exactly what demo mode exists to prevent.
Fix: set the missing fields to empty defaults in the demo payload; hide or disable the bank
card while `demoMode`.

**2.6 ✅ FINISHED (8abbe85) Server-side wipe protection misses three user-authored fields.**
`preserveUserFields` (`server/index.js:206-224`) guards `accountLabels` and `categoryRules`
against a payload from an older client, but not `labelRules`, `categoryBudgets` or
`deletedBankIds` (whose omission resurrects deleted bank rows). Given the PWA stale-SW
gotcha, an old cached build posting once is a realistic scenario. Fix: add the three fields.

**2.7 ✅ FINISHED (6424e10) Identical same-day transactions can merge into one row.**
The `stableId` fallback for feeds without `entry_reference` (`server/bank.js:284-288`) is
`date|indicator|amount|desc[0..24]`; two genuinely distinct 49 kr purchases at the same
merchant on the same day collide and spending undercounts. Fix: add an occurrence counter
within the mapped batch.

---

## 3. Same user, several open clients (two tabs, or laptop + phone PWA)

Each install is single-user (every friend self-hosts their own instance), so there is no
shared-instance scenario to defend. What remains is one person's own instance open in more
than one place at once: a second browser tab, or the laptop plus the installed phone PWA.
The optimistic-concurrency rev system is sound on the main path (verified), but two gaps
remain where last-write-wins can silently eat that user's own edits:

**3.1 ✅ FINISHED (03fe6c8) The pagehide beacon flush bypasses rev checking.**
(The related LOW — the beacon can't read a response, so `revRef` stays one behind and the
return-to-tab reload shows a spurious "data reloaded" banner — remains open.)
`sendBeacon` can't set the `X-Data-Rev` header, so the server treats the flush as a legacy
client and takes last-write-wins (`FinanceContext.tsx:1105-1113`, `server/index.js:234-241`).
Close the laptop tab within the debounce window and its beacon clobbers what the phone (or
another tab) wrote in between. Fix: carry the rev inside the JSON body (`_rev`) and honor it
server-side as a header fallback. Related: the beacon also doesn't update `revRef`, causing
a spurious "data reloaded" banner on return (LOW).

**3.2 ✅ FINISHED (2a54ab8) Merely opening the app dirties the data, making 409 conflicts frequent.**
(Fixed at both layers: the snapshot effects skip structurally-equal rewrites, and
doSave/the beacon skip the POST entirely when the payload matches the last content the
server is known to hold — the snapshot fix alone wouldn't have stopped the on-load save,
since the autosave effect fires after any `applyPayload`. Merge-on-409 left as-is: with
no-op saves gone, a 409 only fires on genuine concurrent edits.)
The net-worth snapshot and balance snapshot effects (`FinanceContext.tsx:1403-1423`) rewrite
the current-month entries on every load, triggering a POST with no user action. Combined
with the 409 handler adopting the server version wholesale (discarding local unsaved edits
with only a banner), opening the app in a second tab or on the phone can eat an in-flight
edit in the first. Fix: skip the snapshot writes when the value is deep-equal to what's
stored; consider merging rather than discarding on 409.

---

## 4. Consistency between numbers on different surfaces

**4.1 ✅ FINISHED (cee8c5d) Dashboard hero: headline vs chart/chip track different quantities.**
(Fixed via the BACKLOG debt-historization item: `netWorthHistory` now records `netWorth`,
the live chart anchor is `netWorth`, and `calcNetWorthProjectionByBucket` nets a projected
`debtByYear` so both growth projections start at true net worth. History recorded before
the change is equity-based and can't be reconstructed — documented in `BACKLOG.md`.)
The headline shows `netWorth` (equity − debt) but the MoM chip, 12-month change and hero
chart are built from `netWorthHistory`, which snapshots `totalEquity`
(`FinanceContext.tsx:1418`, `DashboardPage.tsx:343,354-356`). With any non-mortgage debt the
chip tracks a larger number than the figure it sits next to. Root cause is already tracked
in `BACKLOG.md` ("Debts aren't historized or projected"); doing that item fixes this.

**4.2 ✅ FINISHED (6505631) Debt-to-income tile prints a debt figure that doesn't match its ratio.**
The ratio uses `houseDebt + totalDebt`; the sub-line prints only `houseDebt`
(`DashboardPage.tsx:95,797`). Fix: print the same sum the ratio uses.

**4.3 ✅ FINISHED (2e6ec70) Dashboard investment bars are built from the manual-override map only.**
`investmentBars` (`DashboardPage.tsx:164-189`) derives its 12 months from
`Object.keys(monthlyIncomes)`, dropping months whose income is salary-derived, so the bars
can be non-contiguous months rendered as contiguous, with "projected" bars extending from a
stale month. The context's `incomeSeries` (`FinanceContext.tsx:1216-1224`) already builds
the correct fixed 12-month grid with `monthlyIncomes[m] ?? derivedNetMonthlyFor(m)`
fallback; build the bars on that.

**4.4 ✅ FINISHED (2e6ec70) Budget Health legend mixes denominators.**
"Remaining budget" pairs a kr value computed after the savings slice with a percentage
computed before it, and `spentPct` is clamped so overspend months understate the spent share
(`DashboardPage.tsx:86-88,513-521`). Fix: one definition for both the kr and % of each
legend item, unclamped (or explicitly marked when clamped).

**4.5 ✅ FINISHED (cee8c5d) Assets time machine mixes past assets with today's debt.**
(Fixed the long-term way: `BalanceSnapshot` now carries `debts`, AssetPage history mode uses
the viewed month's debts — pre-change snapshots render equity-only, matching what history
recorded then — and the live debt editor is hidden while time-travelling.)
`AssetPage.tsx:90-93` uses live `totalDebt` (and a fully-live `EquityCompositionBar`) even
when rendering a historical snapshot; LoanPage gates on `hist.isLive` correctly. Fix: gate
like LoanPage; long-term, snapshotting debts (the BACKLOG item in 4.1) makes history honest.

**4.6 ✅ FINISHED (616837c) Old balance snapshots can render NaN in the composition chart.**
`computeEquityBreakdown` does no field guarding and
`NetWorthCompositionChart.tsx:22` feeds it raw `balanceSnapshots[key]?.assets`; a snapshot
saved before a field existed (`cryptoUnrealizedGain`, `bufferAccount`, ...) yields
`undefined * n → NaN` in the bar. `sanitizePayload` also skips snapshot internals (see 2.1).
Fix: `?? 0` each field inside `computeEquityBreakdown`; cheapest, covers all callers.

**4.7 ✅ FINISHED (e2a27bf) Salary YoY tiles fabricate "+0.0%" with short history.**
With fewer than 13 months of data, `yoy` returns zeros instead of null, so a new user sees a
confident flat salary-vs-inflation comparison (`SalaryPage.tsx:164-181,762-786`). Fix:
return null and render the em dash like the other tiles.

**4.8 ✅ FINISHED (e2a27bf) Future-dated salary entries leak into "current" figures.**
`currentJob` and the on-call sub-line take the last entry of `sortedSalaries` even when its
`effectiveDate` is months ahead, while the headline uses `salaryAt` clamped to today
(`SalaryPage.tsx:696-699,267-269`); the Next-review card baselines against the future raise.
Fix: use `salaryAt(currentMonthKey, ...)` for all three.

**4.9 ✅ FINISHED (178ccef) Sankey fabricates 1 kr flows.**
`Math.max(1, ...)` on every link (`MoneyFlowSankey.tsx:74-78`) renders flows for genuinely
zero buckets and unbalances in vs out by rounding. Fix: drop zero links; round the remainder
bucket last.

**4.10 ✅ FINISHED (2e6ec70) Two definitions of "spent this month" ship simultaneously.**
Budget's ledger uses `day.spent` (envelope-covered included, `BudgetPage.tsx:402`),
Dashboard uses `discretionary` (`DashboardPage.tsx:80`). Each is defensible in place, but
the same phrase shows different numbers on two pages, and the Budget ledger footer renders
`totalSpentThisMonth` in a row labeled as surplus (`BudgetPage.tsx:963-974`, the label has
colSpan 2 and the cell sits under the "Impact" column). Fix: one shared, documented helper
in `src/lib/`; fix the footer label/cell pairing.

**4.11 ✅ FINISHED (2e6ec70) Asset-allocation percentages use inconsistent denominators.**
Row percentages divide by unclamped `totalEquity` while rows clamp to ≥0 (can sum past
100%), and the strip uses a different denominator than the rows
(`DashboardPage.tsx:560,578`). Fix: one clamped denominator for both.

---

## 5. Legacy & hacky code to clean up

**5.1 🟡 Inline financial maths that belongs in `src/lib/` with tests.** (mostly closed in 7e4d8b9)
- ✅ FINISHED (7e4d8b9) Pension projection compounding duplicated in `PensionPage.tsx`
  (iterative) and `ForecastPage.tsx` (closed form). Extracted to `src/lib/pension.ts`
  (`pensionFutureValue` + `projectPensionWealth`, tested); both pages consume it.
- ✅ FINISHED (7e4d8b9) `ForecastPage.tsx` re-implemented the annuity formula annually; now
  `annualMortgagePayment = 12 × calcMonthlyPayment(...)`, matching the Loan page.
- ✅ FINISHED (7e4d8b9) `LoanPage.tsx` re-implemented year-one interest and computed a
  `totalInterest` that went negative at `nedbetalingstid = 0`. Both now derive from
  `calcAmortizationSchedule` (year-one = `schedule[0].interestPaid`, total = sum of
  `interestPaid`), so a 0-term loan reports 0 interest.
- ✅ FINISHED (7e4d8b9) `DashboardPage` `1.02 ** i` / `max * 0.85` are now the named
  `PROJECTED_INCOME_GROWTH` / `INCOME_TARGET_SHARE` constants.
- ✅ FINISHED (7e4d8b9) the `hoursAt` `jobId` leak — a snapshot assigned to one job no longer
  leaks into another job's hourly maths (unassigned snapshots stay global); `WEEKS_PER_MONTH`
  and the per-month `nominalHourlyRate` moved to `src/lib/salary.ts` with tests.
- 🟢 Residual: `SalaryPage.tsx` `trailingHourly` (trailing-12 hourly incl. bonus/overtime/
  on-call) is still an inline page-level aggregation. Extract to a tested lib helper when it
  next needs touching; it composes `series` + `bonuses` + `overtime`, so it's page-shaped
  rather than a shared formula.

**5.2 ✅ FINISHED (e7747e8) `parseFloat` where `parseLocaleNumber` is mandated.**
Beyond 1.6: `PensionPage.tsx:303`, `EmployerCostPage.tsx:108,186,280`,
`SettingsPage.tsx:268,321-327`, `SmartRecommendations.tsx:41,114`,
`NetWorthHistoryModal.tsx:43`. Mostly `type="number"` inputs so browsers usually sanitize,
but Firefox passes `"1,5"` through and it commits as 1. One sweep fixes the class.

**5.3 ✅ FINISHED (2ebc757) Hardcoded Norwegian copy despite the i18n migration.**
(All sites below moved into `src/i18n/translations.ts`; DashboardPage 'MMM' now uses the
date-fns locale. Verified in the browser in both languages.)
Largest offender is `LoanPage.tsx` (first-buyer/homeowner sections at lines 334, 337-364,
375-398, 406-446, 469-599: "Låneevne", "Kostnad på lån", the whole rate-comparison
paragraph, seller/buyer flow labels; also "Nedbetalt av opprinnelig lån" at :539 and the
"Nå" label at `ForecastPage.tsx:338`). All strings belong in
`src/i18n/translations.ts` under the existing `loanPage`/`forecastPage` namespaces. Also
`BudgetPage.tsx:203-364` validation strings (`' må være et positivt tall'` concatenated onto
translated labels, so English users get mixed-language errors) and placeholders;
`SalaryPage.tsx` unit suffixes (`t/uke`, `KPI`) plus English-only `Inflation gap`;
`PensionPage`/`EmployerCostPage` unit suffixes; untranslated aria-labels in
`BalanceHistoryBar`; hardcoded "Cancel" in `SettingsPage.tsx:732`; `DashboardPage`
`'MMM'` formatting without a date-fns locale (English month names in the Norwegian UI,
BudgetPage does it right).

**5.4 ✅ FINISHED Hardcoded personal/vendor data (app-must-be-generic).**
- ✅ FINISHED (8c1264e) `server/bank.js:10`: a real Enable Banking APP_ID UUID as the code
  default; EB_APP_ID is now required config (deploys relying on the old default must set it).
- ✅ FINISHED (f10480d, via 7.2) `server/bank.js:164`: `resolveAspsp` falls back to
  `/norwegian/i` (a specific bank).
- ✅ FINISHED (5268a8f, via 7.3) `server/seed.js`: real employer names (Telenor, Cognite),
  Norwegian display-string categories (`'Mat'`) that bypass the canonical `CategoryKey`
  system, a dead `laanetype` field, and an `INSERT OR REPLACE` that resets `rev` to 0 on an
  already-migrated DB.
- ✅ FINISHED (8c1264e) `PayslipImportModal.tsx:169,236`: literal "Visma" badge instead of
  the provider-registry name.

**5.5 ✅ FINISHED (a7c76e8, via 8.3) Hardcoded hex colours outside `chartColors.ts`.**
(SVG contexts now use CHART.* via the 8.3 prop blocks; CSS contexts use theme vars. Left:
ConfirmModal's bespoke `#9c4632` danger hover (no token) and the recurring
`rgba(255,255,255,0.0x)` backgrounds, which need a new token rather than a swap.)
SVG contexts that should use the `CHART.*` mirror: `SalaryPage` (axis `#5F6555`, grid
`#262A20`, comp-chart gradient hexes), `PensionPage.tsx:147-166`,
`ForecastPage.tsx:237-268`, `DebtSection.tsx`, `BudgetDistributionChart.tsx` (local copies
of CHART values). CSS contexts where `var()` would already work: `FunBudget`,
`GoalsSection.tsx:195`, `EditModal`, `NetWorthHistoryModal`, `CategoryBreakdown.tsx:29`,
`DashboardPage.tsx:566` `#0E1310`, plus recurring `rgba(255,255,255,0.0x)` backgrounds.

**5.6 🟢 Duplication worth one extraction each.** (all closed except the two shims below)
- ✅ FINISHED (verified on main 2026-07-09) Match haystack: `categorize.ts` and `labelRules.ts`
  now share `buildMatchHaystack` (`src/lib/text.ts`). `envelopes.ts` keeps a distinct
  single-name padded haystack (matches a fixed-expense name, not a merchant+description tx),
  which is a different input, not the same code.
- Twin-dedup logic maintained twice: `src/lib/bankDedup.ts` (TS) and `server/bank.js`
  (`dropStaleBareTwins`, CJS); the regexes must stay byte-equivalent. **Kept by design** —
  the retirement plan (§7) shrinks this only after 2.3 converges the stored blob. The `BARE`
  misclassification is tracked in `BACKLOG.md` as provably unsafe to disambiguate.
- ✅ FINISHED (verified on main 2026-07-09) "Latest salary ≤ month" selection: `calcActiveGrossAnnual`
  (`FinanceContext.tsx`) now calls the shared `salaryAt` (`src/lib/salary.ts`).
- ✅ FINISHED (verified on main 2026-07-09) The shared cases are extracted to
  `src/components/ui/` (`NumberRow`, `SummaryTile`, `SliderRow`, used by Pension/EmployerCost)
  and `formatAxisInt` to `src/lib/format.ts` (all pages import it). The remaining page-local
  `SummaryTile`s (ForecastPage now-vs-then, LoanPage value+accent, SalaryPage value+sub+chip)
  are genuinely different prop shapes — see §8.8: a shared slot would be a bigger abstraction
  than the duplication it removes.
- ✅ FINISHED (verified on main 2026-07-09) `BudgetPage` consumes the context `totalFixedExpenses`
  memo and the shared `incomeDiffPct` (`src/lib/income.ts`, also used by DashboardPage).

**5.7 🟢 Small hygiene items.** (four fixed in f43420f; the rest verified done on
2026-07-09 — only `deletedBankIds`, BACKLOG-tracked as unsafe to prune, remains open)
- ✅ FINISHED (f43420f) `debt.ts:30-39` `amortize` reports the 600-month cap as
  `months=600, feasible=false` while `planPayoff` uses `Infinity`. Mirrored, incl.
  `perDebt[].payoffMonth`.
- ✅ FINISHED (verified on main 2026-07-09) `validators.ts` `isPositiveNumber` renamed
  `isNonNegativeNumber` (name now matches the accepts-0 behavior); the `parseLocaleNumber`
  vs `coerceNumber` split is documented as deliberate in `validators.ts:35-40`.
- ✅ FINISHED (verified on main 2026-07-09) `calculations.ts` `HomeownerStatus.equityPercent`
  renamed `originalLoanRepaidPercent`, with a comment noting it is not home equity.
- ✅ FINISHED (f43420f) `ForecastPage.tsx:141` leftover `void jobs;` removed.
- ✅ FINISHED (verified on main 2026-07-09) `SettingsPage.tsx` currency inputs now resync via
  `useEffect` on `nokToUsd`/`customCurrencyCode`/`customCurrencyRate` (lines 105-109), so a
  JSON import or demo toggle updates the fields.
- ✅ FINISHED (verified on main 2026-07-09) `currentMonthKey()` moved out of `useMemo` into
  render scope in all three pages (`PensionPage.tsx:40`, `ForecastPage.tsx:24`,
  `EmployerCostPage.tsx:30`), each with a comment on the month-rollover rationale and `today`
  in the dependent memos' dep arrays.
- `deletedBankIds` grows unboundedly (`FinanceContext.tsx`); still open, but tracked in
  `BACKLOG.md` where it is documented as provably unsafe to prune (a dropped id absent from
  the blob would let the server's reconcile resurrect the deleted row).
- ✅ FINISHED (f43420f) `resetAll` re-hardcodes `37.84/22/5/7/67`; now uses
  `DEFAULT_ASSETS`/`DEFAULT_PENSION` (loan/homeowner/transition keep zero literals — their
  DEFAULT_* constants hold non-zero example values, wrong for a wipe).
- `server/bank.js` — ✅ FINISHED (f43420f) session/pending/config JSON writes are now
  atomic (tmp+rename). ✅ FINISHED (86864fe) `mapEBTransaction` now rejects a row with no
  usable date (was storing `date:''`, invisible to month filters and undeletable) and infers
  direction from the amount sign when `credit_debit_indicator` is absent (was recording
  refunds as positive expenses); both covered in `src/lib/bank.test.ts`.

---

## 6. Test gaps

- ✅ FINISHED (27b426e) `employerCost.ts`: zero tests for user-facing money maths
  (AGA-on-combined-base, margin clamp). Locked in.
- ✅ FINISHED (09cedf5) `norwegianTax.test.ts` has no golden-value test; every assertion is
  structural, which is exactly why the wrong trygdeavgift rate (1.1) passes green. Add one
  exact-total assertion per tax year against Skatteetaten's calculator.
- ✅ FINISHED (27b426e) `calculations.ts`: `calcNetSaleProceeds`, `calcBridgeLoanCost`,
  `calcHomeownerMortgageStatus` (incl. its fallback branch), `calcNetWorthProjectionByBucket`
  are untested but rendered on Loan/Forecast.
- 🟢 Anything extracted under 5.1 gets tests as part of the extraction.

---

## 7. Legacy & compat shims: inventory and retirement plan

Every backward-compat shim in the codebase, with a verdict. "Keep forever" means the shim
guards the import path, and old JSON backups in the wild never expire. All verified against
source; `lang === 'nb'` was swept repo-wide and only the documented locale-selection
carve-outs remain (Intl/date-fns locale, the Settings toggle, `formatMonths` in `debt.ts`),
so the i18n migration needs no further work.

| Shim | Serves | Verdict |
|---|---|---|
| `Assets.savings` scalar + `migrateSavingsAccounts` (`FinanceContext.tsx:141,699-718`) | pre-savingsAccounts blobs | needs migration (7.1) |
| `sumSavings` scalar fallback (`equity.ts:16-21`) | old `balanceSnapshots` stored verbatim | keep until 7.1 migrates snapshots |
| bare-vs-prefixed bank-id dedup, TS + CJS twins (`bankDedup.ts`, `bank.js:338-362`) | single-connection-era ids | keep; shrink after 2.3 converges the blob |
| `reconcileBankTransactions` anti-clobber (`server/index.js:171-199`) | stale tab open during cron sync | keep (load-bearing), but see 2.3 |
| `preserveUserFields` (`server/index.js:206-224`) | pre-accountLabels cached clients | extend to all user-authored fields or retire (2.6); half-covered is the worst state |
| single-session → `connections[]` migration (`bank.js:204-231`) | pre-multi-bank `eb-session.json` | needs write-back migration (7.2) |
| `resolveAspsp` `/norwegian/i` default (`bank.js:162-167`) | legacy connection with `aspsp: null` | retire via 7.2 |
| plaintext-PEM read path (`bank.js:91`) | keys stored before at-rest encryption | ✅ FINISHED (75af71e) re-encrypts in place on first read |
| `rev` ALTER migration (`server/index.js:97-99`) | pre-rev volumes (also fresh DBs) | keep, negligible |
| no-`X-Data-Rev` → last-write-wins (`server/index.js:233-235`) | commented "legacy clients" | ✅ FINISHED (03fe6c8) beacon now carries `_rev`, comment fixed; the no-rev path is genuinely legacy-only |
| `onboardingCompleted` absent → `true` (`FinanceContext.tsx:885-887`) | pre-tour blobs | keep forever |
| `income` static scalar + fallbacks (`FinanceContext.tsx:740,1174-1204`) | non-salary-tracker users | keep (documented fallback); the 55000 default is a Norwegian magic number for fresh installs |
| `FixedExpense.type?`, `DailyTransaction` optional fields | manual/old rows | keep forever (absence is first-class for manual rows) |
| free-text category folding to `'other'` (`categoryStats.ts:74-95`) + hash-color fallback (`BudgetPage.tsx:100-110`) | pre-taxonomy labels | keep tolerance; fix the source (7.3) |
| `useFinance()` merged shim (`FinanceContext.tsx:1973-1981`) | pre-slice-split consumers | keep (declared design) |
| `GoalSource 'savings'` alongside `'savingsAccount'` (`FinanceContext.tsx:304`, `GoalsSection.tsx:15,74`) | old goals | keep (still offered as "total savings") |

**7.1 ✅ FINISHED (d826219) Retire the `savings` scalar with a one-time load migration.**
`migrateSavingsAccounts` already migrates scalar → a `'Sparekonto'` account but never clears
the scalar, and `buildPayload` re-persists it forever; it also never touches
`balanceSnapshots[*].assets` (stored verbatim, `applyPayload` `FinanceContext.tsx:867`),
which is why `sumSavings` needs its fallback. Migration: in `applyPayload`, run each
snapshot's assets through `migrateSavingsAccounts` and zero the live scalar; the client
re-saves the whole blob after load, so the migration self-persists with no server machinery.
Afterwards `savings?: number` remains only as an import-time input, and `DEFAULT_ASSETS`,
`resetAll`, demo data drop it. Do 1.8 first or together (same field).

**7.2 ✅ FINISHED (f10480d) Write back the migrated bank store and drop the hardcoded bank default.**
`readStore` (`bank.js:204-231`) migrates the legacy single-session shape in memory only;
disk keeps the old shape until an unrelated write, and the migrated connection has
`aspsp: null`, which (a) makes `BankSyncCard.tsx:329` re-link fall through to the
`/norwegian/i` default in `resolveAspsp`, and (b) makes `startLink`'s ASPSP match
(`bank.js:404`) miss, so re-linking that bank via the picker mints a new prefixed
connection, recreating the exact duplication the dedup shim cleans up. Fix: on startup, if
`readStore` migrated, `writeStore` immediately and backfill `aspsp` (from its rows' `bank`
field or by requiring one re-link); then delete the migration branch and the `/norwegian/i`
default (also satisfies the no-hardcoded-bank rule, see 5.4).

**7.3 ✅ FINISHED (5268a8f) `server/seed.js` mints fresh legacy-shaped data on every `make seed`.**
The seed emits the oldest shape end-to-end: free-text categories (`'Mat'`, `'Kaffe'`) that
the backfill effect deliberately preserves (`FinanceContext.tsx:1149` keeps any non-`other`
label, so they render via the legacy hash-color path forever), rows without `kind`,
`fixedExpenses` without `type`, scalar `savings` with no `savingsAccounts`, a `laanetype`
field that isn't in `LoanData`, real employer names, and an `INSERT OR REPLACE (id,
content)` that resets `rev` to 0 on an existing volume (forcing 409/adopt in open tabs).
A friend's first impression exercises the oldest code path in the app. Fix: regenerate the
seed to the current payload shape with canonical `CategoryKey`s and a rev-aware write.

**Retirement order:** 1.8 → 7.3 → 2.3 (server-side twin convergence, then shrink
`bankDedup.ts` to import-time only) → 7.2 → 7.1 → 2.6 (extend or retire
`preserveUserFields`) → opportunistic PEM re-encrypt + comment fix on the no-rev path.

---

## 8. Duplication to consolidate (second pass)

Ranked by payoff. Items already listed in 5.1/5.6 are not repeated here.

**8.1 ✅ FINISHED (377b632) One modal scaffold for four hand-rolled modals; a11y drift already happened.**
(`ui/ModalShell` owns portal/overlay/trap/dialog-semantics/header with icon, describedBy,
initialFocus and footer slots; all four modals rewritten on it, NetWorthHistoryModal gaining
the missing trap + role. The payslip lightbox keeps its own portal/trap.)
`EditModal.tsx:51-73,157-170`, `ConfirmModal.tsx:22-39,40-55`,
`PayslipImportModal.tsx:287-329`, `NetWorthHistoryModal.tsx:54-69,134-144` all hand-roll the
identical stack: portal → overlay `fixed inset-0 bg-black/60 z-50 ...` with
backdrop-click-close → panel with the same card classes → header row + X → byte-identical
cancel/primary footer button class strings. The drift: the first three use `useFocusTrap` +
`role="dialog"` + `aria-modal`; NetWorthHistoryModal has none of them (only a hand-rolled
Escape listener at :34-38). Fix: `ui/ModalShell` (title, onClose, children, footer slots)
wrapping portal/overlay/trap/header; bodies stay bespoke. ~70-90 lines saved and every
future modal (onboarding is growing) inherits correct behavior.

**8.2 ✅ FINISHED (966530a) DashboardPage reimplements the tested `categoryMoM`.**
`DashboardPage.tsx:192-218` (`categoryDeltas`) inlines the same current-vs-previous-month
per-category math as `categoryMoM` (`src/lib/categoryStats.ts:43-60`, unit-tested, already
used by `CategoryBreakdown.tsx:23`), including the same pct formula. Side issue: it
localizes the missing-category bucket at aggregation time (`t.dashboardPage.other` instead
of the `'other'` key), making the bucket language-dependent data. Fix: call `categoryMoM`
then filter/slice/map in the page; localize at render.

**8.3 ✅ FINISHED (a7c76e8) Recharts axis/grid prop block copy-pasted ~26 times, with a token/hex fork.**
(`AXIS_PROPS`/`AXIS_PROPS_Y`/`GRID_PROPS` exported and spread everywhere; page charts
converged on the token design. Also fixed en-route: month labels in the five self-labelling
chart components now follow the date-fns locale.)
`tick={{ fontSize: 11, fill: ... }} axisLine={false} tickLine={false}` (plus the YAxis and
`CartesianGrid strokeDasharray="3 3"` twins) appears in `CashflowChart.tsx:39-41`,
`SavingsRateChart.tsx:37-39`, `CategoryTrendChart.tsx:38-40`,
`NetWorthCompositionChart.tsx:52-54`, `LtvChart.tsx:39-41`, `DebtPayoffChart.tsx:68-70`
(all using `CHART.*` tokens) and in `DebtSection.tsx:187-189`, `ForecastPage.tsx:237-239,
266-268`, `SalaryPage.tsx:854-856,942-944,1038-1040,1078+`, AssetPage, PensionPage (same
blocks with hardcoded `#262A20`/`#5F6555`, the old hex twins of the same tokens). Fix:
export `AXIS_PROPS` / `AXIS_PROPS_Y` / `GRID_PROPS` from `src/lib/chartColors.ts` (already
imported everywhere) and spread them; this also closes most of 5.5's SVG-context hex list.

**8.4 ✅ FINISHED (f0d620a) FinanceContext CRUD triple × 7 entities.**
(`makeCrud<T>(setter, prefix)` → `{ add, update, remove }` at module level; jobs, salaries,
bonuses, overtime, hoursSnapshots, goals each bind it once via `useMemo` for stable action
identity, and savingsAccounts reuses it through a setAssets adapter. `add` always returns the
id; `removeJob`'s salary cascade and `addSavingsAccount`'s `(name, balance)` signature are
preserved. ~65 lines → ~30.)
`FinanceContext.tsx:1518-1582` (jobs, salaries, bonuses, overtime, hoursSnapshots, goals)
plus savingsAccounts at :1442-1459 repeat the identical add/update/remove shape
(`[...prev, {...entry, id: makeId(pfx)}]` / `map(x => x.id === id ? {...x, ...patch} : x)` /
`filter(x => x.id !== id)`). Only variations: `addJob`/`addSalary` return the id (make the
factory always return it) and `removeJob` cascades salary deletion (compose it). Fix: a
~12-line `makeCrud<T>(setter, idPrefix)` in the same file; ~65 lines → ~20.

**8.5 ✅ FINISHED (1ffc78f) CashflowChart and SavingsRateChart duplicate a 12-month money series builder.**
(Extracted `monthlyCashflow()` + the `isSpend(tx)` spend predicate into
`src/lib/monthlyCashflow.ts` with tests, and `lastNMonthKeys(anchor, n)` into
`src/lib/date.ts`; the two charts, `CategoryTrendChart`, `MonthlyAccountSpend`,
`DashboardPage`'s net-worth grid and `FinanceContext.incomeSeries` all use them now. Output
is byte-identical to before.)
`CashflowChart.tsx:23-34` vs `SavingsRateChart.tsx:21-32`: same
`Array.from({length:12})`/`subMonths` grid, same `monthlyIncomes[key] ??
Math.round(effectiveIncome)` fallback, same `tx.date.startsWith(key) && tx.kind !==
'income'` spend filter; they differ only in transaction source (raw vs
`nonTransferTransactions`, which is finding 1.5) and the final expression. Fix: one tested
helper in `src/lib/` next to `monthlySpend.ts`; this puts the app's "what counts as spend"
predicate (currently inlined 4+ times plus `envelopes.ts:124`) under test. Add
`lastNMonthKeys(anchor, n)` to `src/lib/date.ts` while at it; the "last N month keys"
expression has 5+ copies (`MonthlyAccountSpend.tsx:15`, `CategoryTrendChart.tsx:19`,
`DashboardPage.tsx:117-118`, both charts above, variants in `InsightBanner.tsx:17` and
`FinanceContext.tsx:1219`).

**8.6 ✅ FINISHED (9c142c4) Ten hand-rolled progress bars with inconsistent clamping.**
(Eleven sites by ship time — CategoryBreakdown and SmartRecommendations had grown bars too.
`ui/ProgressBar` clamps to [0,100] and renders NaN/Infinity as 0; segmented bars left as-is.)
`BudgetPage.tsx:82-84`, `CategoryBudgets.tsx:96-100`, `GoalsSection.tsx:200-206`,
`FunBudget.tsx:73-78`, `LoanPage.tsx:527-531,543-547`, `DashboardPage.tsx:663-664,818-822`,
`OnboardingTour.tsx:215-216`. Differences are height, track token, and clamping: some
`Math.min(100, ...)`, some pre-clamped, some rely on the caller (the NaN/overflow-in-render
class CLAUDE.md warns about). Fix: `ui/ProgressBar` (pct, color, height?, clamps
internally). The segmented bars (`EquityCompositionBar`, `LiquidLockedBar`) are a different
shape; leave them.

**8.7 ✅ FINISHED (1d0a4bd) Signed-percent formatter inlined ~12 times.**
`` `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` `` exists as local `fmtPct`
(`SalaryPage.tsx:1518`) and inline at `SalaryPage.tsx:762,769,776-777,990,993,1213`,
`DashboardPage.tsx:331,421,446,496` (abs variant at :261). Fix: `formatSignedPct(v, digits
= 1)` in a new `src/lib/format.ts`; makes null → em-dash handling consistent.

**8.8 ✅ WON'T DO (decision recorded 2026-07-08) Editable label/value row triplicated.**
*(Beyond the wrapper classes the rows share almost nothing — LoanRow carries its own
highlight/calculated colour logic + notes, SavingsAccountRow uses real buttons for a11y —
so a slot component would be a bigger abstraction than the duplication it removes.)*
`AssetPage.tsx:598-621` (AssetRow), `:624-673` (SavingsAccountRow),
`LoanPage.tsx:871-917` (LoanRow): same wrapper classes, same hover-reveal `Edit2` icon,
same alignment spacer; they differ only in trailing extras (notes/reset, trash, icon).
Fix: one `ui/EditableRow` with slots.

**8.9 ✅ FINISHED (92c8809) Server boilerplate in `server/index.js`.**
(`readBlob(id)` centralizes the `getStmt.get` + `JSON.parse` from `/api/data`,
`reconcileBankTransactions`, `preserveUserFields` and `/api/bank/sync`, guarding the parse
that was unguarded in the last — a corrupt blob now 409s the sync instead of 500-crashing.
`/api/data` POST keeps `getStmt`: it needs only the rev. `bankRoute(status, handler)` removes
the identical try/catch from the five uniform bank routes; the callback redirect and sync's
`needsRelink` 409 stay bespoke.)
Blob read (`getStmt.get('headroom')` + `JSON.parse`) repeated at :177-185, :206-214, and
:388-390 (the last one, in `/api/bank/sync`, has an unguarded parse); extract `readBlob()`.
Seven bank routes repeat the same try/catch-to-status wrapper (:317-414); a tiny handler
wrapper removes it.

**8.10 ✅ FINISHED (b6f157d) A declarative payload-field registry.**
The single source is now `src/lib/payloadRegistry.ts` (`makePayloadRegistry` → one
`{group, demo, read, default}` spec per field). `applyPayload` collapsed to a registry
loop, `buildPayload` is projected through `derivePayload`, and the registry / setter map /
built payload are all typed over `PersistedKey`, so a newly-added `ExportPayload` field now
FAILS TO COMPILE until it is registered everywhere — killing the drift class behind
2.4/2.5/2.6. `migrateSavingsAccounts`/`migrateSnapshotSavings`/`makeId` moved to
`src/lib/savingsMigration.ts` so the registry stays React-free. `getDemoData` and the
SettingsPage export (already `buildPayload`-derived) are unchanged; a demo-coverage test
locks the personal/preference partition. Verified with a deep-equality apply→derive
round-trip test, resetMissing reset/preserve tests, an exhaustiveness/group-split check,
and a throwaway-`DATA_DIR` POST confirming the built shape passes server validation
(416 tests pass; `tsc`/`lint`/`build` green).

Still open (deferred to BACKLOG "Polish items"): `BudgetDistributionChart.tsx:~43-59`
hand-rolls a tooltip card that the shared `ChartTooltip` could serve with a small
"extra line" slot — kept out of the persistence PR to keep its diff clean.

---

## 9. Verified correct (no action)

Checked in depth and found sound: `calcMonthlyPayment` / `calcAmortizationSchedule` /
`calcBorrowingCapacity` (match utlånsforskriften incl. the +3pp stress test); all 2025
trinnskatt brackets and deductions except 1.1; `debt.ts` payoff engine (interest-first
ordering, avalanche ≤ snowball invariant, revolving exclusion); `envelopes.ts` (no double
counting, day-accurate spillover); `categoryStats.ts` (null MoM on zero prior);
`transfers.ts` heuristics; `date.ts` month-key maths (local-time safe, year boundaries);
`netWorth.ts` interpolation; payslip amount grammar (NBSP/thin-space); rounding done only at
output edges (no accumulation); nominal `rate/12` used consistently.

Persistence backbone: the CLAUDE.md "hand-maintained in several places" hazard is
structurally fixed; `buildPayload()`/`applyPayload()` are single choke points, and a
field-by-field matrix of all 44 payload fields found only the gaps listed in 2.4/2.5/2.6.
Initial-load guard, debounce/abort/backoff, demo-mode never-persist, SQLite single-statement
upsert, the rev/409 header path, SSB stale-cache handling, and `mapEBTransaction` malformed-
row rejection all verified sound.

Sanity checks on the pages: SalaryPage comp-chart stack sums exactly to its total label;
month-string comparisons are consistently `YYYY-MM` lexicographic; no stale `useMemo` dep
arrays found beyond the two cosmetic items in 5.7; no dead buttons found.

---

## Suggested order of attack

1. Section 1 (wrong numbers), each item is small and independently shippable; 1.1/1.2
   together with the golden-value tax test from section 6; 1.8 first of all (it loses
   onboarding users' money and onboarding is the current project goal).
2. Section 2 (data safety), 2.1 and 2.2 first.
3. Section 7's retirement order (1.8 → 7.3 seed regen → 2.3 → 7.2 → 7.1 → 2.6); it
   overlaps section 2 and stops new legacy-shaped data being minted.
4. Section 3 whenever convenient (only matters with two open clients of the same
   instance, e.g. laptop + phone PWA).
5. Section 4 as a themed "consistency" pass (4.1 and 4.5 ride on the existing BACKLOG debt-
   historization item).
6. Sections 5, 6 and 8 as background cleanup, one theme per PR (i18n sweep, colour sweep
   via 8.3, parse sweep, modal shell 8.1, lib extractions 8.2/8.5). 8.10 (payload-field
   registry) is its own carefully-tested task.
