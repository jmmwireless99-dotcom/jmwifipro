# jmestre.tech PayMongo billing

## Live config (jmvps)

- App: `/opt/jm-allinone` on `:3000`, nginx `:80` / `:443`
- `PUBLIC_URL` / `public_url` / `portal_url`: `http://jmestre.tech`
- Gateway: `paymongo` mode `qrph`
- Webhook path: `/api/billing/paymongo/webhook`
- Customer pay page: `http://jmestre.tech/pay/qr?invoice=<id>`
- Public API: `GET /api/pay/qr?invoice=<id>`

## HTTPS

Let's Encrypt cert is installed for `jmestre.tech`. Nginx listens on `:443`.

DNS `jmestre.tech` A must point to **`124.105.235.44`** (working HTTPS).  
While A is still `112.209.31.253`, public TLS is flaky, so customer URLs stay on **HTTP**.

Until DNS is updated, PayMongo webhooks use Cloudflare quick tunnel:

- systemd: `cloudflared-jmestre.service`
- Sync script: `/usr/local/bin/jmestre-sync-paymongo-webhook.sh` (also in this repo as `deploy/jmestre-sync-paymongo-webhook.sh`)
- On tunnel restart, `ExecStartPost` updates the PayMongo webhook URL automatically

After Hostinger A → `124.105.235.44`:

1. Confirm `https://jmestre.tech/` loads
2. Update PayMongo webhook to `https://jmestre.tech/api/billing/paymongo/webhook`
3. Set `PUBLIC_URL` / settings `public_url` + `portal_url` to `https://jmestre.tech`
4. Optionally stop `cloudflared-jmestre`

## Hostinger DNS (required for native HTTPS)

In hPanel → Domains → jmestre.tech → DNS:

| Type | Name | Content           | TTL  |
|------|------|-------------------|------|
| A    | @    | 124.105.235.44    | 300  |
