import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  CANDELARIA_ROUTER_ID,
  FIRST_SERVER_ROUTER_ID,
  GCASH_RATE_DEFS,
  REQUIRED_WALLED_HOSTS,
  assertBuyVoucherPortalHtml,
  buildGcashPlans,
  gcashRatesOnly,
  missingWalledHosts,
  rateAmountNum,
} from "../deploy/copy-candelaria-buy-voucher-to-1st.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "public/kitifi/status-portal-5th.html");
const SCRIPT = path.join(ROOT, "deploy/copy-candelaria-buy-voucher-to-1st.mjs");

test("copies Candelaria BUY VOUCHER onto 1STSERVER router 52", () => {
  assert.equal(CANDELARIA_ROUTER_ID, 34);
  assert.equal(FIRST_SERVER_ROUTER_ID, 52);
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.match(src, /kitifi_plans_" \+ FIRST_SERVER_ROUTER_ID/);
  assert.match(src, /kitifi_seller_id_" \+ FIRST_SERVER_ROUTER_ID/);
  assert.doesNotMatch(src, /kitifi_free_enabled_52.*, "1"/);
  assert.doesNotMatch(src, /panisijan-login/);
  assert.match(src, /READ-ONLY/);
});

test("GCash rates are ₱20 / 10 Hours and ₱30 / 15 Hours", () => {
  assert.deepEqual(
    GCASH_RATE_DEFS.map((d) => d.amount),
    ["20", "30"]
  );
  const plans = buildGcashPlans([
    { id: 1, amount: "₱ 1 | 12 Minutes", time: "12 Minutes" },
    { id: 4, amount: "₱ 20 | 10 Hours | N/A | 0", time: "10 Hours" },
    { id: 5, amount: "₱ 30 | 15 Hours | N/A | 0", time: "15 Hours" },
  ]);
  assert.equal(plans.length, 2);
  assert.equal(plans[0].price, 20);
  assert.equal(plans[1].price, 30);
  assert.equal(plans[0].kitifi_rate_id, "4");
  assert.equal(gcashRatesOnly([{ amount: "₱ 10" }, { amount: "₱ 20" }]).length, 1);
  assert.equal(rateAmountNum({ amount: "₱ 30 | 15 Hours" }), 30);
});

test("portal HTML keeps BUY VOUCHER and has no Register", () => {
  const html = fs.readFileSync(HTML, "utf8");
  assertBuyVoucherPortalHtml(html);
  assert.match(html, /generator-buy/);
});

test("walled garden must include GCash, PayMongo, and jmwifi.pro", () => {
  assert.ok(REQUIRED_WALLED_HOSTS.includes("jmwifi.pro"));
  assert.ok(REQUIRED_WALLED_HOSTS.includes("gcash.com"));
  assert.deepEqual(
    missingWalledHosts(["jmwifi.pro"], ["jmwifi.pro", "gcash.com"]),
    ["gcash.com"]
  );
  assert.deepEqual(missingWalledHosts(["jmwifi.pro", "gcash.com"], ["jmwifi.pro", "gcash.com"]), []);
});
