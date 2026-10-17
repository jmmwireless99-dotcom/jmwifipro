#!/bin/bash
# Install official LibreQoS 2.2 on the shaper box (Ubuntu/Debian, amd64).
# JM billing does not run on this machine. After install, create an API key
# in LibreQoS License & Services and point the JM bridge at http://<shaper>:9122.
set -euo pipefail

DEB_URL="${LQOS_DEB_URL:-https://download.libreqos.com/libreqos_2.2.202609081854-1_amd64.deb}"
WORKDIR="${TMPDIR:-/tmp}/jm-libreqos-deb"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

sudo apt-get update
sudo apt-get install -y ca-certificates wget
wget -O libreqos.deb "$DEB_URL"
sudo apt-get install -y ./libreqos.deb

if [[ -f /opt/libreqos/src/bin/lqos_api.service.example ]]; then
  sudo cp /opt/libreqos/src/bin/lqos_api.service.example /etc/systemd/system/lqos_api.service
  sudo systemctl daemon-reload
  sudo systemctl enable --now lqos_api
fi

echo "LibreQoS 2.2 package installed."
echo "Open the shaper WebUI, finish first-run setup, then create a named API key."
echo "On the billing host, run: node jm-libreqos/server.js"
