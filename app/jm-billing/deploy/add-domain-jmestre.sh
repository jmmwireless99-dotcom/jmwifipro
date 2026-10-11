#!/usr/bin/env bash
# Add jmestre.tech to the JM VPS nginx + Let's Encrypt (same panel as jmwifi.pro).
# Run ON the VPS as root after DNS A records point here:
#   A  @    → 187.77.145.131
#   A  www  → 187.77.145.131
#
#   sudo bash /opt/jm-billing/deploy/add-domain-jmestre.sh
#
set -euo pipefail

DOMAIN_MAIN="${DOMAIN_MAIN:-jmwifi.pro}"
DOMAIN_NEW="${DOMAIN_NEW:-jmestre.tech}"
APP_PORT="${APP_PORT:-3000}"
SITE_NAME="${SITE_NAME:-jm-billing}"
NGINX_AVAIL="/etc/nginx/sites-available/${SITE_NAME}"
NGINX_EN="/etc/nginx/sites-enabled/${SITE_NAME}"

step(){ printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }
ok(){ printf "\033[1;32m✓ %s\033[0m\n" "$*"; }
die(){ printf "\033[1;31m✗ %s\033[0m\n" "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run with sudo / as root"

step "Check DNS for ${DOMAIN_NEW} points at this VPS"
VPS_IP="$(curl -4 -sS --max-time 8 ifconfig.me || curl -4 -sS --max-time 8 icanhazip.com || true)"
DNS_IP="$(getent ahostsv4 "${DOMAIN_NEW}" | awk '{print $1; exit}' || true)"
echo "  VPS public IP: ${VPS_IP:-unknown}"
echo "  ${DOMAIN_NEW} → ${DNS_IP:-unresolved}"
if [ -n "${VPS_IP:-}" ] && [ -n "${DNS_IP:-}" ] && [ "${VPS_IP}" != "${DNS_IP}" ]; then
  die "DNS for ${DOMAIN_NEW} is ${DNS_IP}, not this VPS (${VPS_IP}). Fix Hostinger A records first."
fi
if [ -z "${DNS_IP:-}" ]; then
  die "Could not resolve ${DOMAIN_NEW}. Point A @ and www to this VPS, wait for propagation, then re-run."
fi
ok "DNS looks correct"

step "Write nginx site (${SITE_NAME})"
apt-get install -y nginx certbot python3-certbot-nginx >/dev/null
cat > "${NGINX_AVAIL}" <<NGINX
# Managed by deploy/add-domain-jmestre.sh — jmwifi.pro + jmestre.tech → :${APP_PORT}
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${DOMAIN_MAIN} www.${DOMAIN_MAIN} ${DOMAIN_NEW} www.${DOMAIN_NEW} _;

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
# Avoid duplicate default_server conflicts from old site files
rm -f /etc/nginx/sites-enabled/jmwifi.pro 2>/dev/null || true
nginx -t
systemctl reload nginx
ok "nginx reloaded (HTTP)"

step "Let's Encrypt certificate (expand to include ${DOMAIN_NEW})"
certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email \
  --redirect \
  -d "${DOMAIN_MAIN}" -d "www.${DOMAIN_MAIN}" \
  -d "${DOMAIN_NEW}" -d "www.${DOMAIN_NEW}" \
  || certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email \
       --redirect \
       -d "${DOMAIN_NEW}" -d "www.${DOMAIN_NEW}"
nginx -t && systemctl reload nginx
ok "TLS ready"

step "Smoke check"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' -H "Host: ${DOMAIN_NEW}" http://127.0.0.1/ || true)"
echo "  Host: ${DOMAIN_NEW} → HTTP ${CODE}"
CODE2="$(curl -sS -o /dev/null -w '%{http_code}' "https://${DOMAIN_NEW}/" || true)"
echo "  https://${DOMAIN_NEW}/ → HTTP ${CODE2}"
ok "Done — panel should answer on https://${DOMAIN_NEW} and https://${DOMAIN_MAIN}"
