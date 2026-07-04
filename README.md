# Headroom

A self-hosted personal finance tracker. Track monthly budgets, manage assets and investments, model housing loans, and get smart spending recommendations. All data is stored server-side in a SQLite database via Docker — zero browser storage. Norwegian is natively supported.

| Dashboard | Budget |
|-----------|--------|
| ![Dashboard](screenshots/dashboard.png) | ![Budget](screenshots/budget.png) |

![Net worth](screenshots/assets.png)

## Features

Track monthly budgets with variable-income support, fixed expenses, a daily transaction log, and a spend/invest split that adapts automatically to your income history. The dashboard gives a live view of total equity, budget health, asset allocation, and a running net worth chart.

Assets covers your investment portfolio, property equity, crypto, and cash reserves with tax-aware calculations and a 15-year growth projection. The loan calculator handles first-time buyer, homeowner, and buy-and-sell scenarios with full amortization schedules and tax benefit calculations. Supports NOK, USD, or any custom currency, and ships with full Norwegian and English translations.

## Quick start

**Using the pre-built image** — the fastest way, no clone required:

```bash
docker run -d \
  --name headroom \
  -p 127.0.0.1:8080:3001 \
  -v headroom_data:/data \
  --restart unless-stopped \
  ghcr.io/mortennordbye/headroom:latest
```

**Building from source** — requires [Docker](https://docs.docker.com/get-docker/) and [Make](https://www.gnu.org/software/make/):

```bash
git clone https://github.com/mortennordbye/headroom.git
cd headroom
make build
```

Open http://localhost:8080.

## Commands

| Command | Description |
|---------|-------------|
| `make build` | Build image and start (also rebuilds if already running) |
| `make up` | Start without rebuilding |
| `make down` | Stop all containers |
| `make restart` | Restart without rebuilding |
| `make backup` | Copy the SQLite database to `./backups/` (timestamped) |

## Local development (without Docker)

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

## Data persistence

All data lives in a named Docker volume (`headroom_data`). Running `make down` keeps your data intact. To wipe everything:

```bash
docker-compose down -v
```

**Backups.** The volume is the only copy of your data. Run `make backup` to copy the SQLite file to `./backups/` (gitignored), or use the JSON export in Settings. Restore by copying a backup back into the volume (`docker cp backups/<file>.sqlite headroom:/data/database.sqlite && make restart`).

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4 |
| Charts | Recharts |
| Backend | Node.js, Express |
| Database | SQLite (better-sqlite3) |
| Serving | Express (static files) |
| Containers | Docker, Docker Compose |
