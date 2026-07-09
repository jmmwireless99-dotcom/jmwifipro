# AGENTS.md

## Cursor Cloud specific instructions

### What this repo is
This repo (`jmwifipro`) is a **backup**, not a live source tree. It holds the `jmwifi.pro` billing
deployment: the runnable applications live inside tarballs under `backup/<timestamp>/app/`:
- `jm-billing.tar.gz` — the **primary/live** product (deployed via `systemd/jm-billing.service` +
  `nginx/jmwifi.pro`, listens on port 3000). This is what you should run.
- `JeffNetPanel.tar.gz` — an older Windows-oriented build of the same panel; not needed for dev.

### The application (`jm-billing`)
A **zero-dependency** Node.js ISP billing/admin panel. Key non-obvious facts:
- **Node.js 22+ is required** — the app uses Node's built-in `node:sqlite` (`DatabaseSync`). The
  `ExperimentalWarning: SQLite is an experimental feature` line at startup is expected/harmless.
- There is **no `package.json`, no `node_modules`, and no `npm install`** — it imports only Node
  built-ins plus its own `lib/*.js` (pure ESM). Nothing to install.
- Entry point is `server.js`; it serves an HTTP UI + JSON API on `PORT` (default 3000).
- Data lives in a single SQLite file. Path is `billing.db` in the cwd unless overridden by
  `DB_FILE`. **The tarball's bundled `billing.db` contains real customer data** — always run dev
  against a separate `DB_FILE` so you don't mutate it.
- Licensing is **Free Edition**: `lib/license.js#checkLicense` always returns ok, so there is no
  activation gate.
- Auth: on an empty DB a default admin (`admin` / `admin`) is seeded on first run. Starting with
  `RESET_ADMIN=1` force-resets the `admin` account to password `admin`.
- A yellow "Router not configured / enter your MikroTik IP" banner is expected in dev — the panel
  normally talks to a MikroTik router on the LAN, which isn't present here. It does not block the UI.

### Setup / run (dev)
The startup update script extracts the latest `jm-billing.tar.gz` into `~/jm-billing`. To run:

```bash
cd ~/jm-billing
DB_FILE="$HOME/jm-billing-data/dev.db" PORT=3000 RESET_ADMIN=1 node server.js
```

Then open http://localhost:3000 and log in with `admin` / `admin`. Core API (needs the `sid` cookie
from `POST /api/auth/login`): `GET/POST /api/billing/plans`, `GET/POST /api/billing/customers`,
`GET /api/billing/summary`.

### Lint / test / build
There is **no test suite, no linter, and no build step** (it ships as raw `.js`). The closest
sanity check is a syntax check: `node --check server.js` (and `for f in lib/*.js; do node --check "$f"; done`).
"Build/run" is simply `node server.js` as above.
