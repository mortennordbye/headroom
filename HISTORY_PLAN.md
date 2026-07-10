# Full historization plan: month-by-month history for every number (2026-07-09)

> **STATUS: ✅ SHIPPED — all phases merged to `main` (PR #31, 2026-07-09).**
> Phases 1–5 complete and browser-verified (0 console errors); plus supporting features
> (Dashboard history insights, missing-month markers). Old-user migration verified (no data
> loss; current month upgrades to v2 once, older months stay v1). The per-phase ✅ markers
> below record the detail.
>
> **Follow-up ✅ SHIPPED (2026-07-10) — single shared month.** The two remaining deferred
> items are done, via a full month-model unification: `historyMonth` was retired and the whole
> app now tracks one `currentMonth`. `useBalanceHistory` snaps that shared month to the nearest
> recorded snapshot (`snapToRecordedMonth` in `src/lib/snapshots.ts`, unit-tested); the one
> header picker drives every money page (balance pages show a read-only lock + "as of {month}"
> when snapped to an earlier recording). §5.3 BudgetPage past-month envelope math now reads
> `snapshot.fixedExpenses` (via `viewFixedExpenses` in `FinanceContext`), with read-only
> fixed-expense editors and a recorded/not-recorded marker. The scalar net-worth editor was
> folded into `HistoryManagerModal` (inline headline field for snapshot-less months) and the
> standalone `NetWorthHistoryModal` deleted; the Dashboard "Edit history" button opens the
> manager. Browser-verified in demo mode, 0 console errors.

## 0. Goal

Every financial quantity in the app should have a real month-by-month history that can be
**viewed** (time machine on any page), **charted** (trend over time, not just a forward
projection), and **backfilled** (months from before the app existed, or months the app was
never opened). Concretely, after this plan ships a user can answer:

- **Egenkapital**: what was my equity in March, and how has its composition
  (stocks / house / crypto / cash) shifted month by month?
- **Bolig**: how has my house value, house debt and LTV actually developed, not just the
  projected curve?
- **Nedbetaling**: am I ahead of or behind my mortgage amortization plan, and by how much?
  Same for the non-mortgage debt payoff plan.
- **Everything else**: savings per account, pension balances, income, fixed costs, at any
  past month, exactly as they were then.

The definition of done: no page needs *live* state to render a historical month, and no
chart silently substitutes today's value for a past month.

---

## 0b. Context for the implementing agent — read this first

This section makes the plan self-contained: together with the repo's `CLAUDE.md` it is
everything a fresh session needs. Read `CLAUDE.md` in full before writing code; the rules
below are the ones this plan leans on hardest.

**What the app is.** Headroom: a self-hosted, single-user personal-finance PWA
(Norwegian tax/loan domain). React 19 + TypeScript + Vite + Tailwind v4 + Recharts
frontend; Node/Express + better-sqlite3 backend. The ENTIRE app state is one JSON blob in
one SQLite row: `GET /api/data` loads it, `POST /api/data` overwrites it wholesale
(optimistic-concurrency rev header, 409 on staleness). The client loads once into
`FinanceContext` and autosaves the whole blob, debounced.

**Non-negotiable repo rules for every phase:**

- Gate before calling anything done: `npx tsc -b && npm run lint && npm test`. UI-visible
  changes also need `make build` and a browser smoke test at `http://localhost:8080` with
  0 console errors. Mind the service-worker cache: after `make build` the browser serves
  the OLD version until the update prompt is accepted or the SW is cleared; do not
  conclude a change "didn't work" before handling that.
- NEVER POST test payloads to the running app; the Docker volume holds the user's real
  financial data. Write-path testing uses a throwaway server:
  `DATA_DIR=$(mktemp -d) PORT=3999 node server/index.js`.
- Pure money math lives in `src/lib/` with unit tests; never inline formulas in pages.
  Guard every division and array lookup: `undefined`/`NaN` reaching a chart is this
  app's stated worst bug class.
- Persisted-state changes go through the registry. `src/lib/payloadRegistry.ts` holds one
  `{group, demo, read, default}` spec per payload field; a new `ExportPayload` field fails
  to compile until registered. Nested-shape changes (this plan mostly changes the *inside*
  of `balanceSnapshots`) must also update `src/lib/sanitizePayload.ts` (imports coerce
  string "numbers") and `src/lib/demoData.ts` (demo must set every field that can hold
  personal data).
- UI conventions: colours only via CSS tokens (`var(--...)`) or `CHART.*` from
  `src/lib/chartColors.ts`, never raw hex. User-facing strings only via
  `src/i18n/translations.ts`; never `lang === 'nb'` ternaries in JSX. Reuse the shared
  primitives in `src/components/ui/` (`ModalShell` for any modal, `ProgressBar`,
  `NumberRow`, `SummaryTile`) and the shared chart props (`ChartTooltip`,
  `AXIS_PROPS`/`AXIS_PROPS_Y`/`GRID_PROPS`).

**Key files for this plan** (line refs as of 2026-07-09; re-locate with grep if drifted):

| File | Why it matters here |
|---|---|
| `src/context/FinanceContext.tsx` | All state. `BalanceSnapshot` interface ~:648; snapshot capture effect ~:1459 (always targets the real current month; skips structurally-equal rewrites via `stableStringify`, which must survive); `netWorthHistory` effect ~:1441; the assets↔homeowner↔transition house mirror in `updateAsset`/`updateHomeowner`/`updateTransition`; `resetAll` ~:1710. |
| `src/hooks/useBalanceHistory.ts` | The per-page time-machine stepper (57 lines; read whole). Phase 3 lifts its state. |
| `src/lib/equity.ts` | `computeEquityBreakdown` + `sumSavings`: the single equity function used live AND historically. All egenkapital history derives through it. |
| `src/lib/netWorth.ts` | The 12-month interpolation behind the Dashboard hero; Phase 2's precedence selector lives here. |
| `src/lib/calculations.ts` | `calcAmortizationSchedule`, `calcNetWorthProjectionByBucket`. |
| `src/lib/debt.ts` | `planPayoff`, `amortize` for the debt plan-vs-actual. |
| `src/lib/salary.ts` | `salaryAt(monthKey, salaries)`: the correct historical salary read (Phase 3, PensionPage). |
| `src/components/Layout.tsx` | Header month picker + `MONTH_SCOPED_ROUTES` (Phase 3 merge target). |
| `src/components/NetWorthHistoryModal.tsx` | The editor Phase 2 grows into. |
| `src/lib/provenance.ts` + `src/components/ui/ProvenanceBadge.tsx` | Default/Yours/Estimate badges; manual snapshots reuse this. |
| `src/components/charts/NetWorthCompositionChart.tsx` | Already snapshot-driven; the template for new history charts. |
| `src/components/charts/LtvChart.tsx` | Projection-only today; Phase 4 prepends actuals. |
| `src/components/BalanceHistoryBar.tsx` | The stepper UI on balance pages. |
| `src/pages/AssetPage.tsx` | The hist-gating template: `debts = hist.isLive ? live : snapshot` ~:94, editor hidden when time-travelling ~:482. |

**Related documents:**

- `BACKLOG.md`: this plan closes six entries there (listed in §8); delete each when its
  phase ships, per that file's rules.
- `IMPROVEMENTS.md` §3.2: the no-op-save/structural-equality guards that must survive any
  change to the capture effect. §4.5: the gate-on-`hist.isLive` pattern Phase 3 repeats.
- `FEATURES.md`: items 12, 13, 15, 18, 24, 25 and 26 interact with this plan; item 13
  *is* Phase 3. Each carries a HISTORY_PLAN note pointing back here.

**Working style:** one phase (or less) per PR. Mark progress in THIS file by appending
`✅ FINISHED (commit)` to phase/sub-item headings, IMPROVEMENTS.md-style, so any later
session can see exactly where the plan stands. Anything started but deferred goes to
`BACKLOG.md` with its four required fields (what / why deferred / what unblocks / where).

---

## 1. Current state inventory

Two historization mechanisms already exist and both are sound. The plan builds on them
rather than replacing them.

**A. Timeline data** (rows carry their own date; history is inherent):

| Data | Where | Status |
|---|---|---|
| Transactions | `dailyTransactions` (dated rows) | complete |
| Income overrides | `monthlyIncomes: Record<month, number>` | complete |
| Payslips | `payslips: Record<month, MonthlyPayslip>` | complete |
| Salary steps | `SalaryEntry.effectiveDate` + `salaryAt(month)` (`src/lib/salary.ts`) | complete |
| Bonus/overtime/hours | `periodMonth` per entry | complete |
| Net-worth headline | `netWorthHistory: Record<month, number>`, editable via `NetWorthHistoryModal` | complete but editor is capped to a rolling 12 months |

**B. State snapshots** (point-in-time capture of live state):

| Data | Where | Status |
|---|---|---|
| Assets (incl. per-account savings), loan, pension, homeowner, transition, housingMode | `BalanceSnapshot` (`FinanceContext.tsx:648`), auto-captured for the current calendar month on any change (effect at `:1459`, structural-equality skip) | complete since 2026-07 |
| Non-mortgage debts | `BalanceSnapshot.debts?` | complete since debt historization; older snapshots render equity-only (documented) |
| Fixed expenses | not snapshotted | **gap** (historical envelopes use today's amounts; known BACKLOG limitation) |
| Forward assumptions (`savingsTargetPercent`, `growthReturnRate`, `houseGrowthRate`) | not snapshotted | **gap** (AssetPage history mode projects with live assumptions; BACKLOG "deepen the time machine" (b)) |
| Category budgets | not snapshotted | **gap** (minor; historical budget-vs-actual uses today's budgets) |

**C. Viewing layer today:**

- `useBalanceHistory` (`src/hooks/useBalanceHistory.ts`): steps through snapshot months +
  live; state is **per page**, so the month resets between Assets/Loan/Pension
  (BACKLOG (a)).
- `NetWorthCompositionChart` derives equity composition from snapshots via
  `computeEquityBreakdown` (the one true equity function, `src/lib/equity.ts`); this is the
  only true history chart.
- `LtvChart` (`src/components/charts/LtvChart.tsx`) is **forward projection only**: year 0
  is always "now"; no actual LTV history is drawn.
- No actual-vs-plan view exists for mortgage or debt paydown anywhere.
- Backfill: impossible. Snapshots exist only for months the app was open
  (the capture effect targets the real current month only), and there is no manual
  snapshot editor. `netWorthHistory` is hand-editable but only the headline number and only
  12 months back.

---

## 2. Architecture decision

**One monthly snapshot spine.** Keep `balanceSnapshots: Record<'yyyy-MM', BalanceSnapshot>`
as the single source of historical state and *extend its contents*, rather than adding
parallel per-metric series. Timeline data (section 1A) stays as-is; it is already correct.

Why not per-metric history maps (`houseValueHistory`, `equityHistory`, ...): each new map is
another persist site, another sanitize entry, another thing that can drift from the others
for the same month. Derived quantities (egenkapital, LTV, net worth) must be **computed from
the snapshot** through the same shared functions the live pages use
(`computeEquityBreakdown` precedent), never stored, or the stored copy will contradict the
recomputed one.

Why not event sourcing (record every edit as an event): massive overkill for a
single-JSON-blob app; monthly resolution matches every existing surface (month keys,
`currentMonthKey`, the picker).

Two consequences to accept and handle:

1. **Missed months stay missing.** If the app was never opened in a month, that month has no
   snapshot. Policy: the time machine only offers recorded months (already the
   `useBalanceHistory` contract: "never land on an empty month"); trend charts may
   interpolate across gaps (the `src/lib/netWorth.ts` interpolation precedent) but must mark
   interpolated points (the Dashboard's hollow-dot "estimated" pattern). Backfill (Phase 3)
   is the user-facing fix.
2. **Old snapshots lack new fields forever.** Every new snapshot field is optional, guarded
   at read time (`?? 0` / `?? live fallback with a "not recorded" marker`), following the
   `debts?` precedent and its doc comment. No migration fabricates data.

Add a version marker `v?: number` to `BalanceSnapshot` now (absent = v1) so future shape
changes can branch cleanly instead of sniffing fields.

---

## 3. Phase 1 — Snapshot completeness ✅ FINISHED (shipped, PR #31)

Everything a page needs to render a past month goes into the snapshot.

**3.1 Extend `BalanceSnapshot`** ✅ (`src/context/FinanceContext.tsx:648`):

```ts
export interface BalanceSnapshot {
  assets: Assets;
  loan: LoanData;
  pension: Pension;
  homeowner: HomeownerData;
  transition: TransitionData;
  housingMode: HousingMode;
  debts?: Debt[];
  /** New in v2 — all optional, absent on older snapshots. */
  v?: number;                       // 2
  fixedExpenses?: FixedExpense[];   // historical envelopes/budget composition
  assumptions?: {                   // forward assumptions as of that month
    savingsTargetPercent: number;
    growthReturnRate: number;
    houseGrowthRate: number;
  };
  categoryBudgets?: Partial<Record<CategoryKey, number>>;
  /** 'auto' (capture effect) vs 'manual' (backfill editor, Phase 3). */
  source?: 'auto' | 'manual';
}
```

Deliberately **not** snapshotted: salaries/jobs (already timelined; `salaryAt(month)` is
the correct historical read and PensionPage history should use it, see 5.3),
transactions/incomes/payslips (timelined), settings like language/currency (not financial),
bank connection state (server-side).

**3.2 Capture effect** ✅ (`FinanceContext.tsx:1459`): add the new fields to the snapshot
object and to the effect's dependency array. Round every kr value on capture
(`Math.round`) to keep the blob lean; the structural-equality skip (3.2 fix) already
prevents load-time dirtying and must be preserved.

**3.3 Persistence wiring**: `balanceSnapshots` is already a registered payload field, so
`payloadRegistry.ts` needs no new entry, but `sanitizePayload.ts` must coerce the new
nested numerics (extend the existing `balanceSnapshots` block that already handles
`assets` and `debts[]`; add `fixedExpenses[].amount`, `assumptions.*`,
`categoryBudgets` values). Demo data (`src/lib/demoData.ts`) seeds the new fields in its
6 months of snapshots so demo mode showcases the feature.

> **Deviation (3.2 rounding):** the "Math.round every kr on capture" step was *not*
> applied. The captured slices already hold integer kr from number inputs, so rounding is
> a no-op there; and blanket-rounding would (a) corrupt the rate/percent fields in
> `assumptions`/`loan` (e.g. 5.5% → 6), and (b) re-serialise every existing v1 snapshot to a
> different `stableStringify`, dirtying the blob once on the next plain open. New numeric
> fields come straight from already-clean state. Revisit only if blob size becomes a real
> concern (Phase 5 notes the escape hatch). ✅ 3.3 sanitize + demo done.

**3.4 Tests** ✅: extend the sanitize tests and the payload round-trip test with a v2
snapshot; a unit test that a v1 snapshot (no new fields) still renders through
`computeEquityBreakdown` and the new readers without NaN.

Verify: `npx tsc -b && npm run lint && npm test`, plus a throwaway-`DATA_DIR` POST
confirming the extended shape passes server validation. Blob growth estimate: a v2
snapshot is roughly 2 to 4 KB; 10 years of months is under 500 KB against the server's
2 MB warning, acceptable without pruning.

---

## 4. Phase 2 — History manager: backfill, edit, delete ✅ FINISHED (shipped + browser-verified, PR #31)

The single biggest user-facing gap: months from before the app (or missed months) cannot
be represented at all.

> **Shipped:** new `HistoryManagerModal` (mounted in Settings → Data management) with the
> month grid, add/edit/delete of manual snapshots, "add an earlier month" backfill, and the
> advanced fold defaulting from the nearest recorded month. New tested lib:
> `src/lib/snapshots.ts` (`nearestSnapshot`, `historyRows`, `buildManualSnapshot` — the last
> re-applies the house three-slice mirror so a backfilled month can't contradict itself) and
> `netWorthSeriesFrom` in `netWorth.ts`. Context gained `setManualSnapshot`/`deleteManualSnapshot`.
> **Deviation:** I built a *separate* `HistoryManagerModal` rather than destructively
> rewriting `NetWorthHistoryModal`; the scalar net-worth editor still exists on the Dashboard
> unchanged (its 12-month window not dropped). The manager supersedes it functionally and
> shows snapshot-derived net worth per month.
> **Follow-up ✅ (2026-07-10):** the scalar editor is now folded in — `HistoryManagerModal`
> rows without a snapshot expose an inline headline-net-worth field (writes `netWorthHistory`);
> the standalone `NetWorthHistoryModal` was deleted and the Dashboard "Edit history" button
> opens the manager. The rolling-12-month cap is gone (the manager backfills any month).

**4.1 Promote `NetWorthHistoryModal` into a History manager** ✅ (Settings or the Assets
page). A month-grid list showing every month from the earliest record to now, each row
marked: recorded (auto), recorded (manual), or missing. Actions per row:

- **Add / edit a manual snapshot**: a form covering only the *balances* a person can
  realistically reconstruct for a past month: per-account savings, BSU, buffer, portfolio
  value, crypto, house value, house debt, other debts (per debt), OTP/IPS balances.
  Everything else (loan params, assumptions, fixed expenses) defaults from the nearest
  *older* snapshot if one exists, else the nearest newer one, and is editable behind an
  "advanced" fold. Saved with `source: 'manual'`.
- **Delete** a manual snapshot (auto snapshots are not deletable; they re-capture).
- The headline `netWorthHistory` editor stays, but drops its 12-month window and, when a
  month has a snapshot, shows the snapshot-derived net worth as the reference value.

**4.2 Reconcile the two history stores.** ✅ `netWorthHistory[month]` and
"net worth computed from `balanceSnapshots[month]`" can disagree (the scalar is editable).
Rule: the snapshot is authoritative when it exists; `netWorthHistory` remains the
lightweight store for months with no snapshot (typically hand-backfilled headline values)
and for the pre-debt-historization era. Chart precedence: snapshot-derived value, else
`netWorthHistory`, else interpolation-with-marker. Implement as one tested selector in
`src/lib/netWorth.ts` (e.g. `netWorthSeriesFrom(snapshots, history, months)`) and route the
Dashboard hero series through it so there is exactly one precedence definition.

**4.3 Provenance** ✅: manual snapshots get the existing `ProvenanceBadge` treatment in the
time machine ("entered by you" vs "recorded"), reusing `src/lib/provenance.ts` patterns.

Verify: gate + unit tests for the precedence selector and the nearest-snapshot defaulting;
browser smoke: backfill three months, step to them on Assets/Loan/Pension, values match
what was entered, live month unaffected.

---

## 5. Phase 3 — One time machine everywhere ✅ FINISHED (incl. 5.2)

> **Shipped:** 5.1 stepper state lifted to `FinanceContext` (`historyMonth: string | null`
> slice; `useBalanceHistory` reads it, same interface), so the picked month carries across
> Assets/Loan/Pension. 5.2 header-picker merge ✅: the header month control now drives the
> balance-page time machine directly (steps recorded months, read-only chip with lock +
> "today"); the per-page `BalanceHistoryBar` was removed (component deleted). 5.3 leaks
> closed: AssetPage projections use the snapshot's `assumptions` + mortgage rate/term (v1 →
> live fallback); PensionPage pensionable income resolves at the *viewed* month via
> `calcActiveGrossAnnual(...,activeKey)`. 5.4 read-only affordance now lives in the header.
> **Follow-up ✅ (2026-07-10):** BudgetPage past-month envelope math now uses
> `snapshot.fixedExpenses` — see the single-shared-month follow-up in the STATUS banner. The
> Budget/Dashboard `currentMonth` and the balance-page month are now the same slice.

**5.1 Lift the stepper state.** ✅ Replace the per-page `useState` in `useBalanceHistory`
with shared state in `FinanceContext` (a `historyMonth: string | null` slice; null = live).
The hook keeps its exact interface so Assets/Loan/Pension need no rendering changes; the
selected month now carries across pages (BACKLOG "deepen the time machine" (a)).

**5.2 Merge with the header month picker.** Today two month models coexist: the
Dashboard/Budget `currentMonth` picker (`MONTH_SCOPED_ROUTES` in
`src/components/Layout.tsx`) and the balance-page stepper. Unify presentation: the header
picker becomes the single month control on all money pages; on balance pages it drives
`historyMonth` (stepping only through recorded months, keeping the "never land on an empty
month" contract), on Dashboard/Budget it keeps driving `currentMonth`. One visible model
for the user: "the app shows month X". This also fixes the BACKLOG note that
`recommendedInvestment` reflects a stale hidden month.

**5.3 Close the remaining live-data leaks in history mode**:

- AssetPage projections: use `snapshot.assumptions` (and the snapshot's mortgage
  rate/term) instead of live values when time-travelling; absent on v1 snapshots, show the
  existing "not recorded" muted treatment instead of projecting (BACKLOG (b)).
- PensionPage contributions: compute from `salaryAt(historyMonth)` and the snapshot's
  pension percentages instead of live salaries (BACKLOG (c)).
- BudgetPage past months: use `snapshot.fixedExpenses` for envelope math when available
  (closes the BACKLOG envelope limitation "time-versioned fixed-expense amounts"); fall
  back to live amounts with the muted marker when absent.
- Audit every history-mode surface for a live read the way §4.5 of `IMPROVEMENTS.md` did
  for debts (that item is the template: gate on `hist.isLive`, hide editors).

**5.4 Read-only rule**: history mode hides or disables every editor (the DebtSection
pattern at `AssetPage.tsx:482`), and the header shows a persistent "viewing <month>,
read-only" chip with one-tap return to live.

Verify: gate + browser pass: pick a month on Assets, navigate to Loan and Pension, same
month is shown; edit attempts impossible; return-to-live restores editing.

---

## 6. Phase 4 — Derived history surfaces (the visible payoff) ✅ ALL SHIPPED (6.1–6.5)

All computed from snapshots + timelines through shared lib functions; nothing stored twice.

> **Shipped:** 6.3 nedbetaling plan-vs-actual (`src/lib/paydown.ts` + tests;
> `PaydownVsPlanChart` on LoanPage, ahead/behind readout + principal/interest paid). 6.2
> LtvChart now prepends actual LTV per recorded month (solid) with the projection continuing
> from the latest actual (dashed); house-value line skipped (dual-axis clutter). 6.1
> `equitySeriesFrom` (`equity.ts` + tests) + `EquityHistoryTable` on AssetPage (per-month
> buckets + MoM total delta). 6.4 `debtPaydownVsPlan` (`debt.ts` + tests) +
> `DebtPaydownVsPlanChart` in DebtSection (actual debt vs the minimums-only payoff plan). 6.5
> `savingsSeriesFrom`/`pensionSeriesFrom` (`snapshotSeries.ts` + tests) + `SavingsHistoryChart`
> (per-account, AssetPage) and `PensionHistoryChart` (OTP/IPS, PensionPage). Demo's 6 snapshot
> months feed all of them; all browser-verified, 0 console errors, finite-guarded.

**6.1 Egenkapital** ✅: `NetWorthCompositionChart` already charts composition over time. Add
on AssetPage: per-bucket month-over-month and 12-month deltas (stocks/house/crypto/cash),
and a small history table of `computeEquityBreakdown` per recorded month. Lib:
`equitySeriesFrom(snapshots)` in `src/lib/equity.ts`, tested.

**6.2 Bolig** ✅ (house-value line skipped): extend `LtvChart` to prepend **actual** history: for each recorded month,
LTV = snapshot `houseDebt / houseValue`; the projection continues from the latest actual
point instead of always starting at "now". Solid line for actuals, dashed for projection
(the app's existing estimated-vs-actual visual language). Add a house-value history line
(snapshot `houseValue` over months) so appreciation assumptions can be sanity-checked
against reality.

**6.3 Nedbetaling (mortgage, the headline feature)** ✅: a new "plan vs actual" module on
LoanPage:

- Plan: `calcAmortizationSchedule` anchored at the *earliest recorded* mortgage balance
  (first snapshot with `homeowner.currentMortgageBalance > 0`), using that snapshot's rate
  and term (v2) or live ones (v1 fallback, marked).
- Actual: snapshot `currentMortgageBalance` per month (homeowner mode) or
  `assets.houseDebt` (kept in lockstep by the existing three-slice mirror).
- Readout: "ahead of / behind plan by X kr (≈ N months)", plus cumulative principal paid
  and estimated interest paid to date.
- Lib: `paydownVsPlan(snapshots, schedule)` in `src/lib/debt.ts` or a new
  `src/lib/paydown.ts`, unit-tested (ahead, behind, exactly-on, single-snapshot, and
  missing-months cases).

**6.4 Non-mortgage debt payoff** ✅: same pattern against `planPayoff`: per-debt actual
balance from `snapshot.debts` vs the plan curve, surfaced in DebtSection.

**6.5 Savings and pension trends** ✅: per-account savings history (snapshot
`savingsAccounts` rows match by `id`) as a small multi-line chart on AssetPage;
OTP/IPS balance history on PensionPage next to the projection so "projected vs actually
grew" is visible.

Verify per chart: gate + `make build` + browser smoke in demo mode (demo seeds 6 months of
snapshots, extend the seed so every new surface has visible data), 0 console errors, and
the CLAUDE.md NaN rule: every division guarded (months with `houseValue: 0` must not
produce NaN LTV).

---

## 7b. Browser verification (2026-07-09) ✅

Full end-to-end browser pass against a throwaway Docker instance (isolated volume,
demo data), 0 console errors throughout:
- **History manager**: month grid, add/edit/save/delete, "add earlier month" backfill,
  live net-worth preview recompute, advanced-fold assumptions. Row badges corrected to
  Live / Recorded / Entered-by-you / Not-recorded (was reusing ProvenanceBadge, which read
  "Default" for real recorded months — fixed in a follow-up commit).
- **Nedbetaling plan-vs-actual**: readout (ahead/behind, principal, interest) + chart; math
  cross-checked against the demo's 8 000/mo paydown vs the plan's ~4 660/mo principal.
- **Egenkapital table**: buckets sum to total, MoM deltas; equity (1 744 239) vs History
  manager net worth (1 362 739) differ by exactly the demo non-mortgage debt (381 500) ✓.
- **LtvChart**: actual (solid) + projected (dashed) series both render.
- **Time machine**: month picked on Assets carries to Loan, both read-only ✓.
- **Dashboard hero** 1 362 739 kr == snapshot-derived net worth (precedence selector holds).
- **Write path**: POST→GET round-trip of a v2 manual snapshot persists the house three-slice
  mirror, assumptions and fixed expenses (Docker volume; host-sandbox SQLite block was the
  earlier false alarm).

## 7. Phase 5 — Data safety, scale, compat ✅ VERIFIED

> **Verified:** sanitize depth unchanged after phases 2-4 (they add no persisted snapshot
> fields — the derived surfaces only *read* snapshots); downgrade safety proven by a new
> round-trip test (`payloadRegistry.test.ts` "passes unknown/future snapshot fields through
> verbatim") — snapshots are stored/re-applied as whole objects, never field-projected, so
> `migrateSnapshotSavings`'s `{...snap}` spread preserves v2 and future fields; demo-coverage
> partition unaffected (no new top-level payload fields); capture-effect structural-equality
> skip untouched. Size: rounding-on-capture deliberately skipped (see §3.2 deviation).

- **Sanitize depth**: every new numeric enters through the `balanceSnapshots` block of
  `sanitizePayload.ts` (Phase 1 does this; re-verify after Phases 2 to 4 add fields).
- **Downgrade safety**: an older client's `applyPayload` passes unknown snapshot fields
  through verbatim (snapshots are stored as objects, not field-projected). Verify with a
  round-trip test: v2 snapshot in, older reader path, v2 fields survive the re-save. If
  the registry projection strips them, fix the registry to pass `balanceSnapshots`
  through whole. This is the one real data-loss risk in the plan; test it first.
- **Size**: values rounded on capture; if the blob ever approaches the 2 MB server warning,
  the escape hatch is dropping `transition`/`loan` from snapshots older than N years (they
  are what-if inputs, not balances). Not built now; noted so nobody stores unrounded floats.
- **`resetAll` / demo / export**: snapshots already flow through the payload registry, so
  reset/demo/export need only the Phase 1 field additions. The demo-coverage test
  (personal/preference partition) must include the new fields.
- **Concurrency**: the capture effect's structural-equality skip and the no-op-save guard
  (IMPROVEMENTS §3.2) already prevent snapshot writes from dirtying idle clients; keep both
  intact when touching the effect.

---

## 8. Sequencing, effort, and what this absorbs

Order: **Phase 1 → 2 → 3 → 4 (6.3 first) → 5 checks continuously**. Each phase is
independently shippable and gate-verified; Phase 4 items are individually shippable charts.

Rough effort: Phase 1 one focused PR; Phase 2 one to two PRs (the manager UI is the bulk);
Phase 3 two PRs (state lift, then leak-closing sweep); Phase 4 one PR per surface
(6.3 nedbetaling first, it is the most-asked-for number); Phase 5 rides along.

This plan absorbs and would close these existing BACKLOG entries: "Deepen the time
machine" (a) stepper lifting, (b) live forward assumptions, (c) pension live salaries,
(d) hand-entered historical breakdowns; "Net-worth history editor covers a rolling
12-month window"; the envelope follow-up "Time-versioned fixed-expense amounts"; and the
known limitation note about pre-debt equity-only history (unchanged but restated in the
precedence rule, 4.2).

## 9. Open questions (answer before Phase 2/3; Phase 1 is unaffected)

1. **Backfill depth**: unlimited past months, or cap at some horizon (e.g. 10 years)?
   Plan assumes unlimited; the month-grid UI just needs a sane default scroll.
2. **Salary/Forecast month-scoping**: should Salary and Forecast also follow the unified
   month (read-only historical view of "salary as of month X"), or stay always-live?
   Plan assumes balance pages + Budget/Dashboard first, Salary/Forecast later if wanted.
3. **Category budgets in snapshots**: include (historical budget-vs-actual accuracy) or
   skip (minor surface)? Plan includes them since the cost is one optional field.
