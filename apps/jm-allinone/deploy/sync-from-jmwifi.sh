#!/usr/bin/env bash
# Copy live jmwifi.pro billing into /opt/jm-allinone on jmvps (copy-only; does not stop jmwifi).
set -euo pipefail
JW_HOST="${JW_HOST:-187.77.145.131}"
JW_PASS="${JW_PASS:?set JW_PASS}"
DEST="${DEST:-/opt/jm-allinone}"
sshpass -p "$JW_PASS" ssh -o StrictHostKeyChecking=no "root@$JW_HOST" \
  "sqlite3 /opt/jm-billing/billing.db '.backup /tmp/billing-clean.db'"
sshpass -p "$JW_PASS" scp -o StrictHostKeyChecking=no "root@$JW_HOST:/tmp/billing-clean.db" /tmp/billing-clean.db
echo "Downloaded clean billing.db — install onto \$DEST manually after stop/start."
