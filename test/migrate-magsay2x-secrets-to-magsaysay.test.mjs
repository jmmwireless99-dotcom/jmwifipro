import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAG_PPPOE_IFACE, MAGSAY_ROUTER_NAME } from "../lib/magsay-clone-pppoe.mjs";
import { isPppoeSecret, isVpnSecret } from "../deploy/migrate-magsay2x-secrets-to-magsaysay.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("classifies PPPoE vs VPN secrets", () => {
  assert.equal(isPppoeSecret({ service: "pppoe" }), true);
  assert.equal(isPppoeSecret({ service: "any" }), true);
  assert.equal(isPppoeSecret({ service: "" }), true);
  assert.equal(isPppoeSecret({ service: "sstp" }), false);
  assert.equal(isVpnSecret({ service: "sstp" }), true);
  assert.equal(isVpnSecret({ service: "l2tp" }), true);
  assert.equal(isVpnSecret({ service: "pppoe" }), false);
});

test("migrate script targets MAGSAYSAY and keeps VPN on core", () => {
  const src = fs.readFileSync(path.join(root, "deploy/migrate-magsay2x-secrets-to-magsaysay.mjs"), "utf8");
  assert.match(src, /MAGSAY2X-CORE/);
  assert.match(src, /MAGSAYSAY-PPPOE|MAGSAY_ROUTER_NAME/);
  assert.match(src, /isVpnSecret/);
  assert.match(src, /disabled:\s*"true"/);
  assert.equal(MAGSAY_ROUTER_NAME, "MAGSAYSAY-PPPOE");
  assert.equal(MAG_PPPOE_IFACE, "sfp-sfpplus1");
});
