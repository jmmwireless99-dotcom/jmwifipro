#!/usr/bin/env bash
# Deploy Sales History UI button + page to live jmwifi.pro (/opt/jm-billing).
#
# Run ON the VPS (as root or the jm-billing user):
#   curl -fsSL https://raw.githubusercontent.com/jmmwireless99-dotcom/jmwifipro/cursor/sales-history-barangay-ecd6/deploy/push-live.sh | bash
# or:
#   bash deploy/push-live.sh
set -euo pipefail

APP="${JM_BILLING_ROOT:-/opt/jm-billing}"
BRANCH="${JM_BRANCH:-cursor/sales-history-barangay-ecd6}"
REPO="${JM_REPO:-https://github.com/jmmwireless99-dotcom/jmwifipro.git}"
TMP="$(mktemp -d /tmp/jm-sales-history.XXXXXX)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

echo "==> Sales History live deploy"
echo "    app:    $APP"
echo "    branch: $BRANCH"

if [[ ! -d "$APP" ]]; then
  echo "ERROR: $APP not found. Set JM_BILLING_ROOT if billing lives elsewhere."
  exit 1
fi

echo "==> Fetch branch files"
git clone --depth 1 --branch "$BRANCH" "$REPO" "$TMP/repo"

copy_into() {
  local rel="$1"
  local src="$TMP/repo/$rel"
  local dst="$APP/$rel"
  if [[ ! -f "$src" ]]; then
    echo "    missing in branch: $rel"
    return 1
  fi
  mkdir -p "$(dirname "$dst")"
  cp -f "$src" "$dst"
  echo "    installed $rel"
}

echo "==> Install Sales History files into $APP"
copy_into lib/apply-coverage.mjs
copy_into lib/sales-history-data.mjs
copy_into lib/sales-history.mjs
copy_into lib/sales-history-nav.mjs
copy_into lib/sales-history-lock.mjs
copy_into lib/sales-history-api.mjs
copy_into public/sales-history.html
copy_into public/isp-landing.css
mkdir -p "$APP/public/landing"
copy_into public/landing/index.html
copy_into deploy/sales-history.mjs

echo "==> Patch operator panel + landing + server routes"
cd "$APP"
node deploy/sales-history.mjs
node --input-type=module -e "
  import fs from 'node:fs';
  import { patchSalesHistoryApi } from './lib/sales-history-api.mjs';
  const p = 'server.js';
  const cur = fs.readFileSync(p, 'utf8');
  const next = patchSalesHistoryApi(cur);
  if (next.missing) console.warn('API patch miss:', next.missing);
  if (next.changed) { fs.writeFileSync(p, next.src); console.log('patched server.js (sales-history API PUT/DELETE + lock)'); }
  else console.log('server.js API already patched or no match');
"

# If landing HTML is not under public/landing/index.html on this box,
# try to find the live homepage file that contains isp-nav-cta and patch it.
echo "==> Search/patch any other landing HTML that still lacks the button"
while IFS= read -r -d '' f; do
  if grep -q 'isp-nav-cta' "$f" && ! grep -q 'isp-sales-history-nav' "$f"; then
    echo "    patching landing candidate: $f"
    node -e "
      import { patchLandingHtml } from './lib/sales-history-nav.mjs';
      import fs from 'node:fs';
      const p = process.argv[1];
      const cur = fs.readFileSync(p, 'utf8');
      const next = patchLandingHtml(cur);
      if (next.changed) { fs.writeFileSync(p, next.src); console.log('    wrote', p); }
      else console.log('    no change', p, next.missing || '');
    " "$f"
  fi
done < <(find "$APP/public" -type f \( -name '*.html' -o -name '*.htm' \) -print0 2>/dev/null || true)

echo "==> Restart jm-billing"
if systemctl restart jm-billing; then
  systemctl --no-pager --full status jm-billing | head -20 || true
else
  echo "WARN: systemctl restart failed — restart the Node process manually."
fi

echo
echo "DONE. Verify:"
echo "  https://jmwifi.pro/                 → green Sales History button"
echo "  https://jmwifi.pro/sales-history    → vendo list per barangay"
echo "  https://jmwifi.pro/operator         → sidebar Sales History"
