# JM TECH All-in-One

ISP billing panel (from `jm-billing` / JeffNet) plus:

- **VPN clients** — public `/vpn` portal that issues MikroTik **SSTP** scripts (same idea as `jmtechsolution.cloud/register`)
- **VPS inventory** — `/api/vps/servers` CRUD for hosts (SSH, role, public URL)
- **Hub** — `/hub` landing for modules

## Quick paths

| Path | Purpose |
|------|---------|
| `/` | Staff billing panel |
| `/hub` | Product hub |
| `/vpn` | Client VPN registration |
| `/api/vpn/register` | Public VPN signup API |
| `/api/vpn/clients` | Staff VPN list (login) |
| `/api/vps/servers` | Staff VPS inventory (login) |

Default staff login (first boot): `admin` / `admin` — change immediately.

## Deploy on Ubuntu (jmvps)

```bash
cd /opt/jm-allinone   # or copy this tree there
bash deploy/install-jmvps.sh
```

Live on Tailscale: `http://100.101.1.71:3000/hub`

## Database

SQLite file: `billing.db` next to `server.js`.

New tables: `vpn_clients`, `vps_servers`.

Set SSTP hostname in Settings key `vpn_sstp_server` (or `PUBLIC_URL` host is used as fallback).

## Note on jmtechsolution.cloud

The public Laravel “Cloud Hotspot Server” on `jmtechsolution.cloud` was not SSH-accessible from this agent. This tree ports the **billing** stack we already backed up and recreates the **VPN client script** flow. Full mirror of the Laravel app still needs SSH (or a tarball) from that host.
