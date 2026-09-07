import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  FIFTH_SERVER_ROUTER_ID,
  FREE_ENABLED_KEY,
  assertFifthPortalHtml,
  stripRegisterClaimFree,
} from "../deploy/disable-5th-register-claim-free.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "public/kitifi/status-portal-5th.html");
const SCRIPT = path.join(ROOT, "deploy/disable-5th-register-claim-free.mjs");

test("5thserver is KiTifi router 45", () => {
  assert.equal(FIFTH_SERVER_ROUTER_ID, 45);
  assert.equal(FREE_ENABLED_KEY, "kitifi_free_enabled_45");
});

test("5th portal HTML keeps BUY VOUCHER and drops Register / Claim Free", () => {
  const html = fs.readFileSync(HTML, "utf8");
  assertFifthPortalHtml(html);
  assert.match(html, /Insert Coin/);
  assert.doesNotMatch(html, /free-internet/i);
  assert.doesNotMatch(html, /goFreeInternet/);
  assert.doesNotMatch(html, /Create account to get free internet/i);
});

test("stripRegisterClaimFree removes leftover Register / Claim Free buttons", () => {
  const dirty =
    '<button id="gcashBuyBtn">BUY VOUCHER (GCash)</button>' +
    '<button id="freeWifiBtn">Create account to get free internet</button>' +
    '{% if freetimeBtn == 1 %}<button id="freetimeBtn">Claim Free Time</button>{% endif %}';
  const clean = stripRegisterClaimFree(dirty);
  assertFifthPortalHtml(clean);
  assert.equal(clean.includes("freeWifiBtn"), false);
  assert.equal(clean.includes("Claim Free Time"), false);
});

test("deploy script targets only router 45 and does not enable free WiFi", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.match(src, /FIFTH_SERVER_ROUTER_ID = 45/);
  assert.match(src, /kitifi_free_enabled_" \+ FIFTH_SERVER_ROUTER_ID/);
  assert.match(src, /upsert\.run\(FREE_ENABLED_KEY, "0"\)/);
  assert.doesNotMatch(src, /kitifi_free_enabled_51/);
  assert.doesNotMatch(src, /kitifi_free_enabled_34/);
});
