#!/usr/bin/env bash
# JM WIFI NETWORK — Hostinger VPS deploy (Ubuntu + nginx already common on Hostinger)
# Run ON the VPS after uploading this project to /opt/jm-billing
#
#   sudo bash deploy/hostinger-vps-setup.sh
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/jm-billing}"
DOMAIN="${DOMAIN:-jmwifi.pro}"
PORT="${PORT:-3000}"
NODE_MAJOR=22

step(){ printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }
ok(){ printf "\033[1;32m✓ %s\033[0m\n" "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
[ -f "$APP_DIR/server.js" ] || { echo "Missing $APP_DIR/server.js — upload the project first."; exit 1; }

step "Node.js ${NODE_MAJOR}"
if ! command -v node >/dev/null || [ "$(node -v | sed 's/v//;s/\..*//')" -lt "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
ok "Node $(node -v)"

step "Environment"
cat > "$APP_DIR/.env" <<EOF
PORT=$PORT
PUBLIC_URL=https://${DOMAIN}
EOF
ok ".env written"

step "systemd service (jm-billing)"
cat > /etc/systemd/system/jm-billing.service <<EOF
[Unit]
Description=JM WIFI NETWORK Billing Panel
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR
Environment=PORT=$PORT
EnvironmentFile=-$APP_DIR/.env
ExecStart=$(command -v node) $APP_DIR/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable jm-billing
systemctl restart jm-billing
sleep 2
systemctl is-active jm-billing && ok "Panel running on port $PORT" || { journalctl -u jm-billing -n 20 --no-pager; exit 1; }

step "nginx reverse proxy for ${DOMAIN}"
apt-get install -y nginx certbot python3-certbot-nginx 2>/dev/null || true
cat > "/etc/nginx/sites-available/${DOMAIN}" <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name jmwifi.pro www.jmwifi.pro;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
NGINX
ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t && systemctl reload nginx
ok "nginx → localhost:${PORT}"

step "HTTPS (Let's Encrypt)"
if certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email 2>/dev/null; then
  ok "SSL certificate installed"
else
  echo "  SSL skipped — point DNS A record for ${DOMAIN} to this server IP first, then run:"
  echo "  sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}"
fi

echo ""
echo "============================================================"
echo "  Done. Open: http://${DOMAIN}  (or https after DNS + certbot)"
echo "  Logs:  journalctl -u jm-billing -f"
echo "  Admin: http://${DOMAIN}  (login admin / admin — change password)"
echo "============================================================"
