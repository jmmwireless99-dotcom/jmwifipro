#!/usr/bin/env bash
# Full jmwifi.pro + MikroTik log cleanup (run on VPS as root).
set -euo pipefail
APP="${APP:-/opt/jm-billing}"
TOOLS="$(cd "$(dirname "$0")" && pwd)"
export BILLING_DB="${BILLING_DB:-$APP/billing.db}"
export JM_BILLING_DIR="${JM_BILLING_DIR:-$APP}"

echo "==> Panel log tables + mikrotik settings fix"
node "$TOOLS/clean-panel-logs.mjs"

echo "==> MikroTik router logs"
node "$TOOLS/clean-mikrotik-logs.mjs" || echo "Warning: some routers could not be reached from this host."

echo "==> Restart jm-billing"
systemctl restart jm-billing
sleep 2
systemctl is-active jm-billing && echo "Panel OK" || journalctl -u jm-billing -n 15 --no-pager

echo "Done."
