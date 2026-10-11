#!/usr/bin/env bash
# Install JM All-in-One (billing + VPN client + VPS inventory) on Ubuntu.
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/jm-allinone}"
PORT="${PORT:-3000}"
SERVICE_NAME="${SERVICE_NAME:-jm-allinone}"
NODE_MAJOR=22

echo "==> Installing Node.js ${NODE_MAJOR} if needed"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//;s/\..*//')" -lt "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "Node: $(node -v)"

echo "==> Installing app into ${APP_DIR}"
sudo mkdir -p "$APP_DIR"
sudo rsync -a --delete \
  --exclude 'billing.db' --exclude 'billing.db-*' --exclude '.env' \
  ./ "$APP_DIR/" 2>/dev/null || sudo cp -a ./ "$APP_DIR/"
# Keep existing DB if present
if [ ! -f "$APP_DIR/billing.db" ] && [ -f ./billing.db ]; then
  sudo cp ./billing.db "$APP_DIR/billing.db"
fi
sudo chown -R "$USER:$USER" "$APP_DIR"

NODE_BIN="$(command -v node)"
echo "==> systemd unit ${SERVICE_NAME}"
sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null <<EOF
[Unit]
Description=JM TECH All-in-One Billing + VPN + VPS
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP_DIR
Environment=PORT=$PORT
Environment=PUBLIC_URL=http://100.101.1.71:$PORT
EnvironmentFile=-$APP_DIR/.env
ExecStart=$NODE_BIN $APP_DIR/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"
sleep 2
sudo systemctl --no-pager --full status "$SERVICE_NAME" | head -25
echo
echo "Open: http://127.0.0.1:${PORT}/hub"
echo "VPN:  http://127.0.0.1:${PORT}/vpn"
echo "Panel login default: admin / admin  (change immediately)"
