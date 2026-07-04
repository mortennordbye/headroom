# Headroom — App Audit (2026-07-04)

Full audit of backend/security/deployment, financial-calculation correctness, frontend
architecture, UX/accessibility, PWA behavior, and tooling.

**Status: closed out.** All findings below were fixed and verified (strict `tsc` + lint +
47 Vitest tests + Docker rebuild + in-browser smoke test on the real dataset). The larger
architecture refactors and persistence-backbone work that remain are tracked in
`BACKLOG.md` under "Audit (2026-07-04) — deferred architecture & data-safety items".

Severity: 🔴 high · 🟡 medium · 🟢 low

## Resolved

**1. Data safety & persistence**
- ✅ §1.1 🔴 Save failures surfaced — debounced auto-save with `res.ok` check, in-flight abort, backoff retry, a "changes not saved" banner + `beforeunload` guard, tab-hide flush via `sendBeacon`; server raised the body limit to 10 MB with a size warning.
- ✅ §1.2 🔴 Debounce/abort/flush landed with §1.1; `currentMonth` no longer persisted (view state — no longer fires saves or fights across devices).
- ✅ §1.4 🟡 `POST /api/data` shape-validates the payload → 400 on garbage / undefined body.
- ✅ §1.6 🟡 `make backup` target + README restore docs; `backups/` gitignored.

**2. Security & deployment**
- ✅ §2.1 🔴 Compose + README bind `127.0.0.1`; README "Security" section (no-auth-by-design).
- ✅ §2.2 🟡 Runs as non-root `node` via a `su-exec` entrypoint that fixes pre-existing root-owned volume ownership.
- ✅ §2.3 🟡 Base images → `node:22-alpine` (Node 20 was EOL).
- ✅ §2.4 🟢 Build toolchain installed `--virtual` and dropped after `npm ci`.
- ✅ §2.5 🟢 `/healthz` (`SELECT 1`) + compose `healthcheck`.
- ✅ §2.6 🟢 SSB fetch bounded with `AbortSignal.timeout(10s)`.
- ✅ §2.7 🟢 `helmet` headers + a tailored CSP + a Host-header allowlist (`ALLOWED_HOSTS`, DNS-rebinding guard).
- ✅ §2.8 🟢 `.dockerignore` mirrors gitignored artifacts + docs + test files.

**3. Financial correctness**
- ✅ §3.1 🔴 Tax constants → year-keyed `TAX_PARAMS[TAX_YEAR]`; `personfradrag` corrected to the 2025 value (108 550).
- ✅ §3.2 🔴 LoanPage uses shared `calcMonthlyPayment` (term-0 guard); `editNum` rejects negatives.
- ✅ §3.3 🟡 `DailyTransaction.kind` — income excluded from spent/burn/category charts, adds to balance; dropped `inntekt` substring matching; "Type" selector in the modal.
- ✅ §3.4 🟡 Dashboard hero chip + subtitle now show net-equity MoM (from `netWorthSeries`), not income.
- ✅ §3.5 🟡 `averageIncome`/`incomeVolatility` average a real last-12-months series; volatility divides by the exact mean.
- ✅ §3.6 🟡 ForecastPage falls back to `income * 12`, not a fabricated 800 000.
- ✅ §3.7 🟡 ForecastPage mortgage track selects balance/rate/term by `housingMode` (+ 0%-rate linear payoff).
- ✅ §3.8 🟡 Mortgage balance kept in lockstep in homeowner mode (`assets.houseDebt` ↔ `homeowner.currentMortgageBalance`).
- ✅ §3.9 🟢 Shared local-time `currentMonthKey()` replaces UTC `toISOString().slice(0,7)`.
- ✅ §3.10 🟢 Amortization `annualPayment` = principal + interest (payoff year no longer overstated).
- ✅ §3.11 🟢 `calcHouseEquityByYear` carries `houseDebt` forward when there's no schedule.
- ✅ §3.12 🟢 `planPayoff` returns `Infinity` on timeout (formats as "aldri/never").
- ✅ §3.13 🟢 Shared `parseLocaleNumber` (comma decimals, rejects trailing garbage) across validators + save handlers.
- ✅ §3.14 🟢 Investment tile: month derived from `currentMonth`, honest "savings rate" label (dropped fake "mål nådd" + target-as-delta chip).

**4. Architecture & maintainability**
- ✅ §4.6 🟢 Local `Card` → shared `ui/StatCard` (no longer shadows `ui/Card`).
- → §4.1–§4.5 deferred to `BACKLOG.md` (context memoization, payload consolidation, i18n unification, page→lib logic, chart-system unification).

**5. Type safety, testing & CI**
- ✅ §5.1 🔴 TypeScript `strict` enabled in both tsconfigs — clean `tsc -b` passes.
- ✅ §5.2 🔴 Vitest suite (`npm test`) — 47 tests over `norwegianTax`, `calculations`, `debt`, `validators`.
- ✅ §5.3 🟡 CI runs typecheck + lint + test in a `verify` job that gates the Docker build (npm cache, concurrency, least-privilege perms).
- ✅ §5.4 🟢 `react-router-dom` moved to runtime `dependencies`.
- ◻︎ §5.5 🟢 `no-unused-vars` configured; deeper ESLint (type-checked rules, jsx-a11y, hooks) → `BACKLOG.md`.

**6. Accessibility**
- ✅ §6.1 🔴 Modals get dialog semantics + focus trap + Escape via a shared `useFocusTrap` hook; `htmlFor`/`id` labels.
- ✅ §6.2 🟡 Icon-only buttons swept for translated `aria-label`s (added `add`/`edit` to the table).
- ✅ §6.3 🟡 Clickable `<span>`s → `<button>` (keyboard-operable).
- ✅ §6.4 🟡 `--text-dim` lightened to meet WCAG 4.5:1.

**7. PWA & performance**
- ✅ §7.1 🟡 SW update polling — hourly + on `visibilitychange`.
- ✅ §7.3 🟢 Recharts split out of the default-route chunk via a lazy `BudgetDistributionChart`.
- → §7.2 🟡 Self-host fonts / offline read-only data → `BACKLOG.md`.

**8. Docs & developer experience**
- ✅ §8.1 🟢 README "Local development" section.
- ✅ §8.2 🟢 CLAUDE.md project sections filled (Docker workflow, SW-cache gotcha, single-blob data-flow rule, CSS-token/no-`lang`-in-JSX UI rules).

## Deferred (tracked in BACKLOG.md)

§4.1 context memoization · §4.2 payload consolidation · §4.3 i18n unification · §4.4 page→lib
domain logic · §4.5 chart-system unification · §1.3 concurrent-write conflict detection ·
§1.5 import sanitize · §7.2 self-host fonts / offline data · §5.5 deeper ESLint.

## Healthy things worth keeping (verified, no action)

- Prepared statements everywhere; no SQL injection surface; `/api/inflation` strictly validates params.
- SSB caching design is solid (30-day TTL, YoY padding, transaction-wrapped upserts, stale fallback).
- Load-retry logic refuses to enable auto-save until a load succeeds — prevents empty defaults from
  clobbering real data; demo mode is blocked from persisting.
- The `/assets/` 404 guard before the SPA fallback prevents the stale-chunk blank-screen failure mode.
- Destructive actions are properly confirmed (delete modals, two-step reset, import preview + warning,
  demo mode snapshots real data first).
- `prefers-reduced-motion` and `:focus-visible` handled globally; manifest + iOS meta complete.
- Repo hygiene: the real database, Playwright artifacts, and scratch screenshots are all untracked; no
  secrets in the codebase; zero explicit `any` in ~13 k lines.
