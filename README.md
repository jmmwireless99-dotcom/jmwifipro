# jmwifipro

Full **jmwifi.pro** billing backup and deployment files.

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

## Extra domain: jmestre.tech (JM VPS)

Point Hostinger DNS for `jmestre.tech` at the JM VPS:

| Type | Name | Value |
|------|------|-------|
| A | @ | `187.77.145.131` |
| A | www | `187.77.145.131` |

Then on the VPS (or via deploy script):

```bash
cd app/jm-billing
VPS_PASS=... node deploy/deploy-jmestre-domain.mjs
# or SSH and: sudo bash /opt/jm-billing/deploy/add-domain-jmestre.sh
```

This adds `jmestre.tech` / `www.jmestre.tech` to nginx beside `jmwifi.pro` (same billing panel on port 3000) and issues Let's Encrypt TLS.

