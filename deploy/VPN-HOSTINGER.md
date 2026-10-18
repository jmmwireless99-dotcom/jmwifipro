# VPN / JM Ops on Hostinger (`jmwifi.pro`)

SoftEther SSTP tunnel VPN server + Create VPN Client — same role as the old `jmestre.tech` / `jmtechsolution.cloud` hub — now runs on Hostinger.

## SoftEther (tunnel VPN server)

| Item | Value |
|------|--------|
| Host | `187.77.145.131` (`jmwifi.pro`) |
| Install | `/opt/vpnserver` (+ symlink `/usr/local/vpnserver`) |
| Hub | `JMVPN` / hub pass `HubPass2026` |
| SecureNAT | `192.168.30.1` · DHCP `192.168.30.101–200` |
| Listeners | **992**, 1194, **4443**, 5555 (TCP 443 Error — nginx owns 443) |
| Admin env | `/etc/jm-softether.env` → `VPN_ADMIN_PASSWORD` |
| Public dial | **`jmwifi.pro:992`** (also `:4443`) |

```bash
# vpncmd (use /ADMINHUB after server password)
source /etc/jm-softether.env
/opt/vpnserver/vpncmd 127.0.0.1:5555 /SERVER /PASSWORD:"$VPN_ADMIN_PASSWORD" \
  /ADMINHUB:JMVPN /CMD UserList
```

## Create VPN Client (billing)

| UI | API | SoftEther |
|----|-----|-----------|
| **+ Add VPN Client v6** | `POST /api/billing/vpn-ros6` | Creates hub user + Mikrotik script `connect-to=jmwifi.pro:992` + site in routers |
| **+ Add VPN Client** (JM Ops iframe) | `POST /cctv/api/vpn/create` | SoftEther user + SSTP script |
| VPN Clients table / API | `POST /api/vpn/clients` | SoftEther user + script with `:992` |

Billing env (excerpt):

```
PUBLIC_URL=https://jmwifi.pro
VPN_SERVER_IP=jmwifi.pro
VPN_PUBLIC_HOST=jmwifi.pro
JM_VPN_SSTP_PORT=992
VPN_DIAL_PORT=992
```

Settings DB: `jm_vpn_host=jmwifi.pro`, `jm_vpn_sstp_port=992`, `jm_vpn_hub=JMVPN`, `vpn_sstp_server=jmwifi.pro`.

## JM Ops (`/cctv/`)

- Service: `jm-mrp.service` on `127.0.0.1:8081`
- nginx proxies `/cctv/` → MRP
- Status: `GET /cctv/api/vpn-status`
- Create: SoftEther form when `?tab=vpn&action=add`
- `VPN_PUBLIC=jmwifi.pro:992`

## Site MikroTiks still offline until

Existing routers that still dial **CORE** `112.208.245.181:4443` need either:

1. CORE NAT/SSTP restored, **or**
2. Re-run the new MikroTik SSTP script (dial `jmwifi.pro:992`), **or**
3. If they dial hostname `jmestre.tech`, point DNS A → `187.77.145.131` and ensure SoftEther listens on the port they use.

New clients created from billing/JM Ops already dial **jmwifi.pro:992**.

## Smoke checks

```bash
# Public listeners
nc -vz jmwifi.pro 992
nc -vz jmwifi.pro 4443

curl -sS https://jmwifi.pro/api/vpn/info
curl -sS https://jmwifi.pro/cctv/api/vpn-status
```
