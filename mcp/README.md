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
| `get_budget_summary` | Net income vs fixed/variable, per-type fixed totals, this month's savings transfers (and any one-month adjustment), 12-month cashflow, savings-rate status |
| `get_spending_analysis` | Spend by category (own-account transfers netted out), month-over-month, budget-vs-actual, top insight, untracked recurring |
| `get_debt_analysis` | Avalanche/snowball payoff, baseline vs extra payment (months + interest saved) |
| `get_savings_and_goals` | Emergency-fund adequacy (two measures), buffer recommendation, per-goal progress |
| `get_recommendations` | Budget plan, savings-rate status, history-based insights |
| `get_year_review` | Annual review for a calendar year: income, tax paid, savings rate, top categories, net-worth change (`year` optional) |
| `get_salary_and_tax` | Active jobs, gross, full tax breakdown with deductions, marginal rate, derived vs effective net monthly, payslip, restskatt estimate, salary/bonus/overtime history (`month` optional) |
| `get_pension` | OTP/IPS projection to retirement, retirement income (folketrygd, AFP, OTP, IPS) gross and net, replacement rate |
| `get_forecast` | Year-by-year net-worth projection from the saved forecast assumptions; any lever can be overridden for a what-if |
| `get_mortgage` | Active mortgage: payment, remaining term (years + months), payoff month and timeline, LTV, paydown vs plan, yearly amortization, and the user's ownership and loan share with co-owners |
| `get_housing` | Borrowing capacity (with manual overrides), planned purchase, second-home scenarios and portfolio |
| `get_employer_cost` | Employer cost, break-even/target/billed hourly rate, margin, fair salary |
| `get_assets_and_debts` | Every balance with its id, equity breakdown, BSU room, wealth-tax estimate, recent snapshots |
| `query_transactions` | Filter by date, category, text, amount, kind; totals and per-category sums over all matches |
| `what_if` | `prepay_vs_invest` or `extra_debt_payment` scenarios |
| `list_history` | Recent saved revisions (newest first) with timestamps and sizes |
| `get_history_revision` | The full dataset as it was at a past revision |
| `get_raw_data` | The full app-state blob (escape hatch) |

**Write (guarded; each does a rev-checked read-modify-write and returns a before/after diff):**

| Area | Tools |
| --- | --- |
| Budget | `set_category_budget`, `add_fixed_expense`, `update_fixed_expense`, `delete_fixed_expense` |
| Goals | `add_goal`, `update_goal`, `delete_goal` |
| Transactions | `add_transaction`, `update_transaction`, `delete_transaction` |
| Rules | `add_rule`, `delete_rule` (`type`: `category` / `label` / `transfer`) |
| Balances | `update_asset`, `upsert_savings_account`, `delete_savings_account`, `upsert_debt`, `delete_debt`, `update_current_mortgage`, `update_loan`, `set_co_owners` |
| Income | `set_monthly_income`, `add_salary`, `add_bonus` |
| Settings | `update_assumptions`, `set_ai_context`, `set_profile` |
| Undo | `restore_revision` |

Notes on a few of them:

- `delete_transaction` on a bank-imported row (`eb-` id) also adds the id to
  `deletedBankIds` and its date, amount, account and description to
  `deletedBankTombstones`, as the app does, so neither the server's bank reconcile
  nor the first sync after a re-link brings the row back.
- `update_asset`: `houseDebt` is the one stored mortgage balance and stamps its
  month on the `homeowner` slice; `houseValue` is mirrored into the `transition`
  slice, as the app does.
- `update_current_mortgage` edits the mortgage the user has (rate, fee, start
  month, balance, remaining term as `termYears` + `termMonths`). The term counts
  down from the month it was set; `balance` is written to `assets.houseDebt`.
  `update_loan` is the planned purchase loan in first-buyer / buy-and-sell modes.
- `set_co_owners` replaces the whole co-owner list of the current home (the shares
  must validate together). Home value and loan stay the full amounts; the user's
  share is what the co-owners leave. Stored snapshots are rewritten from each
  row's `since`/`until`, as the app does.
- `set_monthly_income` removes a month's override with `clear: true`; `amount: 0`
  is stored as a real zero-income month.
- `upsert_savings_account` / `upsert_debt` create when called without `id` and
  update only the provided fields when called with one.
- `add_rule` replaces an existing rule of the same type with the same match text.
- `add_salary` requires an existing `jobId`; `add_bonus` checks it when given.

**Housing market (opt-in, off by default):**

Listed only while the user has turned on housing market (Bolig page → Marked tab). The stdio
server re-checks the setting every minute and the HTTP server on each request,
so a connected client sees the tools appear or disappear without a restart. The
app enforces the same switch: while it is off, `/api/market/*` answers 404.

| Tool | What it does |
| --- | --- |
| `import_listings` | Store homes for sale (up to 500 per call), keyed by URL. Re-importing records the asking price for `seenOn`, which builds a price history; returns price changes since the previous snapshot |
| `import_sales` | Store sold homes (up to 500 per call); an identical sale is skipped |
| `get_home_valuation` | Value of the current home from imported sales of a similar size nearby (low/mid/high), falling back to the SSB kommune average |

The same rows can also be added in the app without an AI client: one sold home
at a time on the Bolig page's Marked tab, or a JSON file (same fields)
through "Import file" on the same tab.

Headroom never fetches market data. The rows hold facts only (price, fellesgjeld,
size, rooms, floor, year, location, link); unknown fields such as photos or ad
text are rejected. The data lives in its own tables, outside the finance blob, so
it is not part of the revision history or export. "Delete all market data" on
the tab empties it.

`get_overview` includes a `notes` field — the user's free-text plans/goals context
(editable in Settings → "Context for the AI assistant"); `set_ai_context` writes it.

Write tools are annotated `destructiveHint`/`idempotentHint` so clients can prompt
for confirmation. They change exactly one blob slice (the mirroring cases
above aside) and leave everything else byte-identical.

## Revision history / undo

Every write is snapshotted server-side into a `finance_history` table in the data
volume, separate from the data blob, so it can't be clobbered by a save and never
leaks into exports. It is a fine-grained undo net on top of the coarse nightly
`.sqlite` backups.

- **Who and what.** Each revision records its `source` (`ui`, `mcp`, `import`,
  `bank-sync`, `restore`, `undo`), a `label`, the top-level keys it changed, and the
  revision it was saved on top of (its "before"). MCP writes send
  `X-Headroom-Source: mcp` and label the revision with the fields they touched. The
  app tags an import or a reset as `import`. Clients can only claim `ui`, `mcp` or
  `import`.
- **Retention.** 90 days, never fewer than the newest 20, and at most 200 MB of
  snapshots in total. Back-to-back UI autosaves fold into one revision (gaps under
  10 minutes, sessions up to 30), so an editing session can't push other changes
  out. MCP writes and imports are never folded. A bank sync that brought nothing
  new writes nothing.
- **Undo one change.** `undo_change(rev)` reverts only what that revision changed
  and keeps everything saved after it. It is a three-way merge: each touched value
  goes back only if it still equals what the revision wrote. Arrays of `{ id }`
  rows and plain objects merge per row and per field, so undoing one transaction
  edit survives a later bank sync. Sets of ids (like `deletedBankIds`) merge per
  element. If something was changed again since, it refuses with the conflicting
  fields and writes nothing. `list_history` marks each revision `undoable` while
  the revision before it is still kept.
- **Restore everything.** `restore_revision(rev)` rolls the whole dataset back,
  discarding later saves. Revisions recorded before change tracking can only be
  restored.

Undos and restores are themselves revisions, so both can be undone. The same
endpoints (`/api/history`, `/api/history/:rev`, `/api/history/:rev/restore`,
`/api/history/:rev/undo`) back the Restore points card in Settings. The two POST
routes require an `X-Headroom-Source` header, so a cross-site form can't trigger
them when auth is off.

## Tests

`npx vitest run mcp/tools.test.ts` — pure-derivation tests plus a live round-trip
against a **throwaway** server (`DATA_DIR=$(mktemp -d)`), never your real data.
