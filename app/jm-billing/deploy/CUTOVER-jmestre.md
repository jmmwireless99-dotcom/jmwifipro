# Cutover: jmwifi.pro → jmestre.tech

## Active billing
- **Panel:** `http://jmestre.tech` (JM VPS `112.209.31.253`)
- **Settings `public_url`:** `http://jmestre.tech`
- **`dry_run=0`** (live writer — SAFE MODE banner hidden when routers enabled)
- Old Hostinger/VPS panel at `187.77.145.131` (`jmwifi.pro`) is **stopped**

## Old VPS (`187.77.145.131` / jmwifi.pro)
- `systemctl stop|disable jm-billing`
- nginx returns `301` → `http://jmestre.tech$request_uri` (HTTP + HTTPS)

## MikroTik sites
All routers on the jmestre panel were set `enabled=1`.  
Portal / suspended redirects that still use `jmwifi.pro` will follow the 301 to `jmestre.tech`.

For a clean MikroTik config, update each site’s portal / dst-nat / walled-garden host to **`jmestre.tech`** (or `http://jmestre.tech`) instead of `jmwifi.pro`.

## Optional next steps
1. On JM VPS console: run certbot for `jmestre.tech` + `www`, then set `public_url=https://jmestre.tech`
2. Allowlist `www.jmestre.tech` in `portalHostNames` on `/opt/jm-billing/server.js`
3. Fix down tunnels (e.g. CAGBATANG, PPPOE-PRO) on `jmtechsolution.cloud`
