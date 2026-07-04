# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working approach

These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### Think before coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### Simplicity first

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### Surgical changes

Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

### Goal-driven execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

### Track unfinished work in BACKLOG.md

If you leave anything unfinished, partially implemented, or explicitly defer it, add an entry to `BACKLOG.md` in the repo root before reporting the task done. Don't bury deferrals in chat — they vanish next session.

Each entry needs four things: **what** the work is, **why** it was deferred, **what would unblock it**, and **where** the relevant code lives (file paths). Read existing entries for the format.

Don't put work-in-progress on `BACKLOG.md` — WIP belongs on a branch. The backlog is for *known gaps the team has agreed to leave for later*. If you finish an item, delete it.

What counts as "unfinished":
- Tier 1 / Tier 2 splits where you only shipped Tier 1.
- Out-of-scope items you noticed but didn't fix.
- Features behind a feature flag that still need ramping or cleanup.
- Tests skipped, mocks left in, debug logging not yet stripped.
- TODO comments you wrote (write the entry instead — TODOs rot in code).

What does NOT belong:
- Forward-looking ideas the user didn't agree to defer ("we could also..."). Either do them or drop them.
- Codebase-wide debts that pre-existed your work and the user didn't ask you to track.

These guidelines are working if: fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Development

**Docker-first.** The app is normally run and tested in Docker, not local Vite:

```bash
make build     # build image + start (rebuilds if running) → http://localhost:8080
make up        # start without rebuilding
make down      # stop
make restart   # restart without rebuilding
make seed      # seed the volume with demo data (idempotent)
make backup    # copy the SQLite DB out to ./backups/
```

> **Service-worker cache gotcha:** the PWA precaches the app shell. After `make build`, a browser with the app open serves the *old* cached version until the "new version" prompt is accepted (or the SW is cleared / hard-reloaded). If a UI change "doesn't show up", it's almost always this — accept the update prompt or clear the SW, don't assume the build failed.

A pure-local path also exists (see README "Local development"): `node server/index.js` + `npm run dev` (Vite proxies `/api` → `:3001`).

Tests: `npm test` (Vitest, run once), `npm run test:watch`, or a single file `npx vitest run src/lib/debt.test.ts`. Lint: `npm run lint`.

## Before reporting a task complete

Run, and make pass:

```bash
npx tsc -b && npm run lint && npm test
```

For changes with runtime UI surface, also `make build` and smoke-test the affected page in the browser (0 console errors). Remember the SW cache gotcha above when verifying UI changes.

## Architecture

- **Frontend:** React 19 + TypeScript + Vite, Tailwind CSS v4, Recharts, `vite-plugin-pwa`. SPA with route-level code splitting (`src/App.tsx`).
- **Backend:** Node + Express (`server/index.js`), serving the built SPA and a tiny JSON API.
- **Storage:** SQLite via `better-sqlite3`, a **single row** holding the entire app state as one JSON blob.
- **Deployment:** one Docker image (multi-stage), data in a named volume `headroom_data`. No authentication — single-user, loopback-bound by default (see README "Security").

### Data flow rules

- **All app state is one JSON blob.** `GET /api/data` returns it; `POST /api/data` overwrites it wholesale (last-write-wins, single row keyed `'headroom'`). There is no per-field API.
- The client loads once into `FinanceContext` (`src/context/FinanceContext.tsx`) and auto-saves the whole blob (debounced) on any change. `POST` is only enabled after a successful load, so empty defaults can't clobber real data; demo mode never persists.
- The persist/export payload shape is currently hand-maintained in several places in `FinanceContext.tsx` — when you add a piece of persisted state, update **every** site (autosave payload + its dep array, `applyData`, `importAll`, demo snapshot, and `SettingsPage` export) or it silently drops from backup/restore.
- **The volume holds the user's real financial data.** Never POST test payloads to the running app to exercise write paths — use a throwaway `DATA_DIR` (`DATA_DIR=$(mktemp -d) PORT=3999 node server/index.js`). GET/read-only checks against the live app are fine.

### Safety rules for AI-assisted changes

- This is a money-math app: the highest-risk bug class is `undefined`/`NaN` leaking into arithmetic and rendering in a chart. Guard divisions and array lookups; prefer the shared helpers.
- **Pure calculation logic lives in `src/lib/` and must have unit tests.** Don't inline financial formulas into page components — reuse `calcMonthlyPayment`, `calcNorwegianTax`, `parseLocaleNumber`, `currentMonthKey`, etc. Tax constants are year-keyed in `norwegianTax.ts` (`TAX_PARAMS[TAX_YEAR]`).
- `POST /api/data` shape-validates the payload; keep that guard when touching the endpoint.

### Environment variables

- `DATA_DIR` (server): where SQLite lives (default `../data`, `/data` in Docker). `PORT` (server, default 3001). No `.env` schema — these are the only two.

### Directory layout

```
server/           Express API, SSB inflation fetch, SQLite, seed, docker-entrypoint
src/
├── context/      FinanceContext — single source of app state + i18n table
├── lib/          Pure calc/domain logic + Vitest tests (tax, loan, debt, equity, validators)
├── pages/        One component per route (Budget, Dashboard, Assets, Loan, Salary, Forecast, …)
├── components/   Shared UI (modals, charts, sections) + ui/ primitives
└── hooks/        Small shared hooks
```

### UI rules

- **Use CSS design tokens, never raw hex.** Colours come from CSS custom properties (`var(--accent)`, `var(--text-2)`, `var(--chart-*)`, etc.) defined in `src/index.css`. Don't hardcode hex values in components.
- **Never branch JSX copy on `lang`.** User-facing strings belong in the translations table in `FinanceContext.tsx`; `lang` should only select the locale, not appear in component JSX. (There is legacy `lang === 'nb' ? … : …` code being migrated out — don't add more.)
- Respect `prefers-reduced-motion` and `:focus-visible` (handled globally).

### Code quality

- **Reuse before adding** — check shared utilities and components before writing new ones.
- **No dead code** — if a button has no handler, implement or remove it.
- **No premature abstractions** — only extract a helper when it's used in 2+ places.
