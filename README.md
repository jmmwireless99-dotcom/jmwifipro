# jmwifipro

Full **jmwifi.pro** billing backup and deployment files.

## Hotspot voucher generator (original)

Jeffrey's original jmwifi.pro hotspot voucher generator is preserved at
[`original/hotspot-generator/`](original/hotspot-generator/) and integrated into the
unpacked app at [`jm-billing/lib/hotspot-generator.js`](jm-billing/lib/hotspot-generator.js).

The admin panel supports two modes:

- **Cloud RADIUS** — default production path for centralized vouchers
- **Original (Jeffrey)** — direct MikroTik `/ip/hotspot/user` creation on a router profile

See [`original/hotspot-generator/README.md`](original/hotspot-generator/README.md) for API details.

## Latest backup

`backup/20260703T234918Z/` — pulled from VPS `187.77.145.131` on 2026-07-04 (UTC).

### Billing data

| File | Description |
|------|-------------|
| `databases/jm-billing-billing.db` | Live SQLite database (restore this for full recovery) |
| `billing-full-export.json` | All 41 tables as JSON |
| `billing-full-export.sql` | SQL insert dump |
| `billing-full-export-counts.json` | Row counts per table |
| `DATABASE-COUNTS.txt` | Human-readable table summary |

### App and server

| File | Description |
|------|-------------|
| `app/jm-billing.tar.gz` | Full billing app code |
| `app/JeffNetPanel.tar.gz` | JeffNetPanel app code |
| `nginx/jmwifi.pro` | Nginx site config |
| `systemd/jm-billing.service` | Systemd unit |
| `configs/` | `.env` and license keys |
| `ssl/` | Let's Encrypt certificate + private key |
| `logs/` | Recent nginx and service logs |
| `BACKUP-INFO.txt` | Server status at backup time |

### Database snapshot (2026-07-04)

- 291 customers
- 557 invoices
- 81 payments
- 205 voucher orders
- 5,166 audit entries
- 41 tables total

## Restore

Copy `databases/jm-billing-billing.db` to `/opt/jm-billing/billing.db` on the VPS, then restart `jm-billing`.

**Warning:** This repo contains customer data, credentials, and SSL private keys. Keep access restricted.
