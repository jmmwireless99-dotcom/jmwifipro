import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAGSAY_ROUTER_NAME, MAGSAY_WAN, MAG_PPPOE_IFACE } from "../lib/magsay-clone-pppoe.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("finish script targets MAGSAYSAY-PPPOE WAN and bridge-OUT", () => {
  const src = fs.readFileSync(path.join(root, "deploy/finish-magsaysay-pppoe.mjs"), "utf8");
  assert.match(src, /MAGSAYSAY-PPPOE|MAGSAY_ROUTER_NAME/);
  assert.match(src, /sfp-sfpplus1|MAGSAY_WAN/);
  assert.match(src, /bridge-OUT|MAG_PPPOE_IFACE/);
  assert.match(src, /dhcp-server/);
  assert.match(src, /masquerade/);
  assert.equal(MAGSAY_ROUTER_NAME, "MAGSAYSAY-PPPOE");
  assert.equal(MAGSAY_WAN, "sfp-sfpplus1");
  assert.equal(MAG_PPPOE_IFACE, "bridge-OUT");
});

test("finish script never touches ppp secrets", () => {
  const src = fs.readFileSync(path.join(root, "deploy/finish-magsaysay-pppoe.mjs"), "utf8");
  assert.doesNotMatch(src, /\/ppp\/secret\/add/);
  assert.match(src, /secretsUntouched/);
});
