import assert from "node:assert/strict";
import test from "node:test";
import {
  POOL_NAMES,
  PROFILE_NAMES,
  MAG_PPPOE_IFACE,
  CANDELARIA_ROUTER_NAME,
  MAGSAY_ROUTER_NAME,
  MAGSAY_WAN,
} from "../lib/magsay-clone-pppoe.mjs";

test("clones Candelaria plan pools including suspended", () => {
  assert.ok(POOL_NAMES.includes("Home Fiber Unli 999"));
  assert.ok(POOL_NAMES.includes("Home Fiber Unli 1299"));
  assert.ok(POOL_NAMES.includes("Enterprise 2499"));
  assert.ok(POOL_NAMES.includes("Enterprise 3800"));
  assert.ok(POOL_NAMES.includes("suspended-pool"));
});

test("clones billing PPP profile names", () => {
  assert.deepEqual([...PROFILE_NAMES].sort(), [
    "Enterprise 2499",
    "Enterprise 3800",
    "Home Fiber 1299",
    "Home Fiber 999",
    "suspended-pool",
  ]);
});

test("targets MAGSAYSAY-PPPOE on sfp-sfpplus1 fabric, not MAGSAY2X-CORE", () => {
  assert.equal(MAGSAY_ROUTER_NAME, "MAGSAYSAY-PPPOE");
  assert.equal(MAG_PPPOE_IFACE, "sfp-sfpplus1");
  assert.equal(MAGSAY_WAN, "sfp-sfpplus1");
  assert.equal(CANDELARIA_ROUTER_NAME, "CANDELARIA-PPPOE");
});
