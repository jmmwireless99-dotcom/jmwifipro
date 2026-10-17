# JM LibreQoS 2.2

JM billing is the source of truth for a [LibreQoS 2.2](https://github.com/LibreQoE/LibreQoS/releases/tag/v2.2) shaper.

The bridge reads plans, routers, OLTs, NAPs, and subscribers from `billing.db`. It writes the two files LibreQoS 2.2 loads:

- `network.json` — router sites, OLT sites, and NAP access points, with stable `jm:*` ids
- `ShapedDevices.csv` — one circuit per subscriber, plan rate plus 15% headroom, minimum 1 Mbps

PPPoE addresses in this network are assigned at login. A circuit enters `ShapedDevices.csv` when the subscriber has a static IP or a live session from `/ppp active print terse`. Until then the subscriber stays on the waiting list. Suspended accounts stay off the shaper because MikroTik already cuts them.

LibreQoS 2.2 accepts the first 1,000 mapped circuits without an Insight license. This network is under that line.

## Run

Node.js 22 or newer:

```bash
cd jm-libreqos
BILLING_DB=/opt/jm-billing/billing.db node server.js
```

Open `http://127.0.0.1:9130`. Save the shaper API base (`http://<shaper>:9122`) and the `x-bearer` key from LibreQoS License & Services. Paste the MikroTik PPPoE active list, then push. The bridge writes `network.json`, replaces `ShapedDevices.csv`, and asks LibreQoS to reload.

Export without the web UI:

```bash
node bin/export.js --db /opt/jm-billing/billing.db --out out/ --sessions sessions.txt
```

## Shaper box

On the LibreQoS machine:

```bash
sudo bash deploy/install-libreqos-2.2.sh
```

That installs the official 2.2 package and starts `lqos_api`. Finish interface selection in the LibreQoS first-run page, create an API key, and keep the API on the management network.

Set `topology.compile_mode = "full"` in `/etc/lqos.conf` when circuits should queue under the router, OLT, and NAP names from `network.json`.

## Paano gamitin

1. I-install ang LibreQoS 2.2 sa shaper box.
2. Buksan ang bridge sa billing server.
3. Ilagay ang WAN Mbps, API URL, at API key.
4. I-paste ang `/ppp active print terse`, tapos Push to LibreQoS.
5. Ulitin ang paste kapag may bagong login kung wala pang awtomatikong session sync.
