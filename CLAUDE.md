# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Blueprint note:** Sections under "Working approach" are project-agnostic — keep them as-is. Sections after that contain `<!-- TODO -->` placeholders to fill in for this specific project. Delete this note once filled in.

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

<!-- TODO: How to run the dev environment for this project.
Examples to adapt:
- `npm run dev` / `pnpm dev` / `yarn dev`
- `cargo run` / `go run ./...` / `python -m uvicorn app:app --reload`
- Docker: `docker compose up` or a wrapper script (`./scripts/dev.sh`)
- Required env vars — point to `.env.example`
- How to run tests: full suite, watch mode, single file, single test by name
-->

```bash
# dev:    <command to start the app locally>
# test:   <command to run the test suite>
# watch:  <command for watch mode, if applicable>
```

## Before reporting a task complete

<!-- TODO: The single command (or short list) that must pass before declaring a task done.
Examples:
- `pnpm verify`  (typecheck + lint + tests)
- `cargo test && cargo clippy -- -D warnings`
- `make check`
- `go test ./... && golangci-lint run`

Run it even when the change "looks obviously correct" — the bugs that slip through are the unexpected ones.
-->

<!-- Optional: pre-commit / pre-push hooks (lefthook, husky, pre-commit, etc.).
Note how to install them and what they run, so the AI doesn't bypass them by accident. -->

<!-- Optional: end-to-end / smoke test protocol for critical user flows.
List the flows worth covering, the tools (Playwright MCP, Cypress, manual checklist),
and the steps. State skip rules: doc-only, test-only, dependency bump, formatting changes. -->

## Architecture

<!-- TODO: Short description of the stack and overall shape. Keep it tight — link out to deeper docs rather than duplicating them.
- Language(s) and runtime
- Framework
- Data layer (DB, ORM, validation library)
- UI layer if applicable
- Deployment target
-->

### Data flow rules

<!-- TODO: How data moves through this project. Examples:
- Where reads happen (Server Components, loaders, controllers, handlers)
- Where writes happen (Server Actions, REST routes, RPC, message handlers)
- Validation boundaries (every input parsed by a schema before touching storage)
- Type-inference patterns (e.g. infer from schema, don't redefine)
- Standard return / result type for handlers
-->

### Safety rules for AI-assisted changes

<!-- TODO: Project-specific guardrails. Examples:
- Auth helper that must wrap every endpoint/action
- Multi-tenancy: every query filters by tenant/user
- Never accept identity as a parameter — read it from the session
- Logging conventions: tagged, no secrets, no raw user input
- Never copy from a random existing handler — copy from a known-safe template
-->

<!-- Optional: include a canonical code template (e.g. handler/action/controller shape)
so AI changes always start from a safe baseline rather than a drifted older example. -->

### Environment variables

<!-- TODO: How env vars are read and validated. Examples:
- Centralized validated module (e.g. `@/lib/env`) — never `process.env` in app code
- How to add a new var (extend the schema + `.env.example`)
- Build-time vs runtime validation behaviour
- Where CLI scripts are allowed to differ
-->

### Directory layout

<!-- TODO: Shallow tree of the main directories with one-line descriptions.
Only the directories that matter for orientation — not every folder. -->

```
src/
├── ...
```

### Key patterns

<!-- TODO: Project-specific idioms a newcomer (or AI) needs to know. Examples:
- State containers / contexts
- Shared formatters or utilities and where they live
- Drag-and-drop, animation, or other library conventions
- Cache invalidation / revalidation pattern
-->

### UI rules

<!-- Optional: design constraints. Examples:
- Minimum touch target size
- Tap vs hover feedback
- Primary action placement
- Header / nav layout conventions
-->

### Code quality

- **Reuse before adding** — check shared utilities and components before writing new ones.
- **No dead code** — if a button has no handler, implement or remove it.
- **No premature abstractions** — only extract a helper when it's used in 2+ places.
