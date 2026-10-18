# MikroTik remote access blocked (2026-10-18)

## Verdict

**Cannot push SSTP scripts remotely.** No site has SSH/API/Winbox/REST open from the internet. Hostinger accel-ppp is ready; tunnels stay empty until someone pastes scripts via **local Winbox**.

## Hostinger (jmwifi.pro) — ready

| Check | Result |
|-------|--------|
| accel-ppp SSTP `:4443` | listening, `jmwifi.pro` → `187.77.145.131` |
| chap-secrets | 36 users / `10.90.0.x` |
| nft `jm_vpn_dnat` | high ports → tunnel IPs |
| `accel-cmd show sessions` | **empty** (0 active) |
| Billing high API ports | **closed** (no tunnels) |

## Remote probes exhausted

All known MAGSAY WANs probed: `112.208.245.181`, `124.217.34.195`, `124.217.34.83`, `49.147.38.236`, `49.147.41.124`, `49.147.52.199`, `49.147.60.142`, `124.105.235.44`.

| Port | Result |
|------|--------|
| 22, 8291, 8728, 4443, 22022, 992 | CLOSED/TIMEOUT everywhere |
| 80 / 443 | TCP “open” but blackhole or ISP Pingora **502** — not MikroTik REST/WebFig |

CORE recovery SSH `:22022` still closed — cannot jump MAGSAY2X or restore CORE NAT.

## Human steps (local Winbox)

1. Open each router in Winbox (you already have **CANDELARIA-PPPOE** / `PPPOE-JMPRO-IPOE`).
2. Paste the **semicolon one-liner** from VPS `/opt/jm-billing/deploy/vpn-resync-oneliners/<site>.one.txt` (or ask agent for the next site).
3. Prefer **MAGSAY2X-CORE** early if you can reach it on LAN — OSPF jump to peers.
4. After paste: `/interface sstp-client print` should show `R` (running); on Hostinger `accel-cmd show sessions` should list the user; billing API port opens.

## Priority paste order

1. MAGSAY2X-CORE (jump)
2. 1STSERVER, 2NDSERVER, 3RDSERVER
3. PPPOE-CCR1036, 4rth-server, 5thserver, CAWAYAN-SERVER
4. Remaining kitifi / offline radio sites (may need on-site radio first)

CANDELARIA-PPPOE one-liner was already provided; if session still missing, paste again and check `print` for errors.
