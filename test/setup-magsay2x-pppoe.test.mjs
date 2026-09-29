import assert from "node:assert/strict";
import test from "node:test";
import {
  MAGSAY_DUP_NAME,
  MAGSAY_WAN,
  PPPOE_SERVER,
  REQUIRED_POOLS,
  REQUIRED_PROFILES,
  assignmentForMagsaySecret,
  displayNameFromSecret,
  profileForPlan,
  promoProfileFromRos,
  shouldBillOnMagsay,
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

test("MAGSAY suspend firewall uses the live PLDT-SEM WAN", () => {
  assert.equal(MAGSAY_WAN, "PLDT-SEM");
});

test("duplicate MAGSAY router is renamed, not copied as a second site", () => {
  assert.equal(MAGSAY_DUP_NAME, "MAGSAY2X-CORE-DISABLED");
});

test("promo packages follow Candelaria Home Fiber / Enterprise profiles", () => {
  assert.equal(promoProfileFromRos("Home Fiber 999", "HUGO899"), "Home Fiber 999");
  assert.equal(promoProfileFromRos("Home Fiber 1299", "MACADAT1299"), "Home Fiber 1299");
  assert.equal(promoProfileFromRos("suspended-pool", "JACK1299"), "Home Fiber 1299");
  assert.equal(promoProfileFromRos("suspended-pool", "SESE999"), "Home Fiber 999");
  assert.equal(promoProfileFromRos("Enterprise 2499", "VILLAR2499"), "Enterprise 2499");
});

test("MAGSAY-only secrets bill on MAGSAY; Candelaria-live sessions stay on Candelaria", () => {
  assert.equal(shouldBillOnMagsay({ hasMagSecret: true, magActive: false, candActive: false }), true);
  assert.equal(shouldBillOnMagsay({ hasMagSecret: true, magActive: true, candActive: false }), true);
  assert.equal(shouldBillOnMagsay({ hasMagSecret: true, magActive: false, candActive: true }), false);
  assert.equal(shouldBillOnMagsay({ hasMagSecret: false, magActive: false, candActive: true }), false);

  const magOnly = assignmentForMagsaySecret({
    username: "HUGO899",
    profile: "Home Fiber 999",
    magActive: false,
    candActive: false,
    billedRouterId: 54,
    magRouterId: 53,
    candRouterId: 50,
  });
  assert.equal(magOnly.action, "update");
  assert.equal(magOnly.routerId, 53);
  assert.equal(magOnly.promoProfile, "Home Fiber 999");

  const candLive = assignmentForMagsaySecret({
    username: "NUEVO999",
    profile: "Home Fiber 999",
    magActive: false,
    candActive: true,
    billedRouterId: 53,
    magRouterId: 53,
    candRouterId: 50,
  });
  assert.equal(candLive.action, "restore-candelaria");
  assert.equal(candLive.routerId, 50);
});
