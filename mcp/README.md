# Headroom MCP server

A local [Model Context Protocol](https://modelcontextprotocol.io) server that lets
an AI (Claude Desktop, Claude Code, …) read your Headroom financial data, compute
insights, and make guarded changes. It runs on your machine over **stdio** and
talks to the running app's local HTTP API — no network exposure, no new ports.

## How it works

- **Reads and writes go through the app's `/api/data`**, never SQLite directly, so
  every write inherits the server-side guards (payload validation, optimistic-
  concurrency `rev`, bank-transaction reconcile, user-field preserve).
- **Insight math is the app's own tested `src/lib` code** — the tools reproduce the
  exact derivations the UI uses (`mcp/derive.ts`), so the numbers match the app.
- Runs via `tsx` (no build step): `npm run mcp`.

## Configuration (env)

| Var | Default | Meaning |
| --- | --- | --- |
| `HEADROOM_URL` | `http://localhost:8080` | Origin of the running app. Use `:3001` for the local `node server/index.js` path. |
| `HEADROOM_PASSWORD` | _(unset)_ | Only needed if the app has auth enabled; the server logs in once and reuses the session cookie. |

## Wiring it into a client

### Claude Code (`.mcp.json` in the repo root, or `claude mcp add`)

```json
{
  "mcpServers": {
    "headroom": {
      "command": "npx",
      "args": ["tsx", "mcp/server.ts"],
      "env": { "HEADROOM_URL": "http://localhost:8080" }
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)

Use absolute paths (Desktop does not run from the repo):

```json
{
  "mcpServers": {
    "headroom": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/headroom/mcp/server.ts"],
      "env": { "HEADROOM_URL": "http://localhost:8080" }
    }
  }
}
```

Start the app first (`make up`), then start/restart the client.

## HTTP transport (for remote / web clients)

`npm run mcp` speaks **stdio** — perfect for a local desktop client, but a web
connector (e.g. a claude.ai remote MCP) needs HTTP. `npm run mcp:http` serves the
exact same tools (shared `createServer()`) over the MCP **Streamable HTTP**
transport, stateless, at `POST /mcp`.

It is network-reachable, so it is locked down by default:

| Var | Default | Meaning |
| --- | --- | --- |
| `HEADROOM_MCP_TOKEN` | _(required)_ | Bearer token every request must send (`Authorization: Bearer …`). The server **refuses to start** without it. |
| `HEADROOM_MCP_HOST` | `127.0.0.1` | Bind address. Keep it loopback; only widen behind a TLS-terminating reverse proxy / VPN you control. |
| `HEADROOM_MCP_PORT` | `3900` | Listen port. |

Plus `HEADROOM_URL` / `HEADROOM_PASSWORD` as above (it still reads/writes through
the app's `/api/data`).

```bash
HEADROOM_MCP_TOKEN=$(openssl rand -hex 32) npm run mcp:http
```

Baked-in guards: constant-time token check, DNS-rebinding protection, a 1 MB body
cap, and a fixed-window rate limit (120 req/min per IP). There is **no TLS here** —
the token is the only credential, so terminate TLS in front of it if you expose it
beyond loopback. On a shared/remote deploy, gate it behind the app's own auth
(`AUTH_PLAN.md`) too.

## Tools

**Read (safe, read-only):**

| Tool | What it returns |
| --- | --- |
| `get_overview` | Net worth, gross income, equity breakdown, debt-to-income, mortgage status |
| `get_budget_summary` | Income vs fixed/variable, per-type fixed totals, 12-month cashflow, savings-rate status |
| `get_spending_analysis` | Spend by category (own-account transfers netted out), month-over-month, budget-vs-actual, top insight, untracked recurring |
| `get_debt_analysis` | Avalanche/snowball payoff, baseline vs extra payment (months + interest saved) |
| `get_savings_and_goals` | Emergency-fund adequacy (two measures), buffer recommendation, per-goal progress |
| `get_recommendations` | Budget plan, savings-rate status, history-based insights |
| `get_year_review` | Annual review for a calendar year: income, tax paid, savings rate, top categories, net-worth change (`year` optional) |
| `what_if` | `prepay_vs_invest` or `extra_debt_payment` scenarios |
| `list_history` | Recent saved revisions (newest first) with timestamps and sizes |
| `get_history_revision` | The full dataset as it was at a past revision |
| `get_raw_data` | The full app-state blob (escape hatch) |

**Write (guarded; each does a rev-checked read-modify-write and returns a before/after diff):**

`set_category_budget`, `add_goal`, `update_goal`, `add_fixed_expense`,
`update_fixed_expense`, `update_assumptions`, `set_ai_context`, `restore_revision`.

`get_overview` includes a `notes` field — the user's free-text plans/goals context
(editable in Settings → "Context for the AI assistant"); `set_ai_context` writes it.

Write tools are annotated `destructiveHint`/`idempotentHint` so clients can prompt
for confirmation. They change exactly one blob slice and leave everything else
byte-identical.

## Revision history / undo

Every write is snapshotted server-side into a `finance_history` table in the data
volume (the newest 20 revisions, pruned automatically) — separate from the data
blob, so it can't be clobbered by a save and never leaks into exports. This is a
fine-grained undo net on top of the coarse nightly `.sqlite` backups.

The AI can `list_history` to see recent changes, `get_history_revision` to inspect
what a past state looked like, and `restore_revision` to roll back — and because a
restore is itself recorded as a new revision, it can be undone too. Same endpoints
back the `/api/history*` routes if you want to build UI on them.

## Tests

`npx vitest run mcp/tools.test.ts` — pure-derivation tests plus a live round-trip
against a **throwaway** server (`DATA_DIR=$(mktemp -d)`), never your real data.
