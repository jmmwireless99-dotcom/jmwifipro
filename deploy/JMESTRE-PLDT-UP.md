# jmestre.tech on MAGSAY2X PLDT public IP

## Public IP
- Interface: `PLDT-SEM` (PPPoE) on **MAGSAY2X-CORE**
- Address: **124.107.120.113**
- Backend: `192.168.200.155` (jmvps) via DNAT

## Ports forwarded (dst-address `124.107.120.113` → `192.168.200.155`)
| WAN port | Backend | Purpose |
|----------|---------|---------|
| 80 | 80 | HTTP |
| 443 | 443 | HTTPS (LE cert `jmestre.tech`) |
| 4443 | 4443 | SSTP / SoftEther path |
| 992 | 992 | SoftEther |
| 5555 | 5555 | SoftEther |
| 22022 | 22 | jmvps SSH (may still be filtered) |

Hairpin NAT for LAN clients dialing the public IP is also present (`jmestre-pldt-hairpin-*`).

## DNS (required)
Hostinger DNS for `jmestre.tech` still pointed at dead CORE WAN `112.208.245.181`.

In **Hostinger hPanel → Domains → jmestre.tech → DNS**:
1. Set **A** `@` → `124.107.120.113`
2. Set **A** `www` → `124.107.120.113` (or CNAME to `@`)
3. Wait for TTL, then `dig +short jmestre.tech` should return `124.107.120.113`

Until DNS updates, the site is reachable by IP:
- `http://124.107.120.113/`
- `https://124.107.120.113/` (cert name is `jmestre.tech`)

## Parallel tunnel path: jmwifi.pro
Billing/VPN cutover target remains **jmwifi.pro** (`187.77.145.131:4443` accel-ppp).
MAGSAY2X-CORE and several site routers now dial Hostinger SSTP (`connect-to=187.77.145.131` `port=4443`) with static `10.90.0.x` from chap-secrets.
