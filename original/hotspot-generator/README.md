# Original Hotspot Voucher Generator (jmwifi.pro)

Preserved from the **JEFF NETWORK SERVICE** billing panel by Jeffrey — the original
[jmwifi.pro](https://jmwifi.pro) MikroTik ISP / piso-WiFi stack.

This module is the **direct MikroTik** voucher generator: it creates `/ip/hotspot/user`
entries on a router using Jeffrey's original code algorithm and printable card layout.

## Source

Extracted from production `jm-billing` (`backup/20260703T234918Z/app/jm-billing.tar.gz`).
The live panel also ships this logic at `jm-billing/lib/hotspot-generator.js`.

## API

```js
import {
  genVoucherCode,
  minsToHotspotUptime,
  generateHotspotVouchers,
  buildVoucherPrintHtml,
} from "./hotspot-generator.js";

// Single code (default online prefix: JM + 8 chars)
const code = genVoucherCode(8, "JM"); // e.g. JMK7H3NP2W

// Bulk create on MikroTik
const result = await generateHotspotVouchers({
  count: 10,
  profile: "1hour",
  length: 8,
  prefix: "JM",
  uptime: "1h",
  userOnly: true,
  createUser: async ({ code, password, profile, uptime }) => {
    await mikrotik.createHotspotUser({ name: code, password, profile, limitUptime: uptime });
  },
});
// → { created: [...], count, profile, uptime, userOnly, errors }

// Printable voucher cards (admin panel layout)
const html = buildVoucherPrintHtml({
  created: result.created,
  biz: "JM WIFI",
  userOnly: true,
  price: "₱20",
  uptime: "1h",
});
```

## Panel usage

In the admin panel (**Routers → Hotspot users → Vouchers**), choose:

- **Cloud RADIUS** — current jmwifi.pro default (central vouchers, `Cloud-server` profile)
- **Original — direct MikroTik (Jeffrey)** — writes to the selected router profile locally

HTTP API:

```http
POST /api/router/hotspot/vouchers
Content-Type: application/json

{
  "count": 10,
  "profile": "1hour",
  "length": 8,
  "prefix": "JM",
  "uptime": "1h",
  "userOnly": true,
  "generator": "original",
  "router_id": 3
}
```

Set `"generator": "cloud"` (or omit) for the cloud RADIUS path.

## Code alphabet

Voucher codes use `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — no ambiguous `0/O` or `1/I`.
