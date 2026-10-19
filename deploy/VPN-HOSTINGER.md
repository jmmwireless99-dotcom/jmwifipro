# jmwifi.pro — Billing + VPN tunnel (Hostinger)

**Billing + site SSTP:** `https://jmwifi.pro` on `187.77.145.131`.  
**jmestre.tech** public site restored separately on MAGSAY PLDT — see `deploy/JMESTRE-PLDT-UP.md`.

## Services

| Role | Detail |
|------|--------|
| Billing | `https://jmwifi.pro` (pm2 `jm-billing`) |
| Site SSTP tunnel | **accel-ppp** `:4443` · pool `10.90.0.0/24` · `/etc/ppp/chap-secrets` |
| API/Winbox DNAT | nftables `jm_vpn_dnat` → `10.90.0.x:8728/8291` |
| SoftEther (optional) | `:992` / `:5555` hub `JMVPN` — not used for site tunnels |
| JM Ops | `/cctv/` → SoftEther/accel status + Create VPN |

## RouterOS 7 SSTP syntax

Do **not** use `connect-to="jmwifi.pro:4443"`. Use separate fields (IP preferred):

```
/interface sstp-client add name="sstp-cctv" connect-to="187.77.145.131" port=4443 user="..." password="..." disabled=no verify-server-certificate=no verify-server-address-from-certificate=no
```

accel-ppp uses an **RSA** cert on `:4443` (MikroTik rejects ECDSA LE on SSTP).

## Online via CORE mac-telnet (2026-10-19)

MAGSAY2X PLDT `124.107.120.113` reachable (SSH/API). Pushed Hostinger SSTP to:

| Site | Tunnel IP |
|------|-----------|
| MAGSAY2X-CORE | 10.90.0.33 |
| 1STSERVER | 10.90.0.10 |
| 2NDSERVER | 10.90.0.11 |
| 4THSERVER | 10.90.0.21 |
| 5THSERVER | 10.90.0.22 |
| CANDELARIA (PPPOE-JMPRO) | 10.90.0.13 |

Still need local/mac access: 3RDSERVER (admin pass mismatch), CAWAYAN/CCR/SANCARLOS (no L3 neighbor).

## Create VPN Client

Billing **+ Add VPN Client v6** or JM Ops Create → writes chap-secrets + DNAT + MikroTik script with `connect-to` + `port=4443`.

## Smoke

```bash
curl -sS https://jmwifi.pro/api/vpn/info
ss -tlnp | grep 4443
accel-cmd show sessions
```
