# Bank transaction sync (Enable Banking)

Imports **Bank Norwegian** transactions into Headroom's `dailyTransactions`
ledger via the [Enable Banking](https://enablebanking.com) PSD2 API (free
own-accounts tier). Fully in-app: link, re-link, and sync from **Settings**.

The engine is `server/bank.js` (self-contained CommonJS, ships in the Docker
image). It exposes:

| Route | Purpose |
|-------|---------|
| `GET /api/bank/status` | linked? consent days left? last sync? |
| `POST /api/bank/link` | start BankID → returns the redirect url |
| `GET /api/bank/callback` | BankID lands here → saves session → back to Settings |
| `POST /api/bank/sync` | fetch new transactions, merge into the blob |

Mapping + dedup-merge are unit-tested in `src/lib/bank.test.ts`.

## Setup (one-time)

1. **Enable Banking app** (Production, Active) with your account linked.
2. **Register the HTTPS callback** on that app:
   `https://<your-host>/api/bank/callback` (e.g. `https://headroom.local.bigd.no/api/bank/callback`).
3. **Give the server these env vars** (compose / run):
   - `EB_APP_ID` — your application id (defaults to the current one).
   - `EB_REDIRECT` — the callback URL from step 2. **Required** for linking.
   - `EB_KEY_PATH` — path to the private RSA key (default `$DATA_DIR/eb-key.pem`).
4. **Place the private key** in the data volume as `eb-key.pem` (or point
   `EB_KEY_PATH` at it). It's gitignored and must never be committed.

## Use

- **Settings → Bank sync** → **Connect Bank Norwegian** → BankID → you're back
  on Settings, linked.
- **Sync now** pulls new transactions immediately.
- Consent lasts ~90 days; when it lapses the card shows **Re-link** — one click.

## Daily automatic sync (cron)

Hit the sync endpoint on a schedule (server holds the session; no BankID needed
until consent expires):

```cron
0 3 * * *  curl -fsS -X POST http://localhost:8080/api/bank/sync >> /var/log/eb-sync.log 2>&1
```

## Notes

- Imported rows have ids prefixed `eb-`; manual rows are never touched.
- `POST /api/data` re-adds any `eb-` rows a stale client tab drops (anti-clobber,
  `server/index.js`).
- `out/` here is a leftover dump from the earlier CLI prototype (gitignored, real
  data) — safe to delete.
