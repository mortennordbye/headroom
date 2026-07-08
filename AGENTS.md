# AGENTS.md

Guidance for coding agents (Claude Code and others) working in this repository.
See `CLAUDE.md` for the fuller working approach and safety rules; this file is the
quick command reference.

## Commands

| Task | Command |
| ---- | ------- |
| Install | `npm ci` |
| Typecheck | `npx tsc -b` |
| Lint | `npm run lint` |
| Test | `npm test` (single file: `npx vitest run src/lib/debt.test.ts`) |
| Build + run (Docker) | `make build` → http://localhost:8080 |
| Before reporting done | `npx tsc -b && npm run lint && npm test` |

The app is normally run and tested in Docker (`make build` / `make up` / `make down`),
not local Vite. A pure-local path exists: `node server/index.js` + `npm run dev`.

## Layout

- `server/` — Express API, SSB inflation fetch, SQLite, seed, docker-entrypoint.
- `src/context/` — `FinanceContext`, single source of app state + i18n table.
- `src/lib/` — pure calc/domain logic + Vitest tests (tax, loan, debt, equity).
- `src/pages/` — one component per route.
- `src/components/` — shared UI (modals, charts, sections) + `ui/` primitives.
- `src/hooks/` — small shared hooks.

## Conventions

- Commits follow Conventional Commits (`type(scope): summary`).
- All app state is one JSON blob; there is no per-field API. When adding persisted
  state, update every payload site in `FinanceContext.tsx` (see CLAUDE.md).
- This is a money-math app: guard divisions and array lookups; put financial formulas
  in `src/lib/` with unit tests, never inline in page components.
- Use CSS design tokens (`var(--accent)`, ...), never raw hex. Keep user-facing strings
  in the translations table, never branch JSX copy on `lang`.
- Never POST test payloads to the running app; the volume holds real financial data.
- Never commit secrets or credentials.
