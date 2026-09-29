import assert from "node:assert/strict";
import test from "node:test";
import {
  PPPOE_SERVER,
  REQUIRED_POOLS,
  REQUIRED_PROFILES,
  displayNameFromSecret,
  profileForPlan,
  shouldImportSecret,
} from "../lib/magsay2x-pppoe.mjs";

test("MAGSAY PPPoE profiles match Candelaria billing names", () => {
  const names = REQUIRED_PROFILES.map((p) => p.name);
  assert.deepEqual(names, [
    "Home Fiber 999",
    "Home Fiber 1299",
    "Enterprise 2499",
    "Enterprise 3800",
    "suspended-pool",
  ]);
  const susp = REQUIRED_PROFILES.find((p) => p.name === "suspended-pool");
  assert.equal(susp.list, "suspended");
  assert.equal(susp.local, "50.0.0.1");
});

test("MAGSAY PPPoE server stays on the CSR switch uplink", () => {
  assert.equal(PPPOE_SERVER.interface, "sfp-sfpplus2");
  assert.equal(PPPOE_SERVER.disabled, "false");
});

test("plan profile mapping follows Candelaria router_profile names", () => {
  assert.equal(profileForPlan({ router_profile: "Home Fiber 999", price: 999 }), "Home Fiber 999");
  assert.equal(profileForPlan({ router_profile: "Home Fiber 1299", price: 1299 }), "Home Fiber 1299");
  assert.equal(profileForPlan({ name: "Enterprise", price: 3800 }), "Enterprise 3800");
});

test("import skips VPN secrets and keeps PPPoE", () => {
  assert.equal(shouldImportSecret({ name: "CAGBATANG", service: "sstp" }), false);
  assert.equal(shouldImportSecret({ name: "HUGO899", service: "pppoe" }), true);
  assert.equal(displayNameFromSecret("HUGO899", "Home Fiber 999"), "HUGO899");
});

test("required pools include the JM suspend range", () => {
  const susp = REQUIRED_POOLS.find((p) => p.name === "suspended-pool");
  assert.equal(susp.ranges, "50.0.0.5-50.0.0.254");
});
