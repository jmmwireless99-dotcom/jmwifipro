# Reverse redirect: jmwifi.pro → jmestre.tech

## Goal
Opening **jmwifi.pro** must land on **jmestre.tech** (public JM ESTRE landing).

## Live Hostinger state
- Failover scripts: `jm-jmwifi-failover.sh`, `jm-cutover-jmestre-dns.sh`
- While CORE WAN (`112.208.245.181`) for jmestre is down, jmwifi **serves** the landing so the site stays up.
- When jmestre is healthy (or DNS is moved to Hostinger), failover switches to **301 → https://jmestre.tech**.

## Finish cutover (DNS)
1. Hostinger hPanel → Domains → **jmestre.tech** → DNS  
2. A record `@` → `187.77.145.131` (same for `www` if it is an A record)  
3. On VPS: `jm-cutover-jmestre-dns.sh`  
4. Confirm: `curl -sI https://jmwifi.pro/` → `Location: https://jmestre.tech/`

## Nginx reference
See `deploy/nginx-jmwifi-to-jmestre.conf`.
