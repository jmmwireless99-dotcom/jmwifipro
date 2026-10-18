# jmwifi.pro — Billing + VPN tunnel (Hostinger)

**Single active stack:** `https://jmwifi.pro` on `187.77.145.131`.  
`jmestre.tech` is ignored for now.

## Services

| Role | Detail |
|------|--------|
| Billing | `https://jmwifi.pro` (pm2 `jm-billing`) |
| Site SSTP tunnel | **accel-ppp** `:4443` · pool `10.90.0.0/24` · `/etc/ppp/chap-secrets` |
| API/Winbox DNAT | nftables `jm_vpn_dnat` → `10.90.0.x:8728/8291` |
| SoftEther (optional) | `:992` / `:5555` hub `JMVPN` — not used for site tunnels |
| JM Ops | `/cctv/` → SoftEther/accel status + Create VPN |

## Create VPN Client

Billing **+ Add VPN Client v6** or JM Ops Create → writes chap-secrets + DNAT + MikroTik script:

```
connect-to="jmwifi.pro:4443"
```

## Existing sites (still offline until re-scripted)

Old MikroTiks still dial `jmestre.tech:4443` (dead CORE). **Remote SSH/API/Winbox to site WANs is closed** — see `deploy/MIKROTIK-REMOTE-BLOCKED.md`. Bring a site online by pasting a **semicolon one-liner** via local Winbox:

- Live (with passwords): VPS `/opt/jm-billing/deploy/vpn-resync-oneliners/`
- Multi-line: VPS `/opt/jm-billing/deploy/vpn-resync-scripts/`
- Repo templates (passwords redacted): `deploy/vpn-resync-oneliners/`

Dial target: **`jmwifi.pro:4443`**.

## Smoke

```bash
curl -sS https://jmwifi.pro/api/vpn/info
curl -sS https://jmwifi.pro/cctv/api/vpn-status
ss -tlnp | grep 4443
accel-cmd show sessions
```
