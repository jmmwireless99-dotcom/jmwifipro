#!/usr/bin/env bash
set -euo pipefail
ROOT=/workspace
TAR="$ROOT/backup/20260703T234918Z/app/jm-billing.tar.gz"
test -f "$TAR"
command -v node >/dev/null
node -e 'const [maj]=process.versions.node.split(".").map(Number); if (maj < 22) { console.error("Node 22+ required"); process.exit(1); }'
rm -rf "$ROOT/run/jm-billing"
mkdir -p "$ROOT/run"
tar -xzf "$TAR" -C "$ROOT/run"
rm -rf "$ROOT/run/jm-billing/jm-billing"
test -f "$ROOT/run/jm-billing/server.js"
rm -f "$ROOT/run/jm-billing/billing.db" "$ROOT/run/jm-billing/billing.db-wal" "$ROOT/run/jm-billing/billing.db-shm"
printf '%s\n' 'PORT=3000' 'PUBLIC_URL=http://localhost:3000' 'RESET_ADMIN=1' > "$ROOT/run/jm-billing/.env"
if [ -d "$ROOT/app/jm-billing" ]; then
  cp -a "$ROOT/app/jm-billing/." "$ROOT/run/jm-billing/"
  rm -f "$ROOT/run/jm-billing/billing.db" "$ROOT/run/jm-billing/billing.db-wal" "$ROOT/run/jm-billing/billing.db-shm"
fi
if [ -f "$ROOT/run/jm-billing/lib/vps-host.js" ] && ! grep -q '/api/vps/status' "$ROOT/run/jm-billing/server.js"; then
  python3 - <<'PY'
from pathlib import Path
p = Path("/workspace/run/jm-billing/server.js")
src = p.read_text()
imp = 'import { vpsHostStatus } from "./lib/vps-host.js";\n'
if "vps-host.js" not in src:
    src = src.replace(
        'import { MikroTik } from "./lib/mikrotik.js";\n',
        'import { MikroTik } from "./lib/mikrotik.js";\n' + imp,
        1,
    )
if '"/api/vps/status"' not in src:
    src = src.replace(
        '"/api/status": async () => ({ resource: await mt.systemResource(), identity: await mt.identity() }),',
        '"/api/status": async () => ({ resource: await mt.systemResource(), identity: await mt.identity() }),\n  "/api/vps/status": () => vpsHostStatus(),',
        1,
    )
p.write_text(src)
print("patched server.js for /api/vps/status")
PY
fi
node --check "$ROOT/run/jm-billing/server.js"
echo "jm-billing-install-ok"
