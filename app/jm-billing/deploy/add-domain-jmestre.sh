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

step "Write nginx site ${SITE_NAME}"
apt-get install -y nginx certbot python3-certbot-nginx >/dev/null
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

# Optional: keep PUBLIC_URL in sync if .env exists
if [ -f /opt/jm-billing/.env ]; then
  step "Update PUBLIC_URL in /opt/jm-billing/.env"
  if grep -q '^PUBLIC_URL=' /opt/jm-billing/.env; then
    sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=https://${DOMAIN}|" /opt/jm-billing/.env
  else
    echo "PUBLIC_URL=https://${DOMAIN}" >> /opt/jm-billing/.env
  fi
  systemctl restart jm-billing 2>/dev/null || true
  ok "PUBLIC_URL=https://${DOMAIN}"
fi

step "Smoke check"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' -H "Host: ${DOMAIN}" http://127.0.0.1/ || true)"
echo "  Host: ${DOMAIN} → HTTP ${CODE}"
CODE2="$(curl -sS -o /dev/null -w '%{http_code}' "https://${DOMAIN}/" || true)"
echo "  https://${DOMAIN}/ → HTTP ${CODE2}"
ok "Done — use https://${DOMAIN}"
