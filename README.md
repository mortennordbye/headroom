# Headroom

A personal finance tracker built for Norwegian users — and anyone else who wants to stay on top of their money. Track monthly budgets, manage assets and investments, model housing loans, and get smart spending recommendations. All data is stored server-side in a SQLite database via Docker. Zero browser storage.

| Dark mode | Light mode |
|-----------|------------|
| ![Dashboard dark](screenshots/dashboard.png) | ![Dashboard light](screenshots/dashboard-light.png) |
| ![Budget dark](screenshots/budget.png) | ![Budget light](screenshots/budget-light.png) |

## Features

- **Budget** — monthly income tracking with variable-income support, fixed expenses, daily transaction log, and distribution charts
- **Smart Recommendations** — automatic spend/invest split based on your income history and volatility; switches to conservative mode during low-income months
- **Assets** — investment portfolio, property equity, crypto, and cash reserves with tax-aware net worth calculation and a 15-year growth projection
- **Loan Calculator** — supports first-time buyer, homeowner, and buy-and-sell scenarios with full amortization schedules and tax benefit calculations
- **Dashboard** — total equity, budget health, asset allocation, recent transactions, and a net worth history chart that builds up over time
- **Multi-currency** — NOK, USD, or any custom currency (EUR, GBP, JPY, …) with configurable exchange rates
- **Norwegian / English** — full UI translation
- **Dark / light mode** — persisted preference, no flash on load

## Quick start

Requires [Docker](https://docs.docker.com/get-docker/) and [Make](https://www.gnu.org/software/make/).

```bash
git clone https://github.com/mortennordbye/headroom.git
cd headroom
make build
```

Open **http://localhost:8080**.

## Commands

| Command | Description |
|---------|-------------|
| `make build` | Build image and start (also rebuilds if already running) |
| `make up` | Start without rebuilding |
| `make down` | Stop all containers |
| `make restart` | Restart without rebuilding |

## Data persistence

All data lives in a named Docker volume (`headroom_data`). Running `make down` keeps your data intact. To wipe everything:

```bash
docker-compose down -v
```

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4 |
| Charts | Recharts |
| Backend | Node.js, Express |
| Database | SQLite (better-sqlite3) |
| Serving | Express (static files) |
| Containers | Docker, Docker Compose |
