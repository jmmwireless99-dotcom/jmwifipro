# AGENTS.md

This repo is a **backup snapshot** of the `jmwifi.pro` deployment, not a live source
checkout. The actual application code ships as tarballs under
`backup/20260703T234918Z/app/`. The primary product is **`jm-billing`** ("JEFF NETWORK
SERVICE" panel): a MikroTik ISP billing / captive-portal admin panel.

## Cursor Cloud specific instructions

### What the product is
`jm-billing` is a single **zero-dependency Node.js 22** service (`server.js` + `lib/*.js`).
It uses only Node built-ins — notably `node:sqlite` (`DatabaseSync`), which is why **Node 22+
is required** (Node <22 fails with a `node:sqlite` error). There is **no `package.json`, no
`npm install`, no build step, and no automated test suite.** `JeffNetPanel` is an older
variant of the same app and is not the thing to run.

### Working copy (`run/`) — regenerated, do not edit for real
The update script extracts the app tarball into `run/jm-billing/` (git-ignored) and drops in
a dev `.env` (`PORT=3000`). It deliberately deletes the bundled `billing.db*` so the app
starts from a **fresh SQLite DB**. Consequences:
- The `run/` copy is **regenerated on every session start**, so edits made inside
  `run/jm-billing/` are wiped. It is a runtime working copy, not the source of truth.
- Because the DB starts empty, `server.js` seeds a default admin on first boot:
  **username `admin`, password `admin`** (a red "default password" banner is expected).
- Real (secret-redacted) production data is available at
  `backup/20260703T234918Z/databases/jm-billing-billing.db` if you want realistic data —
  copy it to `run/jm-billing/billing.db` before starting (its admin password is unknown, so
  set `RESET_ADMIN=1` to force `admin`/`admin`).

### Run it (dev)
From `run/jm-billing/`: `node server.js` (listens on `http://localhost:3000`; HTTP unless
`TLS_CERT`/`TLS_KEY` are set). Prefer a tmux-backed session since it is long-running.
Useful env vars read at startup: `PORT`, `DB_FILE`, `RESET_ADMIN=1`, `MIKROTIK_HOST`.
The panel runs fully standalone; a MikroTik router / payment gateways are optional and only
needed for live provisioning — customer/plan/invoice CRUD works without them.

### Lint / test / build
- **Lint:** no linter is configured. Closest check is a syntax pass:
  `node --check server.js` (and `lib/*.js`).
- **Test:** there is no automated test suite. Verify changes by running the server and
  exercising the API/UI (log in, then e.g. `POST /api/auth/login`, `POST /api/billing/plans`,
  `POST /api/billing/customers`).
- **Build:** none — run `server.js` directly.

### Gotchas
- Login route is `POST /api/auth/login` (not `/api/login`); it sets a `sid` cookie. All
  `/api/billing/*` write routes require that session cookie.
- The license gate is intentionally disabled (`lib/license.js` `checkLicense` returns a free
  license), so no activation/`license.key` is needed.
- `node:sqlite` prints an `ExperimentalWarning` on startup — harmless.
