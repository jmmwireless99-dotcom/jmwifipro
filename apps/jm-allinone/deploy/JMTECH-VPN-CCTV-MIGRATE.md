# JM TECH — VPN + MikroTik sites + CCTV on jmvps

Migrated (replica) from `jmtechsolution.cloud` / `72.62.73.235` onto Proxmox VM `jmvps`.

## Live URLs (Tailscale / LAN)

| Service | URL |
|---------|-----|
| Main portal (MikroTik sites, dashboard) | http://100.101.1.71/ or http://192.168.200.155/ |
| Soscial CCTV NVR / Viewer | http://100.101.1.71/soscial/ |
| Billing all-in-one | http://100.101.1.71/billing/hub |
| SSTP VPN | `192.168.200.155:4443` or `100.101.1.71:4443` |
| HLS | http://100.101.1.71/hls/ |

Staff login for MRP portal: same `admin` credentials as on `jmtechsolution.cloud`.

## Components on jmvps

- `accel-ppp` — SSTP VPN (`:4443`), chap-secrets from cloud
- `mrp-backend` — Node portal `:8081` (proxied via nginx `:80`)
- PostgreSQL `mrp` — cameras (31), mikrotik_sites (2), stations (32)
- `mediamtx` — HLS `:8888`
- `jmwifi-go2rtc` — Docker, API `:1984`
- `jm-allinone` — billing `:3000` under `/billing/`

## Important

**Production field MikroTiks still connect to the cloud** (`72.62.73.235:4443`).  
This jmvps install is a **ready replica**. Cutover requires:

1. Public IP / port-forward `TCP 4443` → `192.168.200.155`
2. Update MikroTik SSTP `connect-to=` to the new public IP
3. Only then stop (or drain) cloud `accel-ppp`

Do **not** stop cloud VPN until cutover is planned — ~25 active SSTP sessions were online at export time.

## Paths

- App: `/opt/mrp`
- Migrate bundle: `/opt/jmtech-migrate`
- VPN conf: `/etc/accel-ppp.conf`, certs `/etc/accel-ppp/`
- Users: `/etc/ppp/chap-secrets`
