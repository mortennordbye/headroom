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

### 14. Real empty state for salary sub-entries with no job ✅ OBSOLETE
Resolved by the type-first record-event modal (PR #40): the "Record event" button only
renders when `jobs.length > 0` (`src/pages/SalaryPage.tsx`), the empty state shows a plain
"no entries" line + the Add job button, and the record modal itself carries an inline
"+ Add job" action (`src/components/RecordEventModal.tsx`). The old disabled-hint EditModal
form no longer exists, so there's nothing left to fix here.

### Money insight & what-ifs

### 15. Mortgage extra-payment what-if ✅ SHIPPED
`extraPaymentSavings` (pure, unit-tested in `src/lib/debt.ts`) runs the loan through `amortize`
twice — with and without a fixed extra monthly payment — and returns months + interest saved.
A slider on the shared amortization accordion (first-buyer and homeowner) surfaces "time saved
/ interest saved / new payoff time". (`src/pages/LoanPage.tsx`.)

### 16. Give `recurringTemplates` its UI ✅ SHIPPED
The add-transaction modal now shows a "saved templates" quick-pick: click a chip to prefill
the form, delete one with its ×, and a "save as template" checkbox creates a template from
the current entry. `EditModal` gained an optional `header` slot for the chip row; the modal
reads/writes the already-persisted `recurringTemplates` via a ref so it can refresh its chip
list in place. (`src/pages/BudgetPage.tsx`, `src/components/EditModal.tsx`.)

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

### 23. Scenario bands on projections ✅ SHIPPED (Forecast; Assets/Dashboard deferred)
`netWorthBands` (pure, unit-tested in `src/lib/scenarioBands.ts`) re-runs the projection's
compounding at the base return and at ±3pp to produce bear/base/bull totals. Rendered as a
range band behind the Forecast net-worth line so the long-range projection no longer reads
as a single certain line. (`src/pages/ForecastPage.tsx`.) The Assets/Dashboard charts are
stacked, where a band doesn't drop in cleanly — deferred to `BACKLOG.md`.

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

### 33. Text alternatives for charts ✅ SHIPPED
All 13 Recharts wrappers now wrap their graphic box in `role="img"` with a one-line
`aria-label` summary (new `t.charts.aria.*` set, both locales), so a screen reader announces
the chart's meaning instead of traversing unlabeled ticks. The label sits on the chart box
only — titles/legends/stat readouts stay outside it and remain individually readable; the
two overlay gauges keep their live text accessible. `SpendingHeatmap` (already per-cell
labelled) and the div-based `LiquidLockedBar` (fully text) were left as-is.
(`src/components/charts/*.tsx`.)

### 34. Skip-to-content link ✅ SHIPPED
A visually-hidden "skip to content" link is now the first focusable element in `Layout`;
it reveals on focus and jumps to `<main id="main-content" tabIndex={-1}>`, so a keyboard user
can bypass the nav on every route. Label routed through `translations.ts`.
(`src/components/Layout.tsx`.)

### 35. Persistent glossary for domain terms
The only explanations of "headroom", LTV, trinnskatt, OTP/IPS live in the one-shot `learn`
onboarding topics (`src/lib/onboarding.ts`); after `onboardingCompleted` there's no way to
look a term up. Add inline info tooltips on domain labels or a glossary panel behind the
existing header help button.

### 36. Keyboard month-stepping ✅ SHIPPED (arrow keys; route shortcuts deferred)
The header month picker is now a `role="group"` with an `onKeyDown`: Left/Right step the
month when focus is anywhere in the picker (e.g. on a stepper button), so paging is operable
without the mouse. The optional `g`-prefixed route jumps were not built.
(`src/components/Layout.tsx`.)

---

## Small

### Feedback & errors
37. **Bank sync errors render in accent colour ✅ SHIPPED** — the status line now colours
    error outcomes (`linkError`/`keyInvalid`/`syncError`/`needsRelink`, matched by prefix so
    the `linkError (reason)` suffix still counts) with `var(--negative)`; success stays accent.
    (`src/components/BankSyncCard.tsx`.)
38. **Silent wage-stats failure ✅ SHIPPED** — the wage-stats fetch now sets a
    `wageStatsStale` flag (context) on a failed/empty response, mirroring `inflationStale`;
    SalaryPage shows a "Wage statistics unavailable — could not reach SSB" note in the header
    (i18n'd). (`src/context/FinanceContext.tsx`, `src/pages/SalaryPage.tsx`.)
39. **No positive "saved" signal.** Saves are silent; only failures raise a banner
    (`doSave` in `src/context/FinanceContext.tsx`). A subtle transient "saved" tick builds
    trust that an edit persisted.
40. **Skeletons for lazy routes/charts.** `RouteFallback` is a bare "…" (`src/App.tsx`) and
    chart `Suspense` fallbacks are empty divs; slow first paint shows blank boxes.
41. **Consent-expiry lead-time nudge ✅ SHIPPED** — the per-connection expiry line now turns
    amber once `daysLeft` is within a 14-day lead window (`RELINK_LEAD_DAYS`), not only after
    `needsRelink` flips, so a cron-driven sync doesn't go silent right up to expiry.
    (`src/components/BankSyncCard.tsx`.)

### Input polish
42. **Goals modal always shows the manual-current field** even when the goal source is
    Portfolio/BSU/etc. (`src/components/GoalsSection.tsx`); needs conditional-field support
    in `EditModal` or a filtered field list.
43. **Goal deadline is free-text `YYYY-MM` ✅ SHIPPED** — `EditModal` gained a `'month'` field
    type rendering `<input type="month">`; the goal deadline field uses it, so the native month
    picker replaces free-text entry (its `YYYY-MM` value matches the existing validators/storage
    unchanged). (`src/components/EditModal.tsx`, `src/components/GoalsSection.tsx`.)
44. **Slider vs number-input caps disagree ✅ SHIPPED** — the savings-target cap is now 100
    everywhere (Settings slider raised 95→100 to match `SmartRecommendations`), and `RangeRow`'s
    number input clamps its committed value to `[0, max]` (and carries `max`) like the slider,
    so no RangeRow can commit an out-of-range figure. (`src/pages/SettingsPage.tsx`.)
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
48. **Global `user-select: none` blocks copying figures ✅ SHIPPED** — the Dashboard headline
    net-worth figure and the BankSyncCard account name/tail rows now carry `data-selectable`
    (which already opts back into `user-select: text`), so the two most-copied readouts (headline
    total, account identifier) can be selected. (`src/pages/DashboardPage.tsx`,
    `src/components/BankSyncCard.tsx`.)
49. **Tiny touch targets on ledger row actions ✅ SHIPPED** — the ledger edit/delete buttons
    (mobile chips + desktop rows) gained `p-1.5 -m-0.5`, roughly doubling the tap area (~23px)
    while keeping the compact chip layout via the negative margin. (True 44px isn't reachable in
    a 24px chip without redesigning the row, so this is a padding improvement, not full compliance.)
    (`src/pages/BudgetPage.tsx`.)

### Charts & PWA
50. **AssetPage projection legend colour mismatch ✅ SHIPPED** — the crypto legend swatch now
    uses `var(--rust)`, matching the area's `CHART.rust` (and the sibling swatches' direct
    palette tokens) instead of the value-sign alias `var(--negative)`. (`src/pages/AssetPage.tsx`.)
51. **Legends aren't interactive.** No click-to-isolate/toggle on the multi-series projection
    charts (`src/pages/AssetPage.tsx`, `src/components/SmartRecommendations.tsx` has
    hover-dim only).
52. **UpdatePrompt bypasses i18n ✅ SHIPPED** — the hardcoded bilingual strings now read from
    `t.updatePrompt.{message,update,later}` via `useFinance` (UpdatePrompt renders inside the
    provider), so the prompt shows one locale. (`src/components/UpdatePrompt.tsx`.)
53. **CSV export is current-month only ✅ SHIPPED** — `exportCSV` now takes a scope; the ledger
    toolbar has a second "Export all" button that dumps the full transaction history
    (`budget-all.csv`) alongside the month export. (`src/pages/BudgetPage.tsx`.)
54. **Recharts animations ignore `prefers-reduced-motion`.** The reduced-motion CSS block
    only neutralizes CSS transitions, not Recharts' JS-driven tweens; pass
    `isAnimationActive={!reduced}` from a media-query hook.
55. **No `color-scheme: dark` ✅ SHIPPED** — `:root` now declares `color-scheme: dark`, so
    native UI (select popups, number spinners, the new month picker, autofill, scrollbars)
    renders dark against the app (`src/index.css`).
56. **No print stylesheet ✅ SHIPPED** — an `@media print` block remaps the core surface/text
    tokens to a light theme (aliases cascade, so components re-theme without edits), hides the
    fixed header / bottom nav / dialogs / toasts, and lets `main` flow full-width. Chart hues
    stay legible on white. (`src/index.css`.) Still pairs with the year-in-review report (item 26)
    when that lands.

### Norwegian domain
57. **Studielån is only a generic debt.** The `student` debt type is amortized like any loan
    (`src/lib/debt.ts`), ignoring Lånekassen specifics (0% while studying, deferment), so its
    payoff row can mislead. Model the subtype's basics.
58. **Forecast ignores the user's tuned assumptions ✅ OBSOLETE** — already addressed: the
    Forecast sliders seed from real data (`returnPct = returnOverride ?? growthReturnRate`, a
    `savingsSeed` derived from `recommendedInvestment`/net income, plus `raiseSeed`/`inflationSeed`
    from salary and CPI history), each `override ?? seed` so the slider follows the data until
    dragged. The FEATURES note was stale. (`src/pages/ForecastPage.tsx`.)
59. **No savings-rate decline warning.** ✅ SHIPPED — `savingsRateStatus` (pure, unit-tested
    in `src/lib/savingsRate.ts`) averages the trailing 3 months of the cashflow series and, when
    it slips under `savingsTargetPercent`, the Budget savings-rate card raises a warning banner
    (`src/pages/BudgetPage.tsx`).
60. **Emergency-fund months use fixed expenses only.** `calcEmergencyFundStatus(bufferAccount,
    totalFixedExpenses)` counts discretionary subscriptions but ignores variable essentials
    (groceries), so "months covered" can mislead both ways. Let the user mark essential lines
    or include median variable spend.
61. **Fixed expenses totaled by type ✅ SHIPPED** — `fixedExpenseTotalsByType` (pure,
    unit-tested in `src/lib/fixedExpenseTotals.ts`) sums the monthly amount per type; the
    Budget fixed-expense colour key now shows each present type's total ("subscriptions cost
    you X kr/mo") instead of a bare label list. (`src/pages/BudgetPage.tsx`.)

### Self-hosting
62. **Blob/DB size surfaced ✅ SHIPPED** — the Settings About card now shows the live blob
    size (`formatBytes` on the persisted JSON, unit-tested in `src/lib/format.ts`) and the
    record count (`totalRecords`) alongside the SQLite chip, so a self-hoster can watch the
    blob grow toward the server's 2 MB warning. (`src/pages/SettingsPage.tsx`.)
63. **Export stamps `_version: 1` but import never checks it ✅ SHIPPED** — a shared
    `EXPORT_VERSION` const now stamps the export and gates `validateAndPreview`: a file whose
    `_version` is newer than this build is refused with an "update the app first" error (i18n'd);
    older/absent versions still import as legacy. (`src/pages/SettingsPage.tsx`.)
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
67. **Hardcoded-English aria/copy leaks ✅ SHIPPED** — the month-stepper aria-labels
    (`src/components/Layout.tsx`), the "Budget composition" aria-label and visible "vs avg"
    chip text (`src/pages/DashboardPage.tsx`), and the mobile CSV button's now-present
    `aria-label` (`src/pages/BudgetPage.tsx`) all route through `translations.ts`
    (`prevMonth`/`nextMonth`/`budgetComposition`/`vsAvg`, and the existing `exportCSV`).
68. **Ledger table headers lack `scope="col"` ✅ SHIPPED** — every `<thead>` `<th>` now carries
    `scope="col"`: Budget ledger, Salary history, Loan amortization, `MonthlyAccountSpend`, and
    `EquityHistoryTable`. (`src/pages/BudgetPage.tsx`, `src/pages/SalaryPage.tsx`,
    `src/pages/LoanPage.tsx`, `src/components/MonthlyAccountSpend.tsx`,
    `src/components/EquityHistoryTable.tsx`.)
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
