#!/usr/bin/env bash
# Paste this whole file into Hostinger VPS Browser Terminal (as root) on 112.209.31.253
# to bind jmestre.tech → jm-billing (:3000) + Let's Encrypt.
set -euo pipefail
DOMAIN=jmestre.tech
EXPECT_IP=112.209.31.253
APP_PORT=3000
SITE=/etc/nginx/sites-available/jmestre.tech

echo "==> DNS check"
DNS_IP="$(getent ahostsv4 "$DOMAIN" | awk '{print $1; exit}' || true)"
echo "  $DOMAIN → ${DNS_IP:-unresolved} (want $EXPECT_IP)"
[ "$DNS_IP" = "$EXPECT_IP" ] || { echo "Fix DNS A @/www to $EXPECT_IP first"; exit 1; }

echo "==> Ensure jm-billing is up"
systemctl enable --now jm-billing 2>/dev/null || true
if ! curl -fsS --max-time 3 "http://127.0.0.1:${APP_PORT}/" >/dev/null; then
  echo "jm-billing not answering on :${APP_PORT}. Start it first (systemctl start jm-billing)."
  exit 1
fi

echo "==> Write nginx site"
apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx
cat > "$SITE" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};

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
ln -sf "$SITE" /etc/nginx/sites-enabled/jmestre.tech
# Prefer this vhost for the domain; leave other sites alone
nginx -t
systemctl reload nginx

echo "==> Let's Encrypt"
certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email \
  --redirect -d "$DOMAIN" -d "www.$DOMAIN"
nginx -t && systemctl reload nginx

if [ -f /opt/jm-billing/.env ]; then
  if grep -q '^PUBLIC_URL=' /opt/jm-billing/.env; then
    sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=https://${DOMAIN}|" /opt/jm-billing/.env
  else
    echo "PUBLIC_URL=https://${DOMAIN}" >> /opt/jm-billing/.env
  fi
  systemctl restart jm-billing 2>/dev/null || true
fi

echo "==> Smoke"
curl -sS -o /dev/null -w "http Host: %{http_code}\n" -H "Host: ${DOMAIN}" http://127.0.0.1/ || true
curl -sS -o /dev/null -w "https: %{http_code}\n" "https://${DOMAIN}/" || true
echo "Done → https://${DOMAIN}"
