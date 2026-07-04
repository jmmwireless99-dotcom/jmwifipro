# jmwifipro

JM WIFI billing system backup and deployment files for **jmwifi.pro**.

## Latest backup

`backup/20260703T234918Z/` — pulled from VPS `187.77.145.131` on 2026-07-04 (UTC).

| Included | Notes |
|----------|-------|
| `app/jm-billing.tar.gz` | Full app code archive |
| `app/JeffNetPanel.tar.gz` | JeffNetPanel app archive |
| `nginx/jmwifi.pro` | Nginx site config |
| `systemd/jm-billing.service` | Systemd unit |
| `ssl/fullchain.pem` | Public certificate only |
| `BACKUP-INFO.txt` | Server status at backup time |
| `DATABASE-COUNTS.txt` | Table row counts (no customer rows) |

**Not uploaded here (keep local only):** SQLite databases, `.env`, SSL private key, license keys, and access logs. The GitHub repo is **public** — those files contain customer data and secrets.

Full local backup: `C:\Users\jmmwi\JMWIFI.PRO-BACKEUP\jmwifi-full-backup-20260703T234918Z\`

## Live database snapshot (counts)

- 291 customers
- 557 invoices
- 81 payments
- 205 voucher orders
- 41 tables total

See `backup/20260703T234918Z/DATABASE-COUNTS.txt` for the full list.
