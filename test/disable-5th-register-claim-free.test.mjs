import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  FIFTH_SERVER_ROUTER_ID,
  FREE_ENABLED_KEY,
  assertFifthPortalHtml,
  patchFreeInternetHidesRegisterWhenDisabled,
  patchRegisterRejectsDisabled,
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
  assert.doesNotMatch(html, /Create account to get free internet/i);
  assert.doesNotMatch(html, /kitifi\/free-internet/i);
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

test("register() is patched for 5thserver only, not Panisijan or other sites", () => {
  const before =
    "const rid = Number(routerId) || kitifiPortalRouterId();\n      const existing = byMac(m, rid);";
  const { src, changed } = patchRegisterRejectsDisabled(before);
  assert.equal(changed, true);
  assert.match(src, /rid === 45 && !kitifiFreeSettings\(rid\)\.enabled/);
  assert.doesNotMatch(src, /if \(!kitifiFreeSettings\(rid\)\.enabled\) throw/);
  const again = patchRegisterRejectsDisabled(src);
  assert.equal(again.changed, false);

  const global =
    "const rid = Number(routerId) || kitifiPortalRouterId();\n" +
    "      if (!kitifiFreeSettings(rid).enabled) throw new Error(\"Free internet is disabled.\");\n" +
    "      const existing = byMac(m, rid);";
  const scoped = patchRegisterRejectsDisabled(global);
  assert.equal(scoped.changed, true);
  assert.match(scoped.src, /rid === 45 && !kitifiFreeSettings\(rid\)\.enabled/);
});

test("free-internet page hides Register for router 45 only", () => {
  const before = `    if (!data.registered) {
      setBadge(data, !!data.enabled);
      if (head) {
        head.textContent = data.enabled
          ? "Fill up the form below, then tap Register to connect."
          : "Registration is open. Free internet will activate when enabled by admin.";
      }
      show("stepRegister");
      return;
    }`;
  const { src, changed } = patchFreeInternetHidesRegisterWhenDisabled(before);
  assert.equal(changed, true);
  assert.match(src, /String\(routerId\) === "45" && !data\.enabled/);
  assert.match(src, /Registration is open/);
  assert.match(src, /show\("stepRegister"\)/);
});
