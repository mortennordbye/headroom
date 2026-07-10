# Feature & quality-of-life ideas (2026-07-09)

Candidate improvements collected during two full code sweeps: a first pass over the pages,
components and context focused on daily-use friction, and a second pass with three deeper
lenses (finance-domain gaps grounded in what `src/lib/` already computes, self-hosting and
operations, and interaction/accessibility/performance). These are proposals, not commitments:
nothing here is started, and none of it is tracked in `BACKLOG.md` (that file is for agreed
deferrals from shipped work; overlaps were checked and excluded). When an item ships, delete
it here; if one gets started and deferred, move it to `BACKLOG.md` with the usual four fields.

Sizes: **small** = under an hour, one file or two. **medium** = a focused PR.
**big** = a feature with design decisions.

**Cross-reference:** `HISTORY_PLAN.md` (the full-historization plan) has **SHIPPED** — all
phases merged to `main` (PR #31, 2026-07-09). It absorbed item 13 outright (now done) and
its snapshot spine is the prerequisite for items 12, 15, 18, 24, 25 and 26, which are now
**unblocked** (each carries an updated `HISTORY_PLAN:` note) but not yet built.

---

## Big

### 1. Transaction search ✅ SHIPPED
Free-text filter above the Daily Tracker ledger, matching merchant + description + display
label + amount (via `buildMatchHaystack`). Non-matching days collapse away; a match count and
empty state give feedback. (`src/pages/BudgetPage.tsx`.)

### 2. Bulk select / bulk recategorize / bulk delete ✅ SHIPPED
A "Select" toggle turns ledger chips into checkboxes; selected rows raise a floating action
bar to set a category on all of them or delete them in one confirm. Composes with search
(item 1): filter, select, fix. (`src/pages/BudgetPage.tsx`.)

### 3. Recurring-transaction detection ✅ SHIPPED
`src/lib/recurring.ts` (pure, unit-tested) groups expense rows by normalized merchant and
surfaces any charging a similar amount across 3+ of the last 4 months that isn't already a
fixed expense. A nudge in the Fixed Expenses card offers one-tap "make fixed expense" (created
as a pattern envelope so it draws down instead of double-counting).

### 4. Multi-arch Docker image (arm64) ✅ SHIPPED
`.github/workflows/build.yml` now builds `linux/amd64,linux/arm64` with a QEMU setup step;
`better-sqlite3` compiles from source per-arch in the Dockerfile, so Raspberry Pi and
Apple-Silicon self-hosters get a native prebuilt image.

---

## Medium

### Daily use

### 5. Quick-add for today's expense ✅ SHIPPED
A mobile floating "+" opens the add-transaction modal dated today, shown only on the current
month and hidden while selecting rows. (`src/pages/BudgetPage.tsx`.)

### 6. Remember last-used values in the add-transaction modal ✅ SHIPPED
The add-transaction modal reuses the last category/kind used this session (module-scoped, not
persisted); a template prefill still takes precedence. (`src/pages/BudgetPage.tsx`.)

### 7. Select-on-focus in edit modals ✅ SHIPPED (already present)
`useFocusTrap` already calls `target.select()` on the modal's initial-focus input (added in
the 2026-07-04 audit remediation), so amount edits start with the value selected. No change
needed; the FEATURES.md note was stale.

### 8. Back button closes modals on mobile ✅ SHIPPED
`ModalShell` pushes a history entry on open and closes on `popstate`, so the browser/hardware
Back button dismisses the dialog instead of navigating away. Closing by any other path
consumes the pushed entry (unless the router navigated meanwhile). One fix covers every modal.

### 9. Undo instead of (or alongside) confirm for routine deletes ✅ SHIPPED
Deleting a ledger transaction removes it immediately and shows an ~8s undo toast (shared
`src/components/ui/UndoToast.tsx`) instead of a confirm. Fixed expenses keep their confirm.

### 10. Consistent delete protection ✅ SHIPPED
Payslips (routine, month-keyed) now use the undo toast like transactions; savings accounts
(structural, goal-referenceable) now confirm like fixed expenses / goals / debts.
(`src/pages/BudgetPage.tsx`, `src/pages/AssetPage.tsx`.)

### 11. Clickable Dashboard "Recent Transactions" ✅ SHIPPED
The transaction editor was extracted into a shared `EditTransactionModal` (used by the Budget
ledger and the Dashboard recent list, whose rows are now buttons). Fixing a wrong category no
longer means leaving for the Budget page.

### 12. Month in the URL ✅ SHIPPED
`Layout.tsx` now mirrors the shared month into a `?m=YYYY-MM` query param (replace, so
stepping doesn't spam history) and re-adds it across route changes; on mount a valid `?m`
is adopted, so a refresh or shared link lands on that month. "June's budget" is bookmarkable.

### 13. One coherent month model across pages ✅ SHIPPED (PR #31)
Delivered as Phase 3 (§5.1/§5.2) of `HISTORY_PLAN.md`: the stepper state was lifted to a
shared `historyMonth` slice, the header month picker now drives the balance-page time
machine on Assets/Loan/Pension (read-only, carries across pages), and the per-page
`BalanceHistoryBar` was removed. (Salary is still always-live; not in scope.)

### 14. Real empty state for salary sub-entries with no job
Adding a bonus/overtime/hours entry before any job exists opens an `EditModal` whose only
field is a disabled hint (`src/pages/SalaryPage.tsx`), which reads as a broken form. Replace
with an inline "add a job first" CTA that opens the add-job modal.

### Money insight & what-ifs

### 15. Mortgage extra-payment what-if ✅ SHIPPED
`extraPaymentSavings` (pure, unit-tested in `src/lib/debt.ts`) runs the loan through `amortize`
twice — with and without a fixed extra monthly payment — and returns months + interest saved.
A slider on the shared amortization accordion (first-buyer and homeowner) surfaces "time saved
/ interest saved / new payoff time". (`src/pages/LoanPage.tsx`.)

### 16. Give `recurringTemplates` its UI
`TransactionTemplate` and `recurringTemplates` are fully typed, persisted and exported
(`src/context/FinanceContext.tsx`, `src/lib/exportSummary.ts`), and `addDailyTransaction`
already accepts a template prefill, but no UI creates or applies templates. A "saved
templates" quick-pick in the add-transaction modal would serve recurring manual entries
(rent split, cash allowance).

### 17. Marginal tax rate readout ✅ SHIPPED
`calcMarginalTaxRate` (pure, unit-tested in `src/lib/norwegianTax.ts`) takes a finite
difference of `totalTax` so it captures the trinnskatt bracket, the 22% alminnelig (net of the
minstefradrag phase-in) and trygdeavgift at once. Shown as a "next krone" readout beside the
tax-breakdown chart on SalaryPage (Norwegian region only).

### 18. BSU cap tracking ✅ SHIPPED
`bsuStatus` (pure, unit-tested in `src/lib/bsu.ts`) derives "contributed this year" from the
BSU balance change since the start of the year (snapshot deltas) and reports room left
against the 27 500 kr/yr and 300 000 kr lifetime caps. A tile under the BSU row on Assets
shows both with progress bars. The age-34 cutoff is left unmodeled (no birthdate is tied to
the account). (`src/pages/AssetPage.tsx`.)

### 19. Restskatt early warning ✅ SHIPPED
`restskattEstimate` (pure, unit-tested in `src/lib/restskatt.ts`) sums this year's withheld
tax from the payslips, projects the annual gross linearly, and compares the projected
withholding to the expected liability (via a caller-supplied tax fn carrying region +
deductions). A Salary tile flags a likely restskatt or refund past a materiality threshold,
with a note on the June/December withholding it doesn't model. (`src/pages/SalaryPage.tsx`.)

### 20. Feriepenger month modeling
`monthlyCashflow` applies a flat income to every month, so the June feriepenger spike and
the December half-trekk are invisible unless a payslip is imported for those months, even
though `MonthlyPayslip.holidayPay` and the `holiday_pay` bonus type exist. Model the
June/December swings in the budget projection (seeded from `feriepengesatsPct`).

### 21. Saved forecast scenarios / A-B compare
The five Forecast assumption sliders are local `useState`: a refresh loses them and two
futures can't be held side by side (rate +2pp vs job change vs prepay). Persist assumptions
and add a two-scenario compare (two projection lines plus a delta tile).
Where: `src/pages/ForecastPage.tsx`.

### 22. "Prepay mortgage vs invest" comparison ✅ SHIPPED
`prepayVsInvest` (pure, unit-tested in `src/lib/prepayVsInvest.ts`) grows a fixed extra
monthly amount to a future value at two rates: the mortgage's after-tax rate (nominal ×
(1 − 22% deduction)) if it prepays deductible debt, or the expected return if invested.
A Forecast card with an extra-per-month slider surfaces both future values, the effective
rates, and which side wins by how much over the horizon. (`src/pages/ForecastPage.tsx`.)

### 23. Scenario bands on projections
Every net-worth projection (`calcNetWorthProjectionByBucket`) draws one deterministic line
per bucket. Bear/base/bull bands (return ±3pp) around the long-range projection would stop
the chart overstating certainty. Where: `src/lib/calculations.ts`,
`src/pages/DashboardPage.tsx`, `src/pages/AssetPage.tsx`.

### 24. Goal completion ETA from actual pace ✅ SHIPPED
`goalPace` (pure, unit-tested in `src/lib/goalPace.ts`) measures the recent monthly pace of a
goal's source balance across the trailing months of snapshot history (real month gaps) and
projects when the target is reached, whether that's ahead of or behind the deadline, and the
kr/mo needed to make it. Each source-tracked goal card with ≥2 recorded months shows the ETA
line. (`src/components/GoalsSection.tsx`.)

### 25. Financial-independence (FIRE) tile ✅ SHIPPED
A FI card on Forecast: the 25× annual-essential-spend target (from `totalFixedExpenses`),
progress of net worth toward it, and the projected FI year — the first projected year whose
real (today's-kroner) net worth clears the target, so it tracks the assumption sliders live.
(`src/pages/ForecastPage.tsx`.)

### 26. Year-in-review report
Per-year comp (`compByYear`), annual cashflow (`monthlyCashflow`) and multi-month category
totals (`monthlyCategoryTotals`) all exist as pure functions, but there's no consolidated
annual view (income, tax paid, savings rate, top categories, net-worth change) and no
print/PDF path. Assemble a year-in-review page from the existing aggregators (pairs with
the print stylesheet, item 63).
HISTORY_PLAN: unblocked — the plan has landed (main); net-worth change and month-by-month
balances now come straight from snapshots (`equitySeriesFrom` / `netWorthSeriesFrom`)
instead of needing their own aggregation.

### Data safety & self-hosting

### 29. Automated, rotating backups
`make backup` is a single manual `docker cp` with no schedule, retention or rotation; a
friend who forgets has exactly one live copy. Ship a compose sidecar or entrypoint cron that
snapshots and prunes to N copies, or an in-app scheduled export. Where: `Makefile`,
`docker-compose.yml`.

### 31. In-app bank sync history
`recordSync` overwrites `last_sync` and the sync route's `{fetched, added, total}` result is
never persisted, so a self-hoster can't see whether the nightly cron ran or how many rows it
pulled. Persist a small rolling sync log (timestamp, added count, ok/err) and render it in
`BankSyncCard`. Where: `server/bank.js`, `src/components/BankSyncCard.tsx`.

### 32. Compose resource limits and pinnable image docs
`docker-compose.yml` sets no memory/CPU limits on a process that loads the whole blob into
memory, and the README's update instructions only mention `:latest`, never the immutable
`sha-` tags CI publishes, so friends can't pin or roll back. Add a modest `mem_limit` and
document `sha-` pinning.

### Accessibility

### 33. Text alternatives for charts
All 13 Recharts wrappers render bare SVG with no `role="img"`/`aria-label` and are not
`aria-hidden`; a screen reader traverses unlabeled axis ticks (only `SpendingHeatmap` has
per-cell labels). Wrap each container in `role="img"` with a one-line summary label.
Where: `src/components/charts/*.tsx`.

### 34. Skip-to-content link
A keyboard user must Tab through the whole desktop nav on every route before reaching
content. Add a visually-hidden "skip to content" as the first focusable element targeting
`<main>`. Where: `src/components/Layout.tsx`.

### 35. Persistent glossary for domain terms
The only explanations of "headroom", LTV, trinnskatt, OTP/IPS live in the one-shot `learn`
onboarding topics (`src/lib/onboarding.ts`); after `onboardingCompleted` there's no way to
look a term up. Add inline info tooltips on domain labels or a glossary panel behind the
existing header help button.

### 36. Keyboard month-stepping and shortcuts
The only keydown handlers are per-input Enter/Escape; the month stepper is two buttons
requiring Tab+Enter. Add left/right arrow month stepping when the picker is focused, and
optionally `g`-prefixed route jumps. Where: `src/components/Layout.tsx`.

---

## Small

### Feedback & errors
37. **Bank sync errors render in accent colour.** `syncError`/`linkError`/`keyInvalid` look
    identical to success text (`src/components/BankSyncCard.tsx`, `color: var(--accent)`).
    Use `var(--negative)` for error outcomes.
38. **Silent wage-stats failure.** The SSB comparison line just vanishes on fetch failure
    (`.catch(() => {})` in `src/context/FinanceContext.tsx`), unlike inflation which sets
    `inflationStale`. Surface a small "benchmark unavailable" note.
39. **No positive "saved" signal.** Saves are silent; only failures raise a banner
    (`doSave` in `src/context/FinanceContext.tsx`). A subtle transient "saved" tick builds
    trust that an edit persisted.
40. **Skeletons for lazy routes/charts.** `RouteFallback` is a bare "…" (`src/App.tsx`) and
    chart `Suspense` fallbacks are empty divs; slow first paint shows blank boxes.
41. **Consent-expiry lead-time nudge.** `daysLeft` is computed per connection
    (`server/bank.js`) but `BankSyncCard` only escalates once `needsRelink` is already true;
    a cron-driven sync goes silent with no prior warning. Warn at e.g. 14 days remaining.

### Input polish
42. **Goals modal always shows the manual-current field** even when the goal source is
    Portfolio/BSU/etc. (`src/components/GoalsSection.tsx`); needs conditional-field support
    in `EditModal` or a filtered field list.
43. **Goal deadline is free-text `YYYY-MM`** (`src/components/GoalsSection.tsx`); use
    `<input type="month">`.
44. **Slider vs number-input caps disagree.** Savings-target slider caps at 95
    (`src/pages/SettingsPage.tsx`) while the inline % editor allows 100
    (`src/components/SmartRecommendations.tsx`) and `RangeRow`'s number input has no upper
    cap. Reconcile.
45. **Fixed-expense match pattern only settable from a transaction.** The "map to fixed
    expense" rule can't be added or edited from the fixed-expense editor itself
    (`src/pages/BudgetPage.tsx`). Add a match field there.
46. **EditModal has no `<form>` semantics.** Enter-to-submit is wired per input
    (`src/components/EditModal.tsx`), so the checkbox field and suggestion chips don't
    submit and there's no `type="submit"`. Wrap fields in a `<form onSubmit>`.
47. **Backdrop-click discards in-progress edits.** `ModalShell` closes on any overlay click
    with no dirty guard, so a mis-tap throws away a half-typed amount (the onboarding tour
    deliberately guards leaving). Suppress backdrop-close when dirty, or confirm.

### Reading & copying
48. **Global `user-select: none` blocks copying figures.** A user can't copy their net-worth
    number or an account tail from a card (`src/index.css`; only inputs and `[data-selectable]`
    opt back in). Add `data-selectable` to key monetary/identifier readouts.
49. **Tiny touch targets on ledger row actions.** Edit/delete icons are 11-12px inside chips
    (`src/pages/BudgetPage.tsx`), far under the ~44px mobile guideline. Pad the hit areas.

### Charts & PWA
50. **AssetPage projection legend colour mismatch.** The legend's crypto swatch uses
    `var(--negative)` while the stacked area uses `CHART.rust` (`src/pages/AssetPage.tsx`).
    Use the same token.
51. **Legends aren't interactive.** No click-to-isolate/toggle on the multi-series projection
    charts (`src/pages/AssetPage.tsx`, `src/components/SmartRecommendations.tsx` has
    hover-dim only).
52. **UpdatePrompt bypasses i18n.** "Ny versjon tilgjengelig / New version available" is
    hardcoded bilingual (`src/components/UpdatePrompt.tsx`); move to `translations.ts`.
53. **CSV export is current-month only.** `exportCSV` filters to the selected month
    (`src/pages/BudgetPage.tsx`); offer a full-history export.
54. **Recharts animations ignore `prefers-reduced-motion`.** The reduced-motion CSS block
    only neutralizes CSS transitions, not Recharts' JS-driven tweens; pass
    `isAnimationActive={!reduced}` from a media-query hook.
55. **No `color-scheme: dark`.** `:root` sets dark tokens but never declares `color-scheme`,
    so native UI (select popups, number spinners, month pickers, autofill) renders light
    against the dark app (`src/index.css`).
56. **No print stylesheet.** Pages print dark-on-dark with the sticky header and bottom nav
    overlapping content; add an `@media print` block (light background, hide chrome). Pairs
    with the year-in-review report (item 26).

### Norwegian domain
57. **Studielån is only a generic debt.** The `student` debt type is amortized like any loan
    (`src/lib/debt.ts`), ignoring Lånekassen specifics (0% while studying, deferment), so its
    payoff row can mislead. Model the subtype's basics.
58. **Forecast ignores the user's tuned assumptions.** Slider defaults are hardcoded
    (return 5%, savings 25%) even though the context carries the user's `growthReturnRate`
    and `savingsTargetPercent`; the Dashboard even nags about untuned defaults while
    Forecast uses different numbers. Seed the sliders from the user's values.
59. **No savings-rate decline warning.** ✅ SHIPPED — `savingsRateStatus` (pure, unit-tested
    in `src/lib/savingsRate.ts`) averages the trailing 3 months of the cashflow series and, when
    it slips under `savingsTargetPercent`, the Budget savings-rate card raises a warning banner
    (`src/pages/BudgetPage.tsx`).
60. **Emergency-fund months use fixed expenses only.** `calcEmergencyFundStatus(bufferAccount,
    totalFixedExpenses)` counts discretionary subscriptions but ignores variable essentials
    (groceries), so "months covered" can mislead both ways. Let the user mark essential lines
    or include median variable spend.
61. **Fixed expenses are typed but never totaled by type.** Each carries
    `fixed | variable | subscription | insurance` with a coloured dot, but there is no
    "subscriptions cost you X kr/mo" summary (`src/pages/BudgetPage.tsx`). Add per-type
    totals above the list.

### Self-hosting
62. **Blob/DB size not surfaced.** The server warns at 2 MB in the log only; the Settings
    About card shows a static "Storage: SQLite" chip. Show live blob bytes plus record
    counts (already computed by `summarizeExport`).
63. **Export stamps `_version: 1` but import never checks it.** `validateAndPreview`
    (`src/pages/SettingsPage.tsx`) ignores the field, so a future format change would import
    silently. Gate on `_version` and warn on newer-than-supported files.
64. **Import is all-or-nothing.** The preview diff is good, but `confirmImport` replaces the
    whole payload; a per-section selective restore (just the ledger, just settings) would
    pair naturally with the existing diff summary.
65. **SSB inflation has no manual refresh.** The retry cooldown lives in memory
    (`server/index.js`), so after an outage the user can't force a fetch short of restarting
    the container. Add a "refresh" action that resets the cooldown.
66. **Restore is shell-only.** Recovering a SQLite snapshot is documented as
    `docker cp` + restart (`README.md`); an in-app restore path (or surfacing the last
    auto-snapshot from item 28) would make recovery reachable without a terminal.

### Accessibility & i18n leaks
67. **Hardcoded-English aria/copy leaks:** month-stepper `aria-label="Previous/Next month"`
    (`src/components/Layout.tsx`), `aria-label="Budget composition"` and the visible
    "vs avg" chip text (`src/pages/DashboardPage.tsx`), and the mobile CSV button whose
    label is hidden below `sm` leaving a bare icon with no `aria-label`
    (`src/pages/BudgetPage.tsx`). Route all through `translations.ts`.
68. **Ledger table headers lack `scope="col"`** (`src/pages/BudgetPage.tsx` and the other
    `<th>` sites). Add scope attributes.
69. **Onboarding always restarts from the top.** Only the `onboardingCompleted` boolean
    persists; re-entering the tour begins at welcome even mid-setup
    (`src/components/onboarding/OnboardingTour.tsx`). Persist the last topic index and
    resume.
70. **Optional: explicit vendor `manualChunks`.** Charts and pdf.js are already lazy; an
    explicit recharts/date-fns vendor split in `vite.config.ts` would make the shared-chunk
    boundary stable across builds. Low priority.

---

## Checked and fine (don't re-investigate)

- **Bundle/lazy-loading**: every chart is `lazy()`-imported per component, so Recharts stays
  out of the entry chunk; pdf.js is lazy per BACKLOG.
- **Ledger DOM size**: the Budget ledger renders one row per day of the selected month, not
  a year of transactions; no virtualization needed.
- **PWA update path**: `registerType: 'prompt'` + hourly/visibility polling +
  `controllerchange` fallback + the stale-chunk 404 guard are all in place.
- **Input handling**: `inputMode="decimal"`, `parseLocaleNumber` comma handling, the iOS
  16px font floor, focus trap/restore and `prefers-reduced-motion` (CSS side) are solid.
