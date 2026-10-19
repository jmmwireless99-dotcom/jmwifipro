# jmestre.tech only (no jmwifi.pro)

Everything runs on **jmestre.tech** / MAGSAY PLDT **`124.107.120.113`** → jmvps SoftEther `192.168.200.155`.

## DNS
Hostinger A `@` / `www` for **jmestre.tech** → **`124.107.120.113`**

## VPN
- SSTP dial: `connect-to=124.107.120.113` `port=4443` (or `jmestre.tech` after DNS)
- CORE may dial LAN SoftEther: `192.168.200.155:4443`
- Billing API: SoftEther tip `10.90.0.x:8728` (MAGSAY LAN `192.168.200.1:8728`)

## jmwifi.pro
- Public HTTP(S) → 301 `https://jmestre.tech`
- Hostinger `jm-billing` **stopped**
- Hostinger `accel-ppp` **stopped/disabled**
