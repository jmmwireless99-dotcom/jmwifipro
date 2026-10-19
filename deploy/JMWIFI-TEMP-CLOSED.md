# jmwifi.pro temporarily closed

Public web/billing on Hostinger is **off**. SSTP tunnels stay up.

## What changed
- nginx: `jmwifi.pro` / `www` / `187.77.145.131` → `301 https://jmestre.tech$request_uri`
- pm2 `jm-billing`: **stopped**
- accel-ppp `:4443`: **still running** (site tunnels)

## Reopen later (on VPS)
```bash
rm -f /etc/nginx/sites-enabled/jmwifi.pro
ln -sfn /etc/nginx/sites-available/jm-billing /etc/nginx/sites-enabled/jm-billing
nginx -t && systemctl reload nginx
pm2 start jm-billing && pm2 save
rm -f /etc/jm-jmwifi-closed.flag
```

Flag file: `/etc/jm-jmwifi-closed.flag`
