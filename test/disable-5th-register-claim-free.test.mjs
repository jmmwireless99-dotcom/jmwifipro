import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  FIFTH_SERVER_ROUTER_ID,
  FREE_ENABLED_KEY,
  PANISIJAN_FREE_ENABLED_KEY,
  PANISIJAN_ROUTER_ID,
  assertFifthPortalHtml,
  extraKitifiIdsFromPortalSites,
  isKitifiTargetRouter,
  isPanisijanRouter,
  patchFreeInternetHidesRegisterWhenDisabled,
  patchRegisterRejectsDisabled,
  stripRegisterClaimFree,
} from "../deploy/disable-5th-register-claim-free.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "public/kitifi/status-portal-5th.html");
const SCRIPT = path.join(ROOT, "deploy/disable-5th-register-claim-free.mjs");

test("Panisijan is router 51 and stays the only free-register site", () => {
  assert.equal(PANISIJAN_ROUTER_ID, 51);
  assert.equal(PANISIJAN_FREE_ENABLED_KEY, "kitifi_free_enabled_51");
  assert.equal(FIFTH_SERVER_ROUTER_ID, 45);
  assert.equal(FREE_ENABLED_KEY, "kitifi_free_enabled_45");
  assert.equal(isPanisijanRouter(51, "PANISIJAN-CCTV"), true);
  assert.equal(isPanisijanRouter(45, "5thserver"), false);
});

test("KiTifi name matcher includes kitifi servers and skips PPPOE + Panisijan", () => {
  assert.equal(isKitifiTargetRouter({ id: 34, name: "Candelaria-kitifi" }), true);
  assert.equal(isKitifiTargetRouter({ id: 45, name: "5thserver" }), true);
  assert.equal(isKitifiTargetRouter({ id: 48, name: "CAGBATANG" }), true);
  assert.equal(isKitifiTargetRouter({ id: 52, name: "1STSERVER" }), true);
  assert.equal(isKitifiTargetRouter({ id: 51, name: "PANISIJAN-CCTV" }), false);
  assert.equal(isKitifiTargetRouter({ id: 32, name: "MALUBI-PPPOE" }), false);
  assert.equal(isKitifiTargetRouter({ id: 50, name: "CANDELARIA-PPPOE" }), false);
  assert.deepEqual(
    extraKitifiIdsFromPortalSites('{"34":{},"45":{},"51":{}}'),
    [34, 45]
  );
});

test("KiTifi portal HTML keeps BUY VOUCHER and drops Register / Claim Free", () => {
  const html = fs.readFileSync(HTML, "utf8");
  assertFifthPortalHtml(html);
  assert.match(html, /Insert Coin/);
  assert.doesNotMatch(html, /Create account to get free internet/i);
  assert.doesNotMatch(html, /kitifi\/free-internet/i);
  assert.doesNotMatch(html, /goFreeInternet/);
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

test("deploy script turns all KiTifi free-register off and keeps Panisijan on", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.match(src, /PANISIJAN_ROUTER_ID = 51/);
  assert.match(src, /upsert\.run\("kitifi_free_enabled", "0"\)/);
  assert.match(src, /upsert\.run\(PANISIJAN_FREE_ENABLED_KEY, "1"\)/);
  assert.match(src, /upsert\.run\("kitifi_free_enabled_" \+ id, "0"\)/);
  assert.match(src, /if \(id === PANISIJAN_ROUTER_ID\) continue/);
  assert.match(src, /skip Panisijan/);
  assert.match(src, /Does not edit public\/hotspot\/panisijan-login\.html/);
  assert.doesNotMatch(src, /upsert\.run\(PANISIJAN_FREE_ENABLED_KEY, "0"\)/);
});

test("register() is patched for every disabled site, not 5thserver only", () => {
  const before =
    "const rid = Number(routerId) || kitifiPortalRouterId();\n      const existing = byMac(m, rid);";
  const { src, changed } = patchRegisterRejectsDisabled(before);
  assert.equal(changed, true);
  assert.match(src, /if \(!kitifiFreeSettings\(rid\)\.enabled\) throw/);
  assert.doesNotMatch(src, /rid === 45 && !kitifiFreeSettings\(rid\)\.enabled/);
  const again = patchRegisterRejectsDisabled(src);
  assert.equal(again.changed, false);

  const fifthOnly =
    "const rid = Number(routerId) || kitifiPortalRouterId();\n" +
    "      if (rid === 45 && !kitifiFreeSettings(rid).enabled) throw new Error(\"Free internet is disabled.\");\n" +
    "      const existing = byMac(m, rid);";
  const upgraded = patchRegisterRejectsDisabled(fifthOnly);
  assert.equal(upgraded.changed, true);
  assert.match(upgraded.src, /if \(!kitifiFreeSettings\(rid\)\.enabled\) throw/);
});

test("free-internet page hides Register whenever the site is disabled", () => {
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
  assert.match(src, /if \(!data\.enabled\)/);
  assert.doesNotMatch(src, /String\(routerId\) === "45"/);
  assert.match(src, /show\("stepRegister"\)/);
  assert.match(src, /isPanisijan/);

  const fifthOnly = `    if (String(routerId) === "45" && !data.enabled) {
      setBadge(data, false);
      var title = $("headTitle");
      if (title) title.textContent = "Free internet not available";
      if (head) head.textContent = data.message || "Free internet not available.";
      var dm = $("disabledMsg");
      if (dm) dm.textContent = data.message || "Free WiFi is not available right now.";
      show("stepDisabled");
      return;
    }

    if (!data.registered) {
      setBadge(data, !!data.enabled);
      if (head) {
        head.textContent = data.enabled
          ? "Fill up the form below, then tap Register to connect."
          : "Registration is open. Free internet will activate when enabled by admin.";
      }
      show("stepRegister");
      return;
    }`;
  const upgraded = patchFreeInternetHidesRegisterWhenDisabled(fifthOnly);
  assert.equal(upgraded.changed, true);
  assert.match(upgraded.src, /if \(!data\.enabled\)/);
  assert.doesNotMatch(upgraded.src, /String\(routerId\) === "45"/);
});
