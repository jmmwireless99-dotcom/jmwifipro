#!/usr/bin/env bash
# Paste into Hostinger VPS Browser Terminal as root on 112.209.31.253
# Fixes: jmestre.tech → captive /welcome?suspended=1 (wrong host allowlist)
# Then: nginx + Let's Encrypt → https://jmestre.tech
set -euo pipefail
DOMAIN=jmestre.tech
EXPECT_IP=112.209.31.253
APP_PORT=3000
APP_DIR=/opt/jm-billing
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

echo "==> Allowlist ${DOMAIN} in portalHostNames (stops /welcome?suspended=1 redirect)"
if [ -f "${APP_DIR}/server.js" ]; then
  cp -a "${APP_DIR}/server.js" "${APP_DIR}/server.js.bak-jmestre-$(date +%Y%m%d%H%M%S)"
  python3 - <<'PY'
from pathlib import Path
p = Path("/opt/jm-billing/server.js")
src = p.read_text()
needle = 'for (const h of ["jmwifi.pro", "www.jmwifi.pro", "187.77.145.131"]) hosts.add(h);'
repl = 'for (const h of ["jmwifi.pro", "www.jmwifi.pro", "187.77.145.131", "jmestre.tech", "www.jmestre.tech", "112.209.31.253"]) hosts.add(h);'
if "jmestre.tech" not in src or needle in src:
    if needle in src:
        src = src.replace(needle, repl, 1)
        p.write_text(src)
        print("patched portalHostNames")
    elif "jmestre.tech" in src:
        print("portalHostNames already mentions jmestre.tech")
    else:
        print("WARN: portalHostNames pattern not found — will rely on public_url setting")
else:
    print("portalHostNames already patched")
PY
fi

echo "==> Set public_url=https://${DOMAIN} in SQLite + .env"
if command -v sqlite3 >/dev/null && [ -f "${APP_DIR}/billing.db" ]; then
  sqlite3 "${APP_DIR}/billing.db" \
    "INSERT INTO settings (k,v) VALUES ('public_url','https://${DOMAIN}') ON CONFLICT(k) DO UPDATE SET v=excluded.v;"
  echo "  settings.public_url updated"
else
  # node:sqlite fallback
  node --input-type=module - <<'NODE' || true
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("/opt/jm-billing/billing.db");
db.prepare("INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v")
  .run("public_url", "https://jmestre.tech");
console.log("  settings.public_url updated via node:sqlite");
NODE
fi

if [ -f "${APP_DIR}/.env" ]; then
  if grep -q '^PUBLIC_URL=' "${APP_DIR}/.env"; then
    sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=https://${DOMAIN}|" "${APP_DIR}/.env"
  else
    echo "PUBLIC_URL=https://${DOMAIN}" >> "${APP_DIR}/.env"
  fi
fi

echo "==> Write nginx site"
apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx sqlite3 >/dev/null || apt-get install -y -qq nginx certbot python3-certbot-nginx
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
nginx -t
systemctl reload nginx

echo "==> Restart jm-billing"
systemctl restart jm-billing
sleep 2

echo "==> Let's Encrypt"
certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email \
  --redirect -d "$DOMAIN" -d "www.$DOMAIN" || echo "WARN: certbot failed (HTTP may still work); check DNS/ports"
nginx -t && systemctl reload nginx || true

echo "==> Smoke"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' -H "Host: ${DOMAIN}" http://127.0.0.1:${APP_PORT}/ || true)"
echo "  app Host ${DOMAIN} → HTTP ${CODE} (want 200, not 302)"
curl -sS -o /dev/null -w "  https://${DOMAIN}/ → %{http_code}\n" "https://${DOMAIN}/" || true
curl -sS -o /dev/null -w "  http://${DOMAIN}/  → %{http_code}\n" "http://${DOMAIN}/" || true
LOC="$(curl -sI -H "Host: ${DOMAIN}" "http://127.0.0.1:${APP_PORT}/" | tr -d '\r' | awk -F': ' 'tolower($1)=="location"{print $2}')"
[ -n "${LOC:-}" ] && echo "  Location: ${LOC}" || true
if [ "$CODE" = "200" ]; then
  echo "Done → https://${DOMAIN} (JEFF NETWORK SERVICE panel)"
else
  echo "Still not 200 — check ${APP_DIR}/server.js portalHostNames and settings.public_url"
  exit 1
fi
