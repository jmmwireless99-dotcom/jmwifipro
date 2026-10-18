# VPN on Hostinger `187.77.145.131` (jmwifi.pro)

## Why sites were offline
Billing sites dial **`jmestre.tech:4443`** (DNS A = dead CORE `112.208.245.181`). Accel-PPP/SSTP + high-port DNAT lived on jmvps behind CORE. CORE :4443/:22022 timed out → **ONLINE 0/16**.

## Fix applied on Hostinger
1. **accel-ppp SSTP** on `:4443` with production `/etc/ppp/chap-secrets` (36 users, static `10.90.0.x`)
2. **nftables DNAT** `jm_vpn_dnat`: public high ports → `10.90.0.x:8728/8291` (same map as jmvps)
3. Billing **routers.host** → `187.77.145.131` (ports unchanged)
4. SoftEther kept on **992/5555** for new create-client v6 path
5. Per-site resync scripts: `/opt/jm-billing/deploy/vpn-resync-scripts/*.rsc` (dial `187.77.145.131:4443`)

## REQUIRED to bring sites online
Point DNS so MikroTiks hit Hostinger:

```
jmestre.tech  A  →  187.77.145.131
```

Hostinger hPanel → Domains → jmestre.tech → DNS.  
After TTL, SSTP sessions appear: `accel-cmd show sessions`

**Or** paste each site’s `.rsc` from `deploy/vpn-resync-scripts/` on the MikroTik (uses IP, skips DNS).

## Smoke
```bash
ss -tlnp | grep 4443          # accel-pppd
nft list table ip jm_vpn_dnat | head
accel-cmd show sessions
curl -sS https://jmwifi.pro/api/vpn/info
```
