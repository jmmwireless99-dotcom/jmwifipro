#!/bin/bash
# Join the LibreQoS VM to Tailscale so install and admin happen over the tailnet.
# Run this on the VM console. Management is ens18 (192.168.200.148 in the current VM).
# Tailscale uses its own interface. It does not sit on the shaping bridge, and it
# does not advertise a route or an exit node, so subscriber traffic stays on the 10G path.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root on the LibreQoS VM: sudo bash deploy/install-tailscale.sh" >&2
  exit 1
fi

if ! command -v tailscale >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl
  curl -fsSL https://tailscale.com/install.sh | sh
fi

systemctl enable --now tailscaled

args=(
  --ssh
  --hostname=jm-libreqos
  --accept-dns=true
  --accept-routes=false
  --advertise-exit-node=false
)
if [[ -n "${TS_AUTHKEY:-}" ]]; then
  args+=(--auth-key "$TS_AUTHKEY")
fi

tailscale up "${args[@]}"

echo
echo "Tailscale IPv4: $(tailscale ip -4 || true)"
echo "LAN management ens18 stays on 192.168.200.148."
echo "SSH from the tailnet: ssh root@$(tailscale ip -4)"
echo "Then install LibreQoS: bash deploy/install-libreqos-2.2.sh"
