# Headroom

A self-hosted personal finance tracker. Track monthly budgets, manage assets and investments, model housing loans, and get smart spending recommendations. All data is stored server-side in a SQLite database via Docker — zero browser storage. Norwegian is natively supported.

| Dashboard | Budget |
|-----------|--------|
| ![Dashboard](screenshots/dashboard.png) | ![Budget](screenshots/budget.png) |

![Net worth](screenshots/assets.png)

## Features

Track monthly budgets with variable-income support, fixed expenses, a daily transaction log, and a spend/invest split that adapts automatically to your income history. The dashboard gives a live view of total equity, budget health, asset allocation, and a running net worth chart.

Assets covers your investment portfolio, property equity, crypto, and cash reserves with tax-aware calculations and a 15-year growth projection. The loan calculator handles first-time buyer, homeowner, and buy-and-sell scenarios with full amortization schedules and tax benefit calculations. Supports NOK, USD, or any custom currency, and ships with full Norwegian and English translations.

## Run it on your laptop

Headroom is happiest as a small private app on your own machine. The only thing you need is **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** (free, Mac/Windows/Linux) — no accounts, no cloud, no config files. Your data lives on your laptop and never leaves it.

**Option A — pre-built image (recommended, no clone, nothing to build):**

```bash
docker run -d \
  --name headroom \
  -p 127.0.0.1:8080:3001 \
  -v headroom_data:/data \
  --restart unless-stopped \
  ghcr.io/mortennordbye/headroom:latest
```

**Option B — build from source** (if you want to modify it; also needs [Make](https://www.gnu.org/software/make/)):

```bash
git clone https://github.com/mortennordbye/headroom.git
cd headroom
make build
```

Either way, open **http://localhost:8080** and you're done — **no config files, no environment variables required.**

- The `--restart unless-stopped` flag (and `make up`) means it comes back automatically after you reboot your laptop, so it's always there when you open the browser.
- Everything you enter is saved in the **`headroom_data`** volume on your machine. It survives restarts, reboots, and updates (see [Updating](#updating) and [Data persistence](#data-persistence)).

**Later, want it on a home server or another device?** Change the port binding (`-p 8080:3001` for all interfaces, or map it into a reverse proxy) — nothing else changes. Read [Security](#security) first: there's no login, so don't expose it to the open internet without a proxy or VPN in front.

## Updating

New versions never touch your data — it's in the `headroom_data` volume, separate from the app. To move to a newer version:

**Option A — pre-built image:**

```bash
docker pull ghcr.io/mortennordbye/headroom:latest   # get the new version
docker rm -f headroom                                # remove the old container (NOT the volume)
docker run -d \
  --name headroom \
  -p 127.0.0.1:8080:3001 \
  -v headroom_data:/data \
  --restart unless-stopped \
  ghcr.io/mortennordbye/headroom:latest              # start the new one, same volume
```

**Option B — from source:**

```bash
git pull
make build
```

Because you re-attach the same `-v headroom_data:/data` volume (Option A) or reuse the same Docker Compose volume (Option B, via `make build`), **all your budgets, transactions, and settings carry over untouched.** Only `docker-compose down -v` or deleting the volume by hand ever removes data.

> **Tip:** before a big update, it costs nothing to take a snapshot first — `make backup`, or **Settings → Export** in the app (see [Data persistence](#data-persistence)).

> **Browser shows an old version after updating?** The app is a PWA and caches itself. Accept the "new version available" prompt, or hard-reload (Cmd/Ctrl+Shift+R). Your data is unaffected — this is only the UI cache.

## Commands

| Command | Description |
|---------|-------------|
| `make build` | Build image and start (also rebuilds if already running) |
| `make up` | Start without rebuilding |
| `make down` | Stop all containers |
| `make restart` | Restart without rebuilding |
| `make backup` | Copy the SQLite database to `./backups/` (timestamped) |

## Local development (without Docker)

_For contributors hacking on the code — if you just want to **use** Headroom on your laptop, use [Run it on your laptop](#run-it-on-your-laptop) above instead._

For iterating on the frontend you can run the API and Vite dev server directly:

```bash
npm install
node server/index.js          # API on :3001 (writes to ./data)
npm run dev                   # Vite on :5173, proxies /api → :3001
make seed-local               # optional: seed ./data with demo data
```

`npm test` runs the Vitest suite; `npm run lint` runs ESLint.

## Security

Headroom has **no authentication** — it's designed for single-user self-hosting. Anyone who can reach the port can read and overwrite your entire financial picture, so the default port mapping binds to `127.0.0.1` (loopback) only: the app is reachable from the host machine but not from other devices on your network.

To use it from another device:

- Put it behind a reverse proxy (nginx, Caddy, Traefik) that adds authentication (basic auth or an SSO/identity layer), or
- Reach it over a private network (VPN, Tailscale, WireGuard).

Only change the binding to `0.0.0.0` (all interfaces) if you understand that this exposes unauthenticated access to everyone on the network.

**Optional hardening:** set `ALLOWED_HOSTS` (see [Configuration](#configuration)) to reject requests whose `Host` header isn't one you expect — a small guard against DNS-rebinding. It's off by default so the app works behind any hostname without configuration.

## Configuration

All optional — the defaults are sensible and nothing needs to be set.

| Env var | Default | Purpose |
|---------|---------|---------|
| `DATA_DIR` | `/data` (in Docker) | Where the SQLite database is stored. |
| `PORT` | `3001` | Port the server listens on inside the container. |
| `ALLOWED_HOSTS` | _(unset — all hosts allowed)_ | Comma-separated hostname allowlist, e.g. `finance.example.com,localhost`. When unset, no host filtering is applied. |

## Data persistence

Everything you enter lives in one SQLite database inside the named Docker volume **`headroom_data`** on your machine — there is no browser storage and nothing in the cloud. The volume is independent of the container, which is what makes your data stick around.

**Your data survives:**
- Stopping/starting the app (`make down` / `make up`, or `docker stop`/`start`)
- Rebooting your laptop
- Updating to a new version (see [Updating](#updating))

**Your data is only removed if you explicitly delete it:**
- `docker-compose down -v` (the `-v` deletes the volume), or
- `docker volume rm headroom_data`

### Backups

The volume is the only live copy, so keep a backup — two easy options:

1. **In-app export (best, portable).** **Settings → Export** downloads your entire state as a single JSON file. This is the safest backup: it's independent of Docker, survives losing the volume, and can be imported on a fresh install or a different machine via **Settings → Import**. Because it holds your full accumulated transaction history, an occasional export is a complete backup.
2. **Database snapshot.** `make backup` copies the SQLite file to `./backups/` (timestamped, gitignored).

### Restore

- From a JSON export: open the app and use **Settings → Import**.
- From a SQLite snapshot: `docker cp backups/<file>.sqlite headroom:/data/database.sqlite && make restart` (for the pre-built image, replace `make restart` with `docker restart headroom`).

> Bank sync only reaches ~90 days back per fetch, but stored transactions are never dropped — they accumulate as you keep syncing. So your history keeps growing on your machine, and an export captures all of it. Sync regularly (don't leave gaps longer than ~90 days) and export now and then, and you have a durable, ever-growing record.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4 |
| Charts | Recharts |
| Backend | Node.js, Express |
| Database | SQLite (better-sqlite3) |
| Serving | Express (static files) |
| Containers | Docker, Docker Compose |
