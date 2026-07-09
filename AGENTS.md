# jmwifipro

This repository is a **backup / deployment archive** of the `jmwifi.pro` billing system, not a
normal source tree. The runnable application source lives inside tracked tarballs under
`backup/<timestamp>/app/`:

- `backup/<timestamp>/app/jm-billing.tar.gz` — the primary app ("JM WIFI NETWORK" billing panel).
- `backup/<timestamp>/app/JeffNetPanel.tar.gz` — an older/related variant (secondary, optional).

See `README.md` for what the rest of the backup contains (SQLite DB, exports, nginx/systemd config, etc.).

## Cursor Cloud specific instructions

### What the app is

`jm-billing` is a **zero-dependency Node.js web app** (ES modules, Node built-ins only). It has **no
`package.json` and no `node_modules`** — it relies on Node's built-in `node:sqlite`, so **Node 22+ is
required** (Node 22 is already installed on the VM). It serves an admin billing panel + customer
captive portal over plain HTTP on `PORT` (default `3000`), backed by a single SQLite file `billing.db`
in the working directory.

### Where the app lives

The startup update script extracts the latest `jm-billing.tar.gz` to `~/jm-billing` (outside the repo,
so the repo stays unmodified). The bundled `~/jm-billing/billing.db` is the restored production
snapshot (hundreds of real customers/invoices). Note: re-running the update script **re-extracts and
overwrites `~/jm-billing`, including `billing.db`** (resets to the backup snapshot) — do not keep
important local DB edits there across restarts.

### Run it (dev mode)

```bash
cd ~/jm-billing
RESET_ADMIN=1 PORT=3000 node server.js
```

- Then open http://localhost:3000 .
- `RESET_ADMIN=1` forces the `admin` account to password `admin` (role admin). The restored DB already
  contains real accounts with unknown passwords, so **use `RESET_ADMIN=1` on first start** to get in,
  then it's unnecessary on later starts of the same DB. Login API: `POST /api/auth/login`
  `{"username","password"}` (cookie session). Admin APIs live under `/api/billing/...`
  (e.g. `POST /api/billing/customers`).
- There is no separate build step and no `pnpm/npm dev`; `node server.js` is both dev and prod.
- Non-obvious: the server schedules background jobs (expiry sweep, watchdog, router polling, RADIUS).
  These are harmless locally — router/MikroTik/payment/SMS integrations just no-op without credentials.
  A MikroTik router, payment gateways, SMS, etc. are NOT needed to run or test the panel.

### Lint / test / build

There is **no lint config, no test suite, and no build system** in this project. The available
static check is Node's syntax check:

```bash
cd ~/jm-billing && for f in server.js lib/*.js; do node --check "$f" || echo "FAILED: $f"; done
```

### Secondary app (optional)

`JeffNetPanel` is the same style of app but is **license-gated** (activation screen). It is not needed
for normal development of `jm-billing`; ignore it unless specifically asked to work on it.
