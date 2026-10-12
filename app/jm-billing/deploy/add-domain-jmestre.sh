#!/usr/bin/env bash
# Bind jmestre.tech to this VPS (default target: 112.209.31.253) via nginx + Let's Encrypt.
# Same JEFF NETWORK SERVICE panel (port 3000).
#
# DNS first (Hostinger):
#   A  @    → 112.209.31.253
#   A  www  → 112.209.31.253
#
#   sudo bash /opt/jm-billing/deploy/add-domain-jmestre.sh
#
set -euo pipefail

DOMAIN="${DOMAIN:-jmestre.tech}"
EXPECT_IP="${EXPECT_IP:-112.209.31.253}"
APP_PORT="${APP_PORT:-3000}"
SITE_NAME="${SITE_NAME:-jmestre.tech}"
NGINX_AVAIL="/etc/nginx/sites-available/${SITE_NAME}"
NGINX_EN="/etc/nginx/sites-enabled/${SITE_NAME}"

step(){ printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }
ok(){ printf "\033[1;32m✓ %s\033[0m\n" "$*"; }
die(){ printf "\033[1;31m✗ %s\033[0m\n" "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run with sudo / as root"

step "Check DNS for ${DOMAIN} → ${EXPECT_IP}"
VPS_IP="$(curl -4 -sS --max-time 8 ifconfig.me || curl -4 -sS --max-time 8 icanhazip.com || true)"
DNS_IP="$(getent ahostsv4 "${DOMAIN}" | awk '{print $1; exit}' || true)"
echo "  This server IP: ${VPS_IP:-unknown}"
echo "  ${DOMAIN} resolves: ${DNS_IP:-unresolved}"
echo "  Expected: ${EXPECT_IP}"
if [ -n "${VPS_IP:-}" ] && [ "${VPS_IP}" != "${EXPECT_IP}" ]; then
  echo "  (warning) Public IP ${VPS_IP} ≠ EXPECT_IP ${EXPECT_IP} — continuing if DNS matches this host."
fi
if [ -z "${DNS_IP:-}" ]; then
  die "Could not resolve ${DOMAIN}. Set Hostinger A @ and www to ${EXPECT_IP}, wait, re-run."
fi
if [ "${DNS_IP}" != "${EXPECT_IP}" ] && [ -n "${VPS_IP:-}" ] && [ "${DNS_IP}" != "${VPS_IP}" ]; then
  die "DNS for ${DOMAIN} is ${DNS_IP}, not ${EXPECT_IP}/${VPS_IP}. Fix A records first."
fi
ok "DNS OK (${DNS_IP})"

step "Allowlist ${DOMAIN} (stop captive /welcome?suspended=1 redirect)"
if [ -f /opt/jm-billing/server.js ]; then
  cp -a /opt/jm-billing/server.js "/opt/jm-billing/server.js.bak-jmestre-$(date +%Y%m%d%H%M%S)"
  python3 - <<'PY'
from pathlib import Path
p = Path("/opt/jm-billing/server.js")
src = p.read_text()
needle = 'for (const h of ["jmwifi.pro", "www.jmwifi.pro", "187.77.145.131"]) hosts.add(h);'
repl = 'for (const h of ["jmwifi.pro", "www.jmwifi.pro", "187.77.145.131", "jmestre.tech", "www.jmestre.tech", "112.209.31.253"]) hosts.add(h);'
if needle in src:
    p.write_text(src.replace(needle, repl, 1))
    print("patched portalHostNames")
elif "jmestre.tech" in src:
    print("portalHostNames already mentions jmestre.tech")
else:
    print("WARN: portalHostNames pattern not found")
PY
fi

step "Set settings.public_url=https://${DOMAIN}"
if command -v sqlite3 >/dev/null && [ -f /opt/jm-billing/billing.db ]; then
  sqlite3 /opt/jm-billing/billing.db \
    "INSERT INTO settings (k,v) VALUES ('public_url','https://${DOMAIN}') ON CONFLICT(k) DO UPDATE SET v=excluded.v;"
  ok "SQLite public_url updated"
fi
if [ -f /opt/jm-billing/.env ]; then
  if grep -q '^PUBLIC_URL=' /opt/jm-billing/.env; then
    sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=https://${DOMAIN}|" /opt/jm-billing/.env
  else
    echo "PUBLIC_URL=https://${DOMAIN}" >> /opt/jm-billing/.env
  fi
  ok ".env PUBLIC_URL=https://${DOMAIN}"
fi
systemctl restart jm-billing 2>/dev/null || true

step "Write nginx site ${SITE_NAME}"
apt-get install -y nginx certbot python3-certbot-nginx sqlite3 >/dev/null
cat > "${NGINX_AVAIL}" <<NGINX
# Managed by deploy/add-domain-jmestre.sh — ${DOMAIN} → :${APP_PORT}
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN} ${EXPECT_IP};

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
NGINX
ln -sf "${NGINX_AVAIL}" "${NGINX_EN}"
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t
systemctl reload nginx
ok "nginx reloaded (HTTP)"

step "Let's Encrypt for ${DOMAIN}"
certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email \
  --redirect \
  -d "${DOMAIN}" -d "www.${DOMAIN}"
nginx -t && systemctl reload nginx
ok "TLS ready"

step "Smoke check"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' -H "Host: ${DOMAIN}" http://127.0.0.1:${APP_PORT}/ || true)"
echo "  app Host: ${DOMAIN} → HTTP ${CODE} (want 200)"
CODE2="$(curl -sS -o /dev/null -w '%{http_code}' "https://${DOMAIN}/" || true)"
echo "  https://${DOMAIN}/ → HTTP ${CODE2}"
[ "${CODE}" = "200" ] || die "Still redirecting/captive — check portalHostNames + public_url"
ok "Done — use https://${DOMAIN}"
