# VPN / JM Ops on Hostinger

## JM Ops
- Service: `jm-mrp.service` on `127.0.0.1:8081`
- nginx proxies `/cctv/` → MRP
- Fixes `Hindi ma-open ang JM Ops: fetch failed`

## SoftEther (site/client SSTP)
- `/opt/vpnserver` listening on **4443** (also 992/5555)
- Hub: `JMVPN` / `HubPass2026`
- Public: `187.77.145.131:4443`
- Billing settings: `jm_vpn_host` / `VPN_SERVER_IP` = Hostinger

## Site MikroTiks still offline until
CORE `112.208.245.181:4443` NAT restored **or** `jmestre.tech` DNS A → `187.77.145.131` (if routers dial hostname).
