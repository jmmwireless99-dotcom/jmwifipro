#!/bin/bash
set -euo pipefail
LOG=/var/log/cloudflared-jmestre.log
DB=/opt/jm-allinone/billing.db

URL=""
for i in $(seq 1 30); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | tail -1 || true)
  if [ -n "$URL" ]; then break; fi
  sleep 2
done
if [ -z "$URL" ]; then
  echo "no tunnel url yet" >&2
  exit 1
fi

WEBHOOK_URL="${URL}/api/billing/paymongo/webhook"
SK=$(sqlite3 "$DB" "SELECT v FROM settings WHERE k='paymongo_secret';")
AUTH=$(printf "%s" "$SK:" | base64 -w0)

HOOK_ID=$(curl -sS -H "Authorization: Basic $AUTH" https://api.paymongo.com/v1/webhooks | python3 -c '
import sys, json
d = json.load(sys.stdin)
for w in d.get("data", []):
    u = (w.get("attributes") or {}).get("url") or ""
    if "trycloudflare.com" in u or "jmestre.tech" in u:
        print(w["id"])
        break
')

BODY=$(WEBHOOK_URL="$WEBHOOK_URL" python3 -c '
import json, os
print(json.dumps({
  "data": {
    "attributes": {
      "url": os.environ["WEBHOOK_URL"],
      "events": ["payment.paid", "link.payment.paid", "qrph.expired", "payment.failed", "source.chargeable"]
    }
  }
}))
')

save_secret() {
  python3 -c '
import sys, json, sqlite3
d = json.load(sys.stdin)
if d.get("errors"):
    print("ERR", d)
    sys.exit(1)
a = d["data"]["attributes"]
print(d.get("_action","OK"), d["data"]["id"], a.get("status"), a.get("url"))
sec = a.get("secret_key")
if sec:
    c = sqlite3.connect("/opt/jm-allinone/billing.db")
    c.execute(
        "INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
        ("paymongo_webhook_secret", sec),
    )
    c.commit()
    print("SECRET_SAVED")
'
}

if [ -n "$HOOK_ID" ]; then
  curl -sS -X PUT "https://api.paymongo.com/v1/webhooks/$HOOK_ID" \
    -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
    -d "$BODY" | python3 -c '
import sys, json, sqlite3
d = json.load(sys.stdin)
if d.get("errors"):
    print("UPDATE_ERR", d)
    sys.exit(1)
a = d["data"]["attributes"]
print("UPDATED", d["data"]["id"], a.get("status"), a.get("url"))
sec = a.get("secret_key")
if sec:
    c = sqlite3.connect("/opt/jm-allinone/billing.db")
    c.execute(
        "INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
        ("paymongo_webhook_secret", sec),
    )
    c.commit()
    print("SECRET_SAVED")
'
  curl -sS -X POST "https://api.paymongo.com/v1/webhooks/$HOOK_ID/enable" \
    -H "Authorization: Basic $AUTH" >/dev/null || true
else
  curl -sS -X POST https://api.paymongo.com/v1/webhooks \
    -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
    -d "$BODY" | python3 -c '
import sys, json, sqlite3
d = json.load(sys.stdin)
if d.get("errors"):
    print("CREATE_ERR", d)
    sys.exit(1)
a = d["data"]["attributes"]
print("CREATED", d["data"]["id"], a.get("url"))
sec = a.get("secret_key")
if sec:
    c = sqlite3.connect("/opt/jm-allinone/billing.db")
    c.execute(
        "INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
        ("paymongo_webhook_secret", sec),
    )
    c.commit()
    print("SECRET_SAVED")
'
fi

echo "WEBHOOK_URL=$WEBHOOK_URL"
