# MikroTik remote access notes

## MAGSAY2X-CORE (current)
- Public IP: `124.107.120.113` (PLDT-SEM) — SSH/API/Winbox open
- Admin user: `admin` (passwords stored on VPS `/etc/jm-mikrotik-admin.env`, not in git)
- Peer push path that works: `/tool mac-telnet` from CORE (API/SSH to peers often blackholed)

## Older WANs (often closed)
`112.208.245.181`, `124.217.34.*`, `49.147.*` ISP frontends — management frequently filtered.

See also `deploy/JMESTRE-PLDT-UP.md` and `deploy/VPN-HOSTINGER.md`.
