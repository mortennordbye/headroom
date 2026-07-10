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

### 5. Quick-add for today's expense
The Daily Tracker is collapsed by default (`logOpen` starts `false` in
`src/pages/BudgetPage.tsx`), so logging today's coffee means expand, scroll to today, click
the row's `+`. Add a persistent "quick add (today)" button (mobile FAB), or default the
current month's log open.

### 6. Remember last-used values in the add-transaction modal
`addDailyTransaction` (`src/pages/BudgetPage.tsx`) always resets kind to `expense` with a
blank category. Remembering the last-used category/kind (session-local is fine) removes the
most repetitive taps in the app.

### 7. Select-on-focus in edit modals
`EditModal` (`src/components/EditModal.tsx`) focuses the first field but does not select its
prefilled text, so every amount edit starts with manually clearing the old value. The inline
`EditablePill` in `src/components/SmartRecommendations.tsx` already calls `.select()`; do the
same on the modal's initial-focus input.

### 8. Back button closes modals on mobile
Open modals aren't tied to browser history (`src/components/ui/ModalShell.tsx`), so the
hardware/browser Back button navigates the app away instead of dismissing the dialog. Push a
history entry on open, close on `popstate`. One fix in ModalShell covers every modal.

### 9. Undo instead of (or alongside) confirm for routine deletes
Transaction/expense deletion shows a `ConfirmModal` each time but offers no recovery after.
A toast-with-undo (hold the deleted row in memory for ~10s before committing) is both lighter
for cleanup sessions and safer. Where: `src/pages/BudgetPage.tsx`, a small shared toast in
`src/components/ui/`.

### 10. Consistent delete protection
Savings-account rows (`src/pages/AssetPage.tsx`, `removeSavingsAccount`) and payslips
(`src/pages/BudgetPage.tsx`, `removePayslip`) delete instantly with no confirm, while fixed
expenses, transactions, goals and debts all confirm. Align on one pattern (ideally item 9's
undo) everywhere.

### 11. Clickable Dashboard "Recent Transactions"
The rows are plain divs (`src/pages/DashboardPage.tsx`), so fixing a wrong category means
leaving for the Budget page and finding the row again. Wire the same edit modal the Budget
ledger uses.

### 12. Month in the URL
The selected month lives only in app state, so a refresh or shared link always lands on the
current month; "June's budget" can't be bookmarked. Reflect the month in the query string.
Where: `src/components/Layout.tsx` (`currentMonth`).
HISTORY_PLAN: unblocked — Phase 3's unified month model shipped (the header picker now
drives `currentMonth` on Dashboard/Budget and `historyMonth` on balance pages); this just
needs the active month reflected in the query string.

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

### 15. Mortgage extra-payment what-if
LoanPage renders a full year-by-year amortization schedule (`calcAmortizationSchedule`) but
has no "pay X extra per month" control, even though `amortize` and DebtSection already prove
the extra-payment pattern. A homeowner can't see that +2 000 kr/mo clears the loan N years
early. Where: `src/pages/LoanPage.tsx`, `src/lib/debt.ts`.
Sketch: an extra-payment slider on the amortization accordion showing months saved and
interest saved vs the base schedule.
HISTORY_PLAN: unblocked — Phase 4 §6.3 shipped `PaydownVsPlanChart` (plan-vs-actual) on
LoanPage; this adds the extra-payment slider as a forward what-if layer over the same
amortization schedule.

### 16. Give `recurringTemplates` its UI
`TransactionTemplate` and `recurringTemplates` are fully typed, persisted and exported
(`src/context/FinanceContext.tsx`, `src/lib/exportSummary.ts`), and `addDailyTransaction`
already accepts a template prefill, but no UI creates or applies templates. A "saved
templates" quick-pick in the add-transaction modal would serve recurring manual entries
(rent split, cash allowance).

### 17. Marginal tax rate readout
`calcNorwegianTax` exposes only the effective rate; the trinnskatt bracket structure needed
for "your next krone is taxed at X%" is already in `src/lib/norwegianTax.ts`, and the
marginal rate is already computed internally to fold bonuses into budget income. Surface it
on SalaryPage so "is the extra shift worth it" is answerable.

### 18. BSU cap tracking
`assets.bsu` is a bare scalar summed into cash; nothing tracks the 27 500 kr/yr contribution
cap, the 300 000 kr lifetime cap, or the age-34 cutoff. A BSU tile showing remaining room
this year and lifetime would make the account actionable.
Where: `src/context/FinanceContext.tsx` (`Assets.bsu`), Assets page.
HISTORY_PLAN: unblocked — Phase 1 shipped, so `balanceSnapshots` now carries per-month BSU
balances; "contributed this year" can be derived from the snapshot deltas rather than asked for.

### 19. Restskatt early warning
Each imported payslip stores that month's withheld tax (`MonthlyPayslip.tax`) and
`calcNorwegianTax(gross).totalTax` computes the expected annual liability, but nothing
compares them. A "withheld vs expected" tile could flag a likely restskatt (or refund)
months before skatteoppgjøret.

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

### 22. "Prepay mortgage vs invest" comparison
The app computes interest saved from extra debt payments (`DebtSection.interestSaved`) and
expected investment return (`ForecastPage.returnPct`) separately but never contrasts them,
despite this being the most common spare-krone question in Norway (deductible interest).
Sketch: a tile comparing "extra 5 000 kr/mo: prepay saves X (after 22% deduction) vs
invest at Y% over N years".

### 23. Scenario bands on projections
Every net-worth projection (`calcNetWorthProjectionByBucket`) draws one deterministic line
per bucket. Bear/base/bull bands (return ±3pp) around the long-range projection would stop
the chart overstating certainty. Where: `src/lib/calculations.ts`,
`src/pages/DashboardPage.tsx`, `src/pages/AssetPage.tsx`.

### 24. Goal completion ETA from actual pace
A goal knows its `remaining` and deadline (`GoalsSection.monthsUntil`), and the app computes
recommended monthly savings, but nothing says "at your current pace you reach this by
<date>" or "you're 4 months behind". Add a projected-completion ETA and a kr/mo-to-make-it
suggestion.
HISTORY_PLAN: unblocked — Phases 1-2 shipped; "actual pace" can now come from the snapshot
history of the goal's source balance (`savingsSeriesFrom` / snapshot deltas), not from the
recommended-savings figure.

### 25. Financial-independence (FIRE) tile
All inputs exist (net worth, annual essential expenses via `totalFixedExpenses`, the
projection engine) but there's no "years to FI" or 25x-expenses readout. A FI tile on
Forecast: net worth vs 25x annual essential spend, and the projected FI year at the current
savings rate.
HISTORY_PLAN: unblocked — Phase 2 shipped `netWorthSeriesFrom`; anchor the FI trajectory on
that real net-worth history rather than the live number alone. (The Dashboard history-insights
chips shipped in PR #31 are a lightweight precedent for this kind of derived readout.)

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

### 27. Corrupt-blob lockout recovery
`readBlob()` guards the GET path, but the 409 stale-revision branch does an unguarded
`JSON.parse(stored.content)`: once the single blob row is corrupt, reads serve `null` and
every save 500s, so the user can neither read nor recover. Wrap the parse and fall through
to last-write-wins (or quarantine the corrupt row). Where: `server/index.js` (409 branch).

### 28. Snapshot before destructive operations
JSON import (`importAll`), `resetAll`, and `make seed-reset` all overwrite or delete the
live blob with no prior snapshot; the rev counter protects against concurrent writes, not
intentional overwrites of good data. Auto-save a timestamped copy of the current blob before
import/reset. Where: `src/pages/SettingsPage.tsx`, `server/index.js`, `Makefile`.

### 29. Automated, rotating backups
`make backup` is a single manual `docker cp` with no schedule, retention or rotation; a
friend who forgets has exactly one live copy. Ship a compose sidecar or entrypoint cron that
snapshots and prunes to N copies, or an in-app scheduled export. Where: `Makefile`,
`docker-compose.yml`.

### 30. One real version number and a version endpoint
Three version numbers diverge (`APP_VERSION = '3.0.0'` in SettingsPage, `0.0.0` in
package.json, `1.0.0` in server/package.json) and `/healthz` returns only `{ok}`, so "what
version am I running" is unanswerable. CI already stamps `sha-<short>` image tags; expose
build SHA via `/api/version` and render it in Settings About.

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
59. **No savings-rate decline warning.** The 12-month savings-rate series is computed and
    charted, but nothing flags the trailing rate falling under `savingsTargetPercent`. Add a
    banner/chip on Budget or Dashboard.
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
