# Bank transaction sync (Enable Banking)

Imports **Bank Norwegian** transactions into Headroom's `dailyTransactions`
ledger via the [Enable Banking](https://enablebanking.com) PSD2 API (free
own-accounts tier). Fully in-app: link, re-link, and sync from **Settings**.

The engine is `server/bank.js` (self-contained CommonJS, ships in the Docker
image). It exposes:

| Route | Purpose |
|-------|---------|
| `GET /api/bank/status` | linked? key installed/encrypted? consent days left? |
| `POST /api/bank/key` | upload the app's private key (write-only, validated + verified) |
| `POST /api/bank/link` | start BankID → returns the redirect url |
| `GET /api/bank/callback` | BankID lands here → saves session → back to Settings |
| `POST /api/bank/sync` | fetch new transactions, merge into the blob |

Mapping + dedup-merge are unit-tested in `src/lib/bank.test.ts`.

## Setup — all in the app, no env vars required

1. **Enable Banking app** (Production, Active) with your account linked.
2. **Register the HTTPS callback** on that app:
   `https://<your-host>/api/bank/callback` (e.g. `https://headroom.local.bigd.no/api/bank/callback`).
3. In **Settings → Bank sync**:
   - Paste that same **Callback URL** (prefilled with your origin) and **Save**.
   - **Upload** the private key (`.pem`). It's validated, verified against Enable
     Banking, stored `chmod 600`, and **encrypted at rest** — never readable back
     out via the API.
   - **Connect Bank Norwegian** → BankID.

### Key encryption

The stored key is always AES-256-GCM encrypted. By default the app manages its
own key (`$DATA_DIR/eb-master.key`, `chmod 600`) — zero config, but since it sits
in the same volume it guards against the key file leaking *in isolation*, not a
full-volume breach. For stronger protection set **`EB_KEY_SECRET`** (env / mounted
secret, kept *outside* the data) — then a leaked volume is useless without it.
Losing that secret means re-uploading the key.

### Env configuration

- `EB_APP_ID` — application id (**required** — register your own app on
  enablebanking.com; there is no code default).
- `EB_REDIRECT` — callback URL; overrides the in-app setting when present.
- `EB_KEY_SECRET` — at-rest encryption secret (see above).
- `EB_KEY_PATH` — where the key is stored (default `$DATA_DIR/eb-key.pem`).

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
